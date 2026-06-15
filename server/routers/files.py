"""LingServer Dashboard — File Browser Routes

GET    /api/files        — list directory
GET    /api/files/read   — read file content (with size limit)
POST   /api/files/upload — upload file(s)
DELETE /api/files        — delete file or empty directory
POST   /api/files/mkdir  — create directory

All paths validated against FILE_ROOT_WHITELIST from config.
"""
import os
import shutil
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, Request
from fastapi.responses import PlainTextResponse

from server.config import FILE_ROOT_WHITELIST, FILE_PREVIEW_MAX_MB, FILE_UPLOAD_MAX_MB
from server.auth import get_current_user
from server.models.schemas import FileSaveRequest

router = APIRouter(prefix="/api/files", tags=["files"])


# ═══════════════════════════════════════════════════════════
#  Path security
# ═══════════════════════════════════════════════════════════

def _safe_path(user_path: str) -> Path:
    """Resolve path and verify it's within a whitelisted root.

    Raises 400 if path traversal detected or path outside whitelist.
    """
    if not user_path:
        raise HTTPException(400, "path 参数不能为空")

    raw = Path(user_path)

    # Reject null bytes
    if '\x00' in user_path:
        raise HTTPException(400, "非法路径字符")

    # Reject path traversal: any '..' component in the original path
    if '..' in raw.parts:
        raise HTTPException(400, "路径包含非法字符 ..")

    # Resolve to absolute
    try:
        resolved = raw.resolve(strict=False)
    except (OSError, RuntimeError):
        raise HTTPException(400, "路径解析失败")

    # Check against whitelist: path must be equal to or under a whitelisted root
    allowed = False
    for root in FILE_ROOT_WHITELIST:
        try:
            root_path = Path(root).resolve()
            # Use path parts to compare — avoids cross-platform separator issues
            root_parts = root_path.parts
            resolved_parts = resolved.parts
            if resolved_parts[:len(root_parts)] == root_parts:
                allowed = True
                break
        except (ValueError, OSError):
            continue

    if not allowed:
        raise HTTPException(400, f"路径不在允许范围内: {resolved}")

    return resolved


def _fmt_size(n: int) -> str:
    for u in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} TB"


def _stat_entry(entry: Path) -> dict:
    """Build a file/directory info dict from a Path."""
    try:
        st = entry.stat()
        return {
            "name": entry.name,
            "path": str(entry),
            "is_dir": entry.is_dir(),
            "is_symlink": entry.is_symlink(),
            "size_bytes": st.st_size if not entry.is_dir() else 0,
            "size_human": _fmt_size(st.st_size) if not entry.is_dir() else "",
            "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "permissions": oct(st.st_mode)[-3:],
        }
    except PermissionError:
        return {
            "name": entry.name,
            "path": str(entry),
            "is_dir": entry.is_dir(),
            "is_symlink": entry.is_symlink(),
            "size_bytes": 0,
            "size_human": "",
            "modified": "",
            "permissions": "???",
            "error": "权限不足",
        }


# ═══════════════════════════════════════════════════════════
#  Endpoints
# ═══════════════════════════════════════════════════════════

@router.get("")
async def list_directory(path: str = "/", _user=Depends(get_current_user)):
    """List contents of a directory."""
    target = _safe_path(path)

    if not target.exists():
        raise HTTPException(404, f"路径不存在: {path}")
    if not target.is_dir():
        raise HTTPException(400, "路径不是目录")

    try:
        entries = sorted(target.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    except PermissionError:
        raise HTTPException(403, "目录无读取权限")

    items = [_stat_entry(e) for e in entries]
    return {
        "current_path": str(target),
        "parent_path": str(target.parent) if target.parent != target else None,
        "items": items,
    }


@router.get("/read")
async def read_file(path: str = "", max_lines: int = 500, _user=Depends(get_current_user)):
    """Read a text file's content (up to FILE_PREVIEW_MAX_MB)."""
    target = _safe_path(path)

    if not target.exists():
        raise HTTPException(404, f"文件不存在: {path}")
    if target.is_dir():
        raise HTTPException(400, "不能读取目录")

    size = target.stat().st_size
    max_bytes = FILE_PREVIEW_MAX_MB * 1024 * 1024

    if size > max_bytes:
        return {
            "path": str(target),
            "size_bytes": size,
            "size_human": _fmt_size(size),
            "too_large": True,
            "content": f"[文件过大 ({_fmt_size(size)})，无法预览，上限 {FILE_PREVIEW_MAX_MB}MB]",
        }

    try:
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except UnicodeDecodeError:
        return {"path": str(target), "size_bytes": size, "binary": True}
    except PermissionError:
        raise HTTPException(403, "文件无读取权限")

    total = len(lines)
    truncated = total > max_lines
    content = "".join(lines[:max_lines])
    if truncated:
        content += f"\n\n... 已截断（共 {total} 行，剩余 {total - max_lines} 行未显示）"

    return {
        "path": str(target),
        "size_bytes": size,
        "size_human": _fmt_size(size),
        "total_lines": total,
        "truncated": truncated,
        "content": content,
    }


@router.post("/upload")
async def upload_file(
    path: str = "/",
    files: list[UploadFile] = File(...),
    _user=Depends(get_current_user),
):
    """Upload one or more files to a directory."""
    target = _safe_path(path)

    if not target.exists():
        raise HTTPException(404, f"目录不存在: {path}")
    if not target.is_dir():
        raise HTTPException(400, "目标必须是目录")

    results = []
    for f in files:
        if not f.filename:
            continue

        dest = target / f.filename
        # Security: ensure destination is within whitelist
        try:
            dest_resolved = dest.resolve(strict=False)
            _safe_path(str(dest_resolved))  # re-validate
        except HTTPException:
            results.append({"name": f.filename, "success": False, "error": "路径不安全"})
            continue

        try:
            size = 0
            too_large = False
            with open(dest, "wb") as out:
                while True:
                    chunk = await f.read(1024 * 1024)  # 1MB chunks
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > FILE_UPLOAD_MAX_MB * 1024 * 1024:
                        results.append({"name": f.filename, "success": False, "error": f"超过上传上限 {FILE_UPLOAD_MAX_MB}MB"})
                        too_large = True
                        break
                    out.write(chunk)
            if too_large:
                try:
                    dest.unlink(missing_ok=True)
                except OSError:
                    pass
            else:
                results.append({"name": f.filename, "success": True, "size_bytes": size, "size_human": _fmt_size(size)})
        except PermissionError:
            results.append({"name": f.filename, "success": False, "error": "写入权限不足"})
        except OSError as e:
            results.append({"name": f.filename, "success": False, "error": str(e)})

    return {"uploaded": results}


@router.delete("")
async def delete_path(path: str = "", _user=Depends(get_current_user)):
    """Delete a file or empty directory."""
    target = _safe_path(path)

    if not target.exists():
        raise HTTPException(404, f"路径不存在: {path}")

    # Extra safety: don't delete root-level directories
    for root in FILE_ROOT_WHITELIST:
        if target.parts == Path(root).resolve().parts:
            raise HTTPException(400, "不允许删除根目录")

    try:
        if target.is_dir():
            target.rmdir()  # only empty directories
        else:
            target.unlink()
        return {"success": True, "path": str(target), "message": "已删除"}
    except OSError as e:
        if target.is_dir():
            raise HTTPException(400, f"删除目录失败（可能非空）: {e}")
        raise HTTPException(500, f"删除失败: {e}")


@router.post("/mkdir")
async def make_directory(path: str = "", name: str = "", _user=Depends(get_current_user)):
    """Create a new directory."""
    target = _safe_path(path)

    if not target.exists():
        raise HTTPException(404, f"路径不存在: {path}")
    if not target.is_dir():
        raise HTTPException(400, "目标必须是目录")

    # Sanitize name
    safe_name = Path(name).name  # strips any path components from the name
    if not safe_name or safe_name in (".", ".."):
        raise HTTPException(400, "无效的目录名")

    new_dir = target / safe_name
    try:
        _safe_path(str(new_dir.resolve(strict=False)))  # validate
    except HTTPException:
        raise HTTPException(400, "新路径不在允许范围内")

    if new_dir.exists():
        raise HTTPException(400, "目录已存在")

    try:
        new_dir.mkdir()
        return {"success": True, "path": str(new_dir), "message": f"已创建目录 {safe_name}"}
    except PermissionError:
        raise HTTPException(403, "无写入权限")
    except OSError as e:
        raise HTTPException(500, f"创建失败: {e}")


@router.put("/save")
async def save_file(req: FileSaveRequest, _user=Depends(get_current_user)):
    """Save (write or overwrite) a text file with UTF-8 content.

    Creates the file if it doesn't exist; overwrites if it does.
    """
    target = _safe_path(req.path)

    # Refuse to write to directories
    if target.exists() and target.is_dir():
        raise HTTPException(400, "目标路径是目录，不能写入")

    # Ensure parent directory exists
    parent = target.parent
    if not parent.exists():
        raise HTTPException(404, f"父目录不存在: {parent}")

    try:
        with open(target, "w", encoding="utf-8") as f:
            f.write(req.content)
    except PermissionError:
        raise HTTPException(403, "文件无写入权限")
    except OSError as e:
        raise HTTPException(500, f"写入失败: {e}")

    return {
        "success": True,
        "path": str(target),
        "size_bytes": len(req.content.encode("utf-8")),
        "message": "文件已保存",
    }

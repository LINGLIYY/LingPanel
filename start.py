#!/usr/bin/env python3
"""LingServer Dashboard — 启动器

自动处理：依赖检查 → 端口清理 → 启动服务器
Windows / Linux / macOS 通用
"""
import os
import sys
import time
import signal
import subprocess
import secrets
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
os.chdir(SCRIPT_DIR)

PORT = int(os.getenv("LING_PORT", "8899"))
HOST = os.getenv("LING_HOST", "0.0.0.0")
IS_DEV = "--dev" in sys.argv


# Force UTF-8 on Windows to avoid GBK encoding errors
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

def print_banner(phase: str, message: str, status: str = "ok"):
    icons = {"ok": "  [OK]", "warn": "  [!!]", "error": "  [XX]", "info": "  [**]"}
    icon = icons.get(status, icons["info"])
    if phase == "header":
        print()
        print("  ========================================")
        print("    LingServer Dashboard v2.0")
        print("  ========================================")
        print()
    else:
        print(f"{icon} {message}")


# ═══════════════════════════════════════════════════════════
#  1. Python 版本检查
# ═══════════════════════════════════════════════════════════

print_banner("header", "")

ver = sys.version_info
print_banner("", f"Python {ver.major}.{ver.minor}.{ver.micro}")

if ver < (3, 10):
    print_banner("", "需要 Python 3.10+", "error")
    if sys.platform == "win32":
        input("按 Enter 退出...")
    sys.exit(1)


# ═══════════════════════════════════════════════════════════
#  2. 安装依赖
# ═══════════════════════════════════════════════════════════

print_banner("", "检查依赖...")
try:
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", "server/requirements.txt", "-q"],
        check=True, capture_output=True,
    )
except subprocess.CalledProcessError:
    print_banner("", "依赖安装失败，请检查网络连接", "warn")


# ═══════════════════════════════════════════════════════════
#  3. 端口清理
# ═══════════════════════════════════════════════════════════

def _port_is_free(port, host="0.0.0.0"):
    """Try binding to port — reliable, no stale netstat cache."""
    import socket as _sock
    s = _sock.socket(_sock.AF_INET, _sock.SOCK_STREAM)
    s.setsockopt(_sock.SOL_SOCKET, _sock.SO_REUSEADDR, 1)
    try:
        s.bind((host, port))
        s.close()
        return True
    except OSError:
        return False

print_banner("", f"检查端口 {PORT}...")

# Force-kill known lingering PIDs from netstat (best-effort, then poll with real bind)
if sys.platform == "win32":
    try:
        r = subprocess.run(["netstat", "-ano"], capture_output=True, text=True)
        for line in r.stdout.splitlines():
            if f":{PORT}" in line and "LISTENING" in line:
                pid = line.split()[-1]
                subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True)
    except Exception:
        pass

# Wait for port to actually be free (real bind test)
for i in range(10):
    if _port_is_free(PORT):
        break
    print_banner("", f"等待端口 {PORT} 释放... ({i+1}/10)", "warn")
    time.sleep(1.5)
else:
    print_banner("", f"端口 {PORT} 仍被占用，请手动关闭占用程序后重试", "error")
    sys.exit(1)


# ═══════════════════════════════════════════════════════════
#  4. 密钥 & 管理员密码
# ═══════════════════════════════════════════════════════════

if not os.getenv("LING_SECRET_KEY"):
    os.environ["LING_SECRET_KEY"] = secrets.token_hex(32)

os.environ["LING_PORT"] = str(PORT)
os.environ["LING_HOST"] = HOST

# Windows 开发环境 — 默认文件白名单加入 C 盘
if sys.platform == "win32" and not os.getenv("LING_FILE_WHITELIST"):
    os.environ["LING_FILE_WHITELIST"] = "C:\\,C:\\Users,D:\\," + \
        "/home,/var,/etc,/opt,/tmp,/usr,/srv"

# --reset-admin: 删除数据库和密码文件，重新生成
PW_FILE = SCRIPT_DIR / ".admin-pw"
if "--reset-admin" in sys.argv:
    db_path = os.getenv("LING_DB_PATH", str(SCRIPT_DIR / "ling-server.db"))
    for f in [db_path, db_path + "-shm", db_path + "-wal", str(PW_FILE)]:
        try:
            os.remove(f)
        except OSError:
            pass
    print_banner("", "已重置管理员密码，即将生成新密码", "warn")

# 确定管理员密码（优先级：env var > .admin-pw 文件 > DB 已有 > 自动生成）
admin_pw = os.getenv("LING_ADMIN_PASSWORD", "")
db_path = os.getenv("LING_DB_PATH", str(SCRIPT_DIR / "ling-server.db"))

if not admin_pw:
    # 1) 从持久化文件中读取
    try:
        if PW_FILE.exists():
            admin_pw = PW_FILE.read_text().strip()
    except Exception:
        pass

if not admin_pw:
    # 2) 检查数据库是否已有 admin
    try:
        import sqlite3
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            row = conn.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
            conn.close()
            if row:
                admin_pw = f"--已设置（运行 start.bat --reset-admin 重置）--"
    except Exception:
        pass

if not admin_pw:
    # 3) 全新生成，持久化到 .admin-pw
    admin_pw = secrets.token_urlsafe(12)
    os.environ["LING_ADMIN_PASSWORD"] = admin_pw
    os.environ["LING_ADMIN_PW_AUTO"] = "1"
    try:
        PW_FILE.write_text(admin_pw)
    except Exception:
        pass
else:
    # 已有密码 — 传给子进程
    if admin_pw and not admin_pw.startswith("--"):
        os.environ["LING_ADMIN_PASSWORD"] = admin_pw

# ═══════════════════════════════════════════════════════════
#  5. 启动
# ═══════════════════════════════════════════════════════════

if IS_DEV:
    os.environ["LING_DEBUG"] = "true"
    os.environ["LING_DB_PATH"] = ":memory:"
    print_banner("", "开发模式：内存数据库 · 热重载", "warn")

print()
print_banner("", f"地址: http://localhost:{PORT}")
print_banner("", f"文档: http://localhost:{PORT}/api/docs")
print("")
pw_display = admin_pw if len(admin_pw) <= 42 else admin_pw[:39] + "..."
print(f"  +---------------------------------------+")
print(f"  |                                       |")
print(f"  |  账号: admin                          |")
print(f"  |  密码: {pw_display:<42} |")
print(f"  |                                       |")
print(f"  +---------------------------------------+")
print()
print("  按 Ctrl+C 停止服务器")
print()
sys.stdout.flush()

try:
    if IS_DEV:
        subprocess.run([sys.executable, "-m", "server.main"])
    else:
        subprocess.run([
            sys.executable, "-m", "uvicorn", "server.main:app",
            "--host", HOST, "--port", str(PORT), "--log-level", "info",
        ])
except KeyboardInterrupt:
    # Ctrl+C — clean exit, no extra prompts
    print()
    sys.exit(0)
except Exception as e:
    print(f"\n  [XX] 启动失败: {e}")
    if sys.platform == "win32":
        input("\n  按 Enter 退出...")
    sys.exit(1)

# Normal exit (server stopped on its own) — only on Windows keep window open
if sys.platform == "win32":
    input("\n  服务器已停止，按 Enter 退出...")

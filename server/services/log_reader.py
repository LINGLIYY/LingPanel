"""LingServer Dashboard — Log Reader Service

Scans configured log sources, reads log files with pagination,
supports level filtering, regex search, and date range.
"""
import os
import re
import fnmatch
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from server.config import LOG_SOURCES, LOG_TAIL_LINES, LOG_MAX_FILE_MB


def list_sources() -> list[dict[str, Any]]:
    """Return configured log sources with availability."""
    results = []
    for src in LOG_SOURCES:
        path = Path(src["path"])
        exists = path.exists()
        size = 0
        if exists:
            try:
                size = path.stat().st_size
            except OSError:
                pass

        results.append({
            "id": src["id"],
            "label": src["label"],
            "path": src["path"],
            "available": exists,
            "size_bytes": size,
            "size_human": _fmt_size(size),
        })
    return results


def read_log(
    source_id: str,
    lines: int = LOG_TAIL_LINES,
    offset: int = 0,
    filter_level: str | None = None,
    filter_regex: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    """Read a log file with optional filtering and pagination.

    Returns {lines: [...], total: int, offset: int, has_more: bool}
    """
    # Find source
    src = None
    for s in LOG_SOURCES:
        if s["id"] == source_id:
            src = s
            break
    if not src:
        raise FileNotFoundError(f"日志源不存在: {source_id}")

    path = Path(src["path"])
    if not path.exists():
        raise FileNotFoundError(f"日志文件不存在: {src['path']}")

    size = path.stat().st_size
    if size > LOG_MAX_FILE_MB * 1024 * 1024:
        raise ValueError(f"日志文件过大 ({_fmt_size(size)})，上限 {LOG_MAX_FILE_MB}MB")

    # Read file (streaming, capped at memory limit)
    try:
        all_lines = []
        total_read = 0
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                all_lines.append(line)
                total_read += len(line.encode("utf-8"))
                if total_read > LOG_MAX_FILE_MB * 1024 * 1024:
                    break  # Truncate at limit rather than rejecting
    except PermissionError:
        raise PermissionError(f"无读取权限: {src['path']}")

    # Apply filters
    filtered = []
    for line in all_lines:
        if filter_level and not _match_level(line, filter_level):
            continue
        if filter_regex:
            try:
                if not re.search(filter_regex, line, re.IGNORECASE):
                    continue
            except re.error:
                pass  # invalid regex → keep line
        if date_from or date_to:
            if not _match_date(line, date_from, date_to):
                continue
        filtered.append(line.rstrip("\n\r"))

    total = len(filtered)
    # Paginate
    chunk = filtered[offset:offset + lines]
    has_more = (offset + lines) < total

    return {
        "source_id": source_id,
        "source_label": src["label"],
        "lines": chunk,
        "total": total,
        "offset": offset,
        "limit": lines,
        "has_more": has_more,
    }


def export_log(source_id: str, filter_regex: str | None = None) -> str:
    """Return full log content as text for download."""
    data = read_log(source_id, lines=100_000, filter_regex=filter_regex)
    return "\n".join(data["lines"])


# ═══════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════

# Common syslog level patterns
_LEVEL_PATTERNS = {
    "emerg": re.compile(r"\b(emerg|emergency|panic)\b", re.I),
    "alert": re.compile(r"\b(alert)\b", re.I),
    "crit": re.compile(r"\b(crit|critical)\b", re.I),
    "error": re.compile(r"\b(err|error|fail|fatal)\b", re.I),
    "warning": re.compile(r"\b(warn|warning)\b", re.I),
    "notice": re.compile(r"\b(notice)\b", re.I),
    "info": re.compile(r"\b(info|information)\b", re.I),
    "debug": re.compile(r"\b(debug|trace)\b", re.I),
}


def _match_level(line: str, level: str) -> bool:
    """Check if a log line matches a severity level."""
    levels_hierarchy = ["debug", "info", "notice", "warning", "error", "crit", "alert", "emerg"]
    target_idx = levels_hierarchy.index(level) if level in levels_hierarchy else -1
    if target_idx < 0:
        return True

    for i in range(target_idx, len(levels_hierarchy)):
        pattern = _LEVEL_PATTERNS.get(levels_hierarchy[i])
        if pattern and pattern.search(line):
            return True
    return False


def _match_date(line: str, date_from: str | None, date_to: str | None) -> bool:
    """Date range filter: checks if the log line's timestamp falls within range."""
    if not date_from and not date_to:
        return True

    line_date = _extract_date(line)
    if line_date is None:
        # Can't parse date — include line (be permissive)
        return True

    if date_from:
        from_dt = _parse_date_input(date_from)
        if from_dt and line_date < from_dt:
            return False
    if date_to:
        to_dt = _parse_date_input(date_to)
        if to_dt and line_date > to_dt:
            return False

    return True


def _extract_date(line: str) -> datetime | None:
    """Extract a datetime from the beginning of a log line."""
    import re as _re
    # Syslog: "Jun 13 10:30:45"
    m = _re.match(r"(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})", line)
    if m:
        try:
            month_map = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
                         "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
            mon = month_map.get(m.group(1).lower(), 1)
            now = datetime.now()
            year = now.year  # Syslog doesn't include year; assume current
            return datetime(year, mon, int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)))
        except ValueError:
            pass
    # ISO: "2026-06-13T10:30:45"
    m = _re.match(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})", line)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                           int(m.group(4)), int(m.group(5)), int(m.group(6)))
        except ValueError:
            pass
    # Fallback: ISO date only "2026-06-13"
    m = _re.match(r"(\d{4})-(\d{2})-(\d{2})", line)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    return None


def _parse_date_input(d: str) -> datetime | None:
    """Parse a user-supplied date string (ISO format)."""
    try:
        if "T" in d:
            return datetime.fromisoformat(d)
        return datetime.strptime(d[:10], "%Y-%m-%d")
    except ValueError:
        return None


def _fmt_size(n: int) -> str:
    for u in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} TB"

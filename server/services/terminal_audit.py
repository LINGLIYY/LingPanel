"""LingServer Dashboard — Terminal Audit Service

Command logging to SQLite + dangerous command detection.
"""
from __future__ import annotations

import re
import time
from typing import Optional

# ═══════════════════════════════════════════════════════════
#  Dangerous command patterns
# ═══════════════════════════════════════════════════════════

# Each pattern is (regex, severity, description)
DANGEROUS_PATTERNS: list[tuple[str, str, str]] = [
    # Destructive file operations
    (
        r"\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-r[a-z]*f|-f[a-z]*r)\b.*/",
        "critical",
        "递归强制删除系统目录",
    ),
    (r"\brm\s+-rf\s+/", "critical", "rm -rf /  — 删除根目录"),
    (r"\bdd\s+if=", "high", "dd 磁盘写入操作"),
    (r">\s*/dev/sd[a-z]", "critical", "覆盖磁盘设备"),

    # Database destruction
    (r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b", "critical", "DROP TABLE/DATABASE"),
    (r"\bTRUNCATE\s+(TABLE\s+)?\w+", "high", "TRUNCATE 操作"),
    (r"\bDELETE\s+FROM\s+\w+(?!\s*WHERE)", "high", "DELETE 无 WHERE 条件"),

    # System control
    (r"\bshutdown\b", "high", "系统关机"),
    (r"\breboot\b", "high", "系统重启"),
    (r"\binit\s+[06]\b", "critical", "切换运行级别 0/6"),
    (r"\bhalt\b", "high", "系统停止"),

    # Service manipulation
    (r"\bsystemctl\s+disable\s+(sshd|firewalld|iptables)\b", "high", "禁用安全服务"),
    (r"\biptables\s+-F\b", "high", "清空防火墙规则"),
    (r"\bufw\s+disable\b", "high", "禁用 UFW 防火墙"),

    # Privilege escalation / backdoor
    (r"\bchmod\s+(\+s|4777|6777|777)\b", "high", "危险权限修改"),
    (r"\bwget\s+.*\|\s*(sh|bash|python)", "medium", "管道执行远程脚本"),
    (r"\bcurl\s+.*\|\s*(sh|bash|python)", "medium", "管道执行远程脚本"),

    # Mass file operations
    (r"\bchown\s+-R\s+\w+:\w+\s+/", "high", "递归修改系统目录所有者"),
    (r"\bchmod\s+-R\s+", "medium", "递归修改权限"),

    # Fork bombs
    (r":\(\)\s*\{.*:\|:.*\}", "critical", "Fork Bomb"),
    (r"\bperl\s+-e\s+.*fork", "high", "Perl fork 循环"),
]

# Compile patterns for performance
_COMPILED: list[tuple[re.Pattern, str, str]] = [
    (re.compile(p, re.IGNORECASE), severity, desc)
    for p, severity, desc in DANGEROUS_PATTERNS
]


def check_dangerous(command: str) -> list[dict]:
    """Check a command against dangerous patterns.

    Returns list of matches, each with {severity, description, pattern}.
    Empty list if safe.
    """
    if not command or not command.strip():
        return []

    matches = []
    for pattern, severity, desc in _COMPILED:
        if pattern.search(command):
            matches.append({
                "severity": severity,
                "description": desc,
                "pattern": pattern.pattern,
            })
    return matches


# ═══════════════════════════════════════════════════════════
#  Audit logging
# ═══════════════════════════════════════════════════════════


def log_command(
    db,
    session_id: str,
    input_text: str,
    username: str = "unknown",
    cwd: str = "/",
) -> Optional[list[dict]]:
    """Log a terminal command to audit table and check for danger.

    Returns list of dangerous matches (if any), empty list otherwise.
    """
    # Trim and sanitize
    text = input_text.strip()
    if not text:
        return None

    # Truncate long input for storage
    stored = text[:2000]

    # Check danger
    dangerous = check_dangerous(text)
    is_dangerous = 1 if dangerous else 0

    try:
        db.execute(
            """INSERT INTO terminal_audit
               (session_id, username, input_text, is_dangerous, cwd)
               VALUES (?, ?, ?, ?, ?)""",
            (session_id, username, stored, is_dangerous, cwd),
        )
        db.commit()
    except Exception:
        pass

    return dangerous if dangerous else []


def query_audit(
    db,
    session_id: Optional[str] = None,
    username: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    dangerous_only: bool = False,
) -> dict:
    """Query terminal audit log with optional filters."""
    conditions = []
    params = []

    if session_id:
        conditions.append("session_id = ?")
        params.append(session_id)
    if username:
        conditions.append("username = ?")
        params.append(username)
    if dangerous_only:
        conditions.append("is_dangerous = 1")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    # Count
    count_row = db.execute(
        f"SELECT COUNT(*) as cnt FROM terminal_audit {where}", params
    ).fetchone()
    total = count_row["cnt"] if count_row else 0

    # Rows
    rows = db.execute(
        f"""SELECT id, session_id, username, input_text, is_dangerous, cwd, timestamp
            FROM terminal_audit {where}
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?""",
        params + [limit, offset],
    ).fetchall()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [dict(r) for r in rows],
    }

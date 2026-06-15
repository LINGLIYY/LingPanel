---
name: admin-password-hot-reload
description: Hot-reload child process inherits admin password via os.environ for :memory: DB consistency
metadata:
  type: project
---

When uvicorn hot-reload spawns a child process, `:memory:` SQLite databases are completely separate — each process has its own. Without intervention, the child process auto-generates a new random admin password different from the parent's. The user sees the parent's password banner but the child rejects it (401).

The fix: `_ensure_default_admin()` in `main.py` now sets `os.environ["LING_ADMIN_PASSWORD"]` after determining the admin password (whether from env var or auto-generated). The child process inherits this env var, and `config.py` reads it at startup time, so `_ensure_default_admin()` in the child creates the admin with the same password.

**Side effect:** `must_change_password` becomes `0` in the child (it sees the password as "configured" via env var rather than auto-generated). The parent still prints the "请立即修改" warning. This is acceptable.

**Why:** Child processes inherit environment variables but not Python module state. Setting `os.environ` is the simplest transport channel for hot-reload scenarios.

**How to apply:** Similarly, `_ensure_secret_key()` sets `os.environ["LING_SECRET_KEY"]` for the same reason. When adding new auto-generated values that must persist across hot-reload, use `os.environ`.

[[secret-key-import-timing]] [[secret-key-env-var-propagation]]

---
name: secret-key-import-timing
description: SECRET_KEY captured at import time as empty string causes 500 on login
metadata:
  type: project
---

`server/auth.py` originally used `from server.config import SECRET_KEY, ...` which captured the value at module import time (empty string `""`). Later, `_ensure_secret_key()` in `main.py` mutated `config.SECRET_KEY` to a valid value, but `auth.SECRET_KEY` remained `""`. When `create_access_token()` called `jwt.encode(payload, SECRET_KEY, ...)`, PyJWT raised `InvalidKeyError("HMAC key must not be empty.")` → unhandled exception → 500 Internal Server Error.

The fix: `auth.py` now uses `import server.config as _cfg` and reads `_cfg.SECRET_KEY` at call time (not import time). Three usage sites updated: `create_access_token()`, `create_refresh_token()`, `decode_token()`.

**Why:** Python's `from module import name` binds by value, not by reference. Any config value that can be mutated at runtime must be accessed via module reference (`module.attr`) rather than captured at import time.

**How to apply:** When adding a new config value that may change after import time, do NOT use `from server.config import NEW_VALUE`. Instead, `import server.config as _cfg` and use `_cfg.NEW_VALUE` at call sites. Safe values (never mutated): `BCRYPT_COST`, `ACCESS_TOKEN_EXPIRE_HOURS`, `REFRESH_TOKEN_EXPIRE_DAYS`, `MAX_LOGIN_FAILURES`, etc. Unsafe: `SECRET_KEY`.

[[secret-key-env-var-propagation]] [[admin-password-hot-reload]]

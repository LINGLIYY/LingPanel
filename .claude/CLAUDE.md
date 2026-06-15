# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 项目概述

LingServer Dashboard 是一个单页服务器运维面板（v2.0），通过 Web UI 管理 1-3 台 Ubuntu 服务器。提供实时指标、文件浏览、Docker 管理、终端访问、日志查看和告警——全在一个页面。

**技术栈：** FastAPI (Python) + SQLite + Vanilla JS (ES Modules, 无框架) + Chart.js + xterm.js
**目标用户：** 单管理员，基于浏览器的服务器管理

## 常用命令

```bash
# 开发服务器（热重载、内存数据库、自动生成密钥）
./start.sh --dev                        # Linux / WSL / macOS

# 生产服务器
./start.sh

# Windows 开发
start.bat                               # 直接运行 python -m server.main（无热重载）

# 运行全部测试（使用内存 SQLite）
./test.sh

# 运行单个测试模块
./test.sh test_auth.py

# 直接用 pytest 运行测试
python -m pytest tests/ -v
python -m pytest tests/test_terminal.py -v
python -m pytest tests/ -v -k "test_login"

# 安装依赖
pip install -r server/requirements.txt
```

服务器启动于 `http://localhost:8899`。API 文档位于 `/api/docs`（仅 DEBUG 模式）。健康检查 `/api/health`。

**启动流程：** `start.sh` / `start.bat` → `start.py`（依赖安装、端口清理、密钥生成）→ 子进程。开发模式运行 `python -m server.main`（热重载），生产模式运行 `uvicorn server.main:app`（无重载）。`start.sh --dev` 设置 `LING_DEBUG=true` + `LING_DB_PATH=:memory:`。`start.bat` 也可传入 `--dev`：`start.bat --dev`。

**管理员密码持久化：** `start.py` 将自动生成的密码写入 `.admin-pw` 文件。重启时优先级：`LING_ADMIN_PASSWORD` 环境变量 > `.admin-pw` 文件 > 数据库中已有用户 > 自动生成新密码。`LING_ADMIN_PW_AUTO=1` 标记自动生成的密码，强制首次登录修改。

```bash
# 重置管理员密码（删除数据库和 .admin-pw 文件，下次启动自动生成）
python start.py --reset-admin
```

## 架构

```
Browser (Vanilla JS SPA)
  ├── REST API ──────────► FastAPI (port 8899)
  ├── WS /ws/live ───────► psutil 指标推送（1s 间隔）
  └── WS /ws/terminal ───► PTY 双向 shell
                              │
                    ┌─────────┼──────────┐
                    │         │          │
                  SQLite   Docker SDK   psutil
```

### 后端（`server/`）

**`server/main.py`** — 应用工厂（`create_app()`）。设置 CORS、安全头、速率限制、数据库初始化、全部路由注册、后台任务（告警循环、终端空闲检查、速率限制清理、指标裁剪）。首次启动自动创建 `admin` 用户——密码来自 `LING_ADMIN_PASSWORD` 环境变量，或自动生成并标记 `must_change_password=1`。`_ensure_secret_key()` 和 `_ensure_default_admin()` 均将生成的值写入 `os.environ`，确保热重载子进程继承相同的密钥和密码。速率限制和指标清理后台任务通过 `logging.getLogger("ling.background")` 记录异常；告警引擎和终端空闲检查各有独立日志器（`ling.alert`、`ling.terminal`），不再静默吞掉。

**`server/config.py`** — 所有配置来自环境变量（`LING_*` 前缀）并设有默认值。禁止在其他模块中硬编码配置；新增配置项统一加在此处。`ADMIN_PASSWORD`（来自 `LING_ADMIN_PASSWORD`）设定初始管理员密码。`FILE_ROOT_WHITELIST` 从 `LING_FILE_WHITELIST` 读取（逗号分隔，默认 `/home,/var,/etc,/opt,/tmp,/usr,/srv`）。`LOG_SOURCES` 从 `LING_LOG_SOURCES` 读取（JSON 格式，默认 Ubuntu syslog/auth/nginx 路径）。

**`server/auth.py`** — JWT (HS256) 访问令牌 + 刷新令牌，bcrypt 密码哈希（cost=12），FastAPI 依赖注入 `get_current_user`，以及 WebSocket 端点的 `verify_ws_auth()`。令牌存储在 HttpOnly Cookie 中；登出时使用内存黑名单。**重要：** `SECRET_KEY` 通过 `import server.config as _cfg` 在调用时读取（`_cfg.SECRET_KEY`），而非导入时捕获——因为 `_ensure_secret_key()` 会在运行时修改该值。其他配置常量（`BCRYPT_COST`、`ACCESS_TOKEN_EXPIRE_HOURS`、`REFRESH_TOKEN_EXPIRE_DAYS`）在导入时捕获是安全的（不会被修改）。

**`server/ws.py`** — `ConnectionManager` 单例：基于频道的发布/订阅，心跳（30s），死连接清理。由 `/ws/live` 用于指标推送，告警引擎用于浏览器通知。

> **⚠️ `connect()` 不再调用 `ws.accept()`。** 调用方必须在传递给 `manager.connect()` 之前先接受 WebSocket 连接。这一变更与 `/ws/live` 新增预接受认证有关——重复调用 `accept()` 会抛出 `RuntimeError` 并静默断开连接。如果新增使用 `ConnectionManager` 的 WebSocket 端点，请先 accept（用于认证或配置交换），再调用 `connect()`。
>
> **`/ws/live` 通过独立的 `_ws_router` 注册（`system.py` 中），不施加路由级 `Depends(get_current_user)`**——认证在 `ws.accept()` 之后手动调用 `verify_ws_auth()`。这与 REST 路由的统一依赖注入模式不同。

**`server/routers/`** — 每个文件对应一个路由前缀。所有受保护路由使用 `Depends(get_current_user)`。认证依赖在 `main.py` 的 `include_router` 层级统一施加，而非在每个端点上单独施加。
- `auth.py` — 登录/登出/刷新/当前用户/修改密码/审计日志。密码最短 8 位。
- `system.py` — 系统指标 REST + `/ws/live` WebSocket
- `processes.py` — 进程列表（排序/分页）+ 按 PID 终止进程
- `services.py` — 服务状态（通过 ThreadPoolExecutor 并行 systemctl）+ 启动/停止/重启。使用 6 个服务的白名单。
- `files.py` — 文件浏览（列表/读取/上传/删除/创建目录），通过 `_safe_path()` 基于路径片段前缀匹配做白名单校验。`FILE_ROOT_WHITELIST` 不包含 `/`（安全修复）。前端 `files.js` 默认路径为 `/home`——修改白名单时需同步更新前端。上传超限后清理残留的部分文件。
- `docker.py` — Docker 守护进程信息（`/api/docker` + `/api/docker/info` 别名）、容器列表/启动/停止/日志，镜像列表。当 Docker socket 不可达时返回 503（通过 `_check_docker()`）。
- `logs.py` — syslog 读取，支持级别/正则/日期过滤
- `alerts.py` — 告警规则 CRUD + 历史记录 + 确认。导出 `cleanup()` 在切 Tab 时移除 WS 告警监听器。
- `terminal.py` — `/ws/terminal` WebSocket + 会话列表/终止 REST + 审计日志。使用三层终端后端：`ConPtySession`（Windows 通过 pywinpty）、`UnixPtySession`（Unix PTY）、`PipeSession`（子进程管道——降级方案）。工厂函数 `_create_terminal_session()` 自动选择最佳方案。设置 `LING_TERM_FORCE_PIPE=true` 可强制使用 PipeSession 进行测试。最大 5 个并发会话，30 分钟空闲超时。ResizeObserver 在 cleanup 中正确断开。页面隐藏时暂停会话列表刷新。

**`server/services/`** — 业务逻辑与 HTTP 层分离：
- `docker_svc.py` — Docker SDK 封装，惰性初始化，优雅降级
- `log_reader.py` — 日志文件读取，带过滤和分页
- `alert_engine.py` — 告警规则评估循环（30s），通过 `_violation_start` 时间戳做去重，自动恢复，webhook。首次调用预热 CPU 避免初始读数为零。异常记录日志而非静默吞掉。
- `terminal_audit.py` — 危险命令模式检测（20 个模式），审计日志

**`server/models/`**：
- `database.py` — SQLite，手动迁移系统（5 个版本），单例连接，WAL 模式
- `schemas.py` — Pydantic v2 模型（部分未充分利用——路由中常直接使用原始字典）

**`server/middleware/`**：
- `rate_limit.py` — 滑动窗口内存速率限制器（ASGI 中间件）
- `security.py` — CSP + 安全头，所有响应统一施加

### 前端（`js/`）

无框架。ES Modules + 事件总线模式。入口文件：`js/app.js`。

**外部 CDN 依赖**（在 `index.html` 中加载）：
- Chart.js 4.4.1 — 以全局 `<script>` 加载（非 ES module），通过 `window.Chart` 访问
- xterm.js 5.3.0 + addon-fit 0.8.0 + addon-search 0.13.0 — 终端模拟

**核心模块：**
- `app.js` — 启动流程：显示骨架屏 → `checkAuth()` → `renderDashboard()` 或 `renderLogin()`。监听 `navigate` 事件在登录页和仪表盘之间切换。
- `state.js` — 全局事件总线（`emit`/`on`/`off`）+ `appState` 对象。无 diff。模块之间通过事件通信。状态字段：`auth`、`username`、`currentTab`、`wsStatus`、`metrics`、`theme`。
- `api.js` — Fetch 封装，自动 401→刷新→重试（一次），JSON 处理，`ApiError` 类。导出 `get()`、`post()`、`put()`、`del()`，以及便捷对象 `authApi` 和 `systemApi`。
- `ws.js` — `/ws/live` 的 WebSocket 客户端。指数退避重连（1s→2s→4s→最大 30s），重连后自动重新订阅，心跳 ping/pong（25s 间隔）。发出 `ws:change`、`ws:open`、`metrics:update`、`alert` 事件。
- `auth.js` — `checkAuth()`、`login()`、`logout()`、`changePassword()`。登录返回 `{ success, error?, locked?, mustChangePassword? }`。当 `mustChangePassword` 为 true 时，调用方在进入仪表盘前先渲染密码修改表单。
- `ui.js` — DOM 组件工厂（`KpiCard`/`updateKpi()`、`Panel`/`panelBody()`、`DataTable`/`updateTable()`、`Modal`、`Skeleton`、`EmptyState`）。局部更新，无需全部重新渲染。
- `charts.js` — Chart.js 工厂，深色/浅色主题自适应默认值。导出 `createLineChart(canvas, options)` 和 `datasetStyle(index)`。深度合并选项，合理默认（Fira Code 字体、OKLCH 色彩）。
- `canvas-wave.js` — Canvas 2D CPU 波形图。60 个采样点的环形缓冲（1次/秒）。API：`initWave(canvas)`、`pushCpu(percent)`、`stopWave()`、`resizeWave()`。约 20fps 渲染，带辉光和填充效果。Canvas 后备存储仅在尺寸变化时 resize（避免每帧清空 GPU 缓冲区）。
- `utils/dom.js` — `el()`、`$()`、`$$()`、`clear()`、`setText()`。`el()` 是主要的 DOM 创建函数——支持嵌套子元素、事件处理器（`on*` 前缀）、`class` 和 `html` 属性。
- `utils/format.js` — 纯展示格式化函数：`bytes(n)`、`bytesPerSec(n)`、`duration(seconds)`、`uptime(seconds)`、`percent(n)`、`number(n)`、`time(ts)`、`dateShort(iso)`。
- `utils/notify.js` — Toast 通知系统。`toast(message, level, duration)`，级别：info/success/error/warning。快捷方式：`notify.info()`、`.success()`、`.error()`、`.warn()`。另有 `setStatus(message)` 用于状态栏文字。
- `utils/icons.js` — 30+ 内联 SVG 图标，通过 `icon(name)` 返回 HTML 字符串。使用 `currentColor` 适配主题，`1em` 尺寸（继承父元素 font-size）。包含状态指示器（`circle-green`/`red`/`yellow`）。同时导出 `iconLabel(name, text)` 用于常见的 `icon('x') + ' 标签'` 模式。

**页面/Tab 结构：**
- `screens/login.js` — 登录表单，锁定倒计时，强制修改密码
- `screens/dashboard.js` — 应用外壳：顶栏（导航 Tab、主题切换、时钟、登出）+ Tab 容器 + 状态栏。基于 hash 的路由（`window.location.hash`）。通过动态 `import()` 懒加载 Tab。Tab 列表集中在 `TAB_DEFS` 数组中（名称/标签/激活状态的唯一数据源）。时钟使用 `requestAnimationFrame` + 秒变化检测——Tab 隐藏时自动暂停。WS 状态 DOM 查询在模块级别缓存。
- `tabs/` — 8 个 Tab 模块：`overview.js`、`processes.js`、`services.js`、`files.js`、`docker.js`、`terminal.js`、`logs.js`、`alerts.js`

**Tab 模式：** 仪表盘外壳在首次导航时懒加载 Tab 模块。设置了定时器或 WebSocket 的 Tab 必须导出 `cleanup()` 函数。`switchTab()` 在切换前调用上一个 Tab 的 `cleanup()`。**新增 Tab 的步骤：** 在 `dashboard.js` 的 `TAB_DEFS` 中添加一条记录——导航按钮、内容面板和动态导入全部由该数组驱动。然后创建 `js/tabs/xxx.js`，包含 `export async function renderXxx(container)` 和 `export function cleanup()`。

**主题：** 持久化在 `localStorage('ling-theme')`。回退到 `prefers-color-scheme` 媒体查询，再回退到深色。主题通过 `<html>` 上的 `data-theme` 属性设置。切换时发出 `theme:change` 事件，供图表和波形图实时更新。

### CSS（`css/`）

三层设计令牌系统（OKLCH 色彩空间）：
- `tokens.css` — 全部 CSS 自定义属性（primitive → semantic → component）
- `reset.css` — 最小化重置
- `layout.css` — 12 列网格，header/content/statusbar 外壳
- `components.css` — 可复用组件样式
- `themes/dark.css` — OLED 黑（#000000）主题（默认）
- `themes/light.css` — 完整浅色主题

主题通过 `<html>` 上的 `data-theme` 属性设置。深色主题使用 Fira Code（等宽/数据） + Fira Sans（正文）。

### 数据库（SQLite）

Schema v5，7 张表：`users`、`login_audit`、`schema_version`、`metrics_history`、`alert_rules`、`alert_history`、`terminal_audit`。迁移在 `database.py` 中按顺序执行。`get_db()` 返回单例连接（WAL 模式、`check_same_thread=False`、`row_factory=sqlite3.Row`）。对 `:memory:` 数据库，连接被全局缓存，因为每次 `connect(':memory:')` 都会创建独立数据库。启动时使用 `init_db()`（执行迁移，返回连接）；其他地方使用 `get_db()`（返回已有单例）。

### 部署（`deploy/`）

目标：Ubuntu 26.04。Nginx 反向代理 + Let's Encrypt SSL → FastAPI 端口 8899。Systemd 服务，安全加固（`ProtectSystem=strict`、`NoNewPrivileges=yes`、`MemoryMax=256M`）。`setup.sh` 自动化完整部署。

## 核心约定

- **Python**：所有服务端代码在 `server` 包内。导入使用 `from server.X import Y`。配置值来自 `server.config`，禁止硬编码。
- **JS**：仅使用 ES Modules。无构建步骤。DOM 创建通过 `utils/dom.js` 的 `el()`。组件模式使用返回 DOM 元素的工厂函数。状态变更通过 `state.js` 事件流转。
- **认证**：JWT 存储在 HttpOnly Cookie 中（非 localStorage）。`get_current_user` 依赖在 `main.py` 的路由层级施加。WebSocket 认证使用 `auth.py` 的 `verify_ws_auth()`。
- **错误处理**：后端返回结构化 JSON `{"detail": "..."}`。前端 `ApiError` 类统一规范化错误。Docker 不可用 → 503 + UI 优雅降级，不崩溃。
- **配置**：所有环境变量以 `LING_*` 为前缀。完整列表见 `.env.example`。值得注意的：`LING_DB_PATH=:memory:` 用于测试/开发；`LING_FILE_WHITELIST`（逗号分隔路径）；`LING_LOG_SOURCES`（JSON 数组）；`LING_ADMIN_PASSWORD`（初始管理员密码）。

## 测试

`tests/` 目录中的测试。`conftest.py` 在导入 app 模块前设置关键环境变量：`LING_DB_PATH=:memory:`、`LING_SECRET_KEY`、`LING_ADMIN_PASSWORD=admin`，以及宽松的速率限制（全局 1000/min，登录 100/min）。提供的 fixture：
- `app` — 每个测试独立的 `create_app()`
- `client` — 未认证的 `TestClient`
- `auth_client` — 以 admin 预认证（通过 `POST /api/auth/login` 登录）
- `_reset_state` — autouse fixture：清除锁定字典、令牌黑名单，并将 admin 密码重置为 "admin"

测试使用 `:memory:` SQLite。涉及路径的测试可能使用 Unix 路径——这些在 Windows 上被条件跳过。

**WebSocket 端点测试：** TestClient 的 `websocket_connect()` 是标准方案。测试受认证保护的 WebSocket 时，`auth_client` 的 cookie jar 会自动携带会话 cookie。终端测试使用 `LING_TERM_FORCE_PIPE=true` 避免分配真实 PTY。Windows 上的 asyncio event-loop-closed 警告是已知且无害的子进程清理噪声。

## 常见陷阱

- **重复调用 `ws.accept()` 会导致连接静默断开。** 如果 WebSocket 处理器在传递给 `manager.connect(ws)` 之前调用了 `await ws.accept()`，连接会崩溃。`manager.connect()` 内部不再进行 accept。
- **文件白名单不包含 `/`。** `FILE_ROOT_WHITELIST` 使用路径片段前缀匹配。没有任何单一条目能覆盖所有路径。前端默认路径为 `/home`——保持后端白名单与前端默认路径同步。
- **Windows 文件白名单：** `start.py` 在 Windows 上自动将 `C:\, C:\Users, D:\` 加入 `LING_FILE_WHITELIST` 前缀。直接设置该环境变量会覆盖此行为，如需保留 Windows 路径需手动追加。
- **Chart.js 是全局变量，不是 ES module。** 在 `index.html` 中通过 `<script>` 标签加载，位于 `js/app.js` 之前。通过 `window.Chart` 访问。不要尝试 `import` 它。
- **Tab 生命周期：cleanup 必须与重新渲染配对。** `cleanup()` 会重置内部标记，但 `loadTab()` 通过 `_tabLoaded[name]` 跟踪已加载的 Tab，不会重复导入。如果 Tab 需要在重新访问时完整重新初始化，清除 `_tabLoaded[name]` 标记，或让 cleanup 妥善重置所有状态。
- **后台任务记录日志但不崩溃。** `_rate_limit_cleanup_loop`、`_metrics_cleanup_loop` 通过 `logging.getLogger("ling.background")` 记录异常；`alert_loop` 和 `idle_checker` 各有独立日志器——调试时查看 WARNING 级别日志。
- **`_violation_start` 是单个时间戳，不是列表。** 告警引擎使用简单的 `{rule_id: 首次违规时间戳}` 字典。持续时间检查为 `now - start >= duration`——基于时间差，与循环间隔无关。这替代了旧的列表计数 `_violation_windows` 方案。

## 设计决策（摘自 ARCHITECTURE.md）

- 选择 Vanilla JS 而非框架（无构建工具，单文件部署）
- SQLite 而非 PostgreSQL（单用户，7 天数据保留，零运维）
- Canvas 2D 绘制 CPU 波形图（60fps，比 Chart.js 画单条线更高效）
- Chart.js 绘制其他图表（折线/仪表盘——比手写 ROI 更高）
- 安全性嵌入每个阶段，而非事后补充
- 仅单管理员（无 RBAC，无多用户）
- 中文 UI（无国际化——面向中文管理员的运维面板）

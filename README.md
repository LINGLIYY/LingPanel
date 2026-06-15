# LingServer Dashboard v2.0

轻量级单页服务器运维面板，通过 Web UI 管理 1-3 台 Ubuntu 服务器。实时指标、文件浏览、Docker 管理、终端访问、日志查看、告警和设置——全在一个页面。

## 功能

- **系统总览** — CPU / 内存 / 磁盘 / 网络实时指标，Canvas 波形图，Chart.js 图表
- **进程管理** — 进程列表（排序/分页），按 PID 终止进程
- **服务管理** — nginx / docker / mysql / redis / ssh / cron 启停控制
- **文件浏览** — 目录浏览、文件预览、上传、下载、删除、创建目录，白名单安全控制
- **Docker 管理** — 容器列表、启停、日志查看，镜像列表
- **Web 终端** — 基于 xterm.js + PTY 的浏览器终端，支持多会话（最多 5 个），30 分钟空闲超时
- **日志查看** — syslog / auth / nginx 日志读取，级别/正则/日期过滤
- **告警系统** — CPU / 内存 / 磁盘阈值规则，WebSocket 实时推送，webhook 通知，自动恢复
- **设置页** — 侧边栏导航，通用参数 / 账户密码 / 告警规则 / 审计统计 / 登录背景 / 关于，11 项可持久化配置，明暗主题完整适配

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | FastAPI (Python 3.10+) |
| 数据库 | SQLite（WAL 模式，Schema v6，8 张表） |
| 前端 | Vanilla JS (ES Modules, 无框架) |
| 图表 | Chart.js 4.4 + Canvas 2D 波形图 |
| 终端 | xterm.js 5.3 + PTY（ConPTY / Unix PTY / Pipe 三层后端） |
| 认证 | JWT (HS256) + bcrypt，HttpOnly Cookie |
| 实时通信 | WebSocket（/ws/live 指标推送 + /ws/terminal 终端） |
| 持久化配置 | settings 表（key-value），前端字段注册表驱动 |

## 快速开始

### 环境要求

- Python 3.10+
- Linux / WSL / macOS / Windows

### 安装与启动

```bash
# 安装依赖
pip install -r server/requirements.txt

# 开发模式（热重载、内存数据库）
./start.sh --dev       # Linux / WSL / macOS
start.bat --dev        # Windows

# 生产模式
./start.sh             # 使用 uvicorn，无热重载

# 重置管理员密码
python start.py --reset-admin
```

浏览器访问 `http://localhost:8899`，API 文档位于 `http://localhost:8899/api/docs`（仅开发模式）。

首次启动自动生成管理员密码，显示在终端中（同时持久化到 `.admin-pw` 文件）。密码优先级：`LING_ADMIN_PASSWORD` 环境变量 > `.admin-pw` 文件 > 数据库中已有用户 > 自动生成。

### 运行测试

```bash
./test.sh                    # 全部测试
./test.sh test_auth.py       # 单个模块
python -m pytest tests/ -v -k "test_login"  # 按名称过滤
```

## 项目结构

```
ling-server-dashboard/
├── server/                 # FastAPI 后端
│   ├── main.py             # 应用工厂（create_app），生命周期管理
│   ├── config.py           # 配置中心（全部 LING_* 环境变量）
│   ├── auth.py             # JWT 认证 + bcrypt 密码哈希
│   ├── events.py           # EventBus 事件总线（含 latest_metrics 缓存，供 alert_engine 复用）
│   ├── ws.py               # WebSocket 连接池（发布/订阅 + 心跳）
│   ├── routers/            # 路由模块
│   │   ├── auth.py         # 登录/登出/刷新/修改密码/审计日志
│   │   ├── system.py       # 系统指标 + 背景图列表 + /ws/live
│   │   ├── files.py        # 文件浏览（白名单安全控制）
│   │   ├── docker.py       # Docker 容器/镜像管理
│   │   ├── logs.py         # 日志读取（级别/正则/日期过滤）
│   │   ├── alerts.py       # 告警规则 CRUD + 历史记录
│   │   ├── terminal.py     # /ws/terminal + 会话管理 + 审计
│   │   ├── processes.py    # 进程列表 + 终止
│   │   ├── services.py     # systemd 服务管理
│   │   └── settings.py     # GET/PUT /api/settings + 审计统计（UNION ALL）
│   ├── services/           # 业务逻辑
│   │   ├── metric_collector.py  # 1s 采集 → EventBus 缓存 + 广播
│   │   ├── alert_engine.py      # 30s 评估（优先读 EventBus 缓存，fallback _collect_system）
│   │   ├── docker_svc.py        # Docker SDK 封装
│   │   ├── log_reader.py        # 日志文件读取
│   │   ├── terminal_audit.py    # 危险命令检测（20 个模式）
│   │   └── lifecycle.py         # 统一生命周期协调器
│   ├── models/             # 数据层
│   │   ├── database.py     # SQLite 手动迁移（v6：8 张表，含 settings）
│   │   └── schemas.py      # Pydantic v2 模型
│   └── middleware/         # 速率限制 + 安全头
├── js/                     # 前端（Vanilla JS, ES Modules）
│   ├── app.js              # 入口：认证检查 → 登录页或仪表盘
│   ├── comm.js             # 统一通信层（REST + WS + 事件总线）
│   ├── screens/            # 页面级模块（login/dashboard）
│   ├── tabs/               # 9 个 Tab 模块
│   │   ├── overview.js     # 系统总览（KPI 卡片 + 波形图）
│   │   ├── processes.js    # 进程管理
│   │   ├── services.js     # 服务管理
│   │   ├── files.js        # 文件浏览
│   │   ├── docker.js       # Docker 管理
│   │   ├── terminal.js     # Web 终端
│   │   ├── logs.js         # 日志查看
│   │   ├── alerts.js       # 告警管理
│   │   └── settings.js     # 设置（侧边栏导航，SETTING_FIELDS 注册表）
│   └── utils/              # 工具函数（dom/format/notify/icons/confirm）
├── css/                    # 三层 OKLCH 设计令牌
│   ├── tokens.css          # 色彩/字体/间距/动画变量
│   ├── reset.css           # 最小化重置
│   ├── layout.css          # 12 列网格 + header/content/statusbar
│   ├── components.css      # 组件样式 + 设置 Tab（含暗色 + 亮色主题完整覆写）
│   └── themes/
│       ├── dark.css        # OLED 黑（默认）
│       └── light.css       # 浅色主题
├── tests/                  # pytest 测试套件（121 用例，内存 SQLite）
├── deploy/                 # Ubuntu 部署（Nginx + Let's Encrypt + systemd）
├── index.html              # 单页入口
├── start.py                # 统一启动器（跨平台）
├── start.sh / start.bat    # 平台启动脚本
├── .env.example            # 环境变量参考
```

## 数据库

Schema v6，8 张表：

| 表 | 用途 |
|----|------|
| `users` | 管理员账户（bcrypt 密码哈希） |
| `login_audit` | 登录审计日志（保留 180 天） |
| `schema_version` | 迁移版本跟踪 |
| `metrics_history` | 系统指标历史（保留 7 天） |
| `alert_rules` | 告警规则配置 |
| `alert_history` | 告警触发/恢复历史（保留 90 天） |
| `terminal_audit` | 终端命令审计（保留 90 天） |
| `settings` | 持久化配置（key-value，11 项默认值） |

审计表由 `_audit_cleanup_loop` 每 6 小时自动清理（批次 DELETE LIMIT 1000，首次立即执行）。

## 设计原则

- **零构建** — Vanilla JS，无 webpack/vite，单文件部署
- **零运维** — SQLite，无需单独数据库进程
- **安全嵌入** — CSP/速率限制/JWT/白名单/审计日志贯穿每个层级
- **单用户** — 无 RBAC，面向单管理员设计
- **中文 UI** — 面向中文运维人员，无国际化负担
- **字段注册表** — 设置 Tab 的 key↔DOM 映射集中在 `SETTING_FIELDS`，新增配置只需加一行
- **指标复用** — MetricCollector 写入 EventBus 缓存，AlertEngine 避免重复 psutil 调用

## 部署

目标环境：Ubuntu 26.04。详见 `deploy/setup.sh` —— 自动配置 Nginx 反向代理、Let's Encrypt SSL 证书、systemd 服务（安全加固：`ProtectSystem=strict`、`NoNewPrivileges=yes`、`MemoryMax=256M`）。

## 配置

全部配置通过环境变量（`LING_*` 前缀），详见 `.env.example`。以下配置项同时支持通过设置页实时修改并持久化到 `settings` 表：

- `refresh_interval` — 指标刷新间隔（1-60 秒）
- `retention_days` — 指标保留天数
- `terminal_timeout` — 终端闲置超时（分钟）
- `debug_panel` — 调试面板开关
- `alert_cpu/mem/disk` — 告警阈值（百分比）
- `alert_duration` — 告警持续时间（秒）
- `alert_action` — 通知方式（browser / webhook）
- `dark_background` / `light_background` — 登录背景壁纸

```bash
LING_SECRET_KEY=your-secret-key        # JWT 签名密钥（生产环境务必修改）
LING_ADMIN_PASSWORD=your-password      # 初始管理员密码（留空自动生成）
LING_PORT=8899                         # 服务端口
LING_DB_PATH=ling-server.db            # 数据库路径（:memory: 用于开发/测试）
LING_DEBUG=false                       # 调试模式（开启 /api/docs）
LING_FILE_WHITELIST=/home,/var,/etc    # 文件浏览白名单路径
LING_TERM_MAX_SESSIONS=5               # 最大终端会话数
LING_METRICS_RETENTION=7               # 指标数据保留天数
```

## License

*待定*

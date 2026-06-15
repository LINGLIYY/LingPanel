# LingServer Dashboard v2.0

轻量级单页服务器运维面板，通过 Web UI 管理 1-3 台 Ubuntu 服务器。实时指标、文件浏览、Docker 管理、终端访问、日志查看和告警——全在一个页面。

## 功能

- **系统总览** — CPU / 内存 / 磁盘 / 网络实时指标，Canvas 波形图，Chart.js 图表
- **进程管理** — 进程列表（排序/分页），按 PID 终止进程
- **服务管理** — nginx / docker / mysql / redis / ssh / cron 启停控制
- **文件浏览** — 目录浏览、文件预览、上传、下载、删除、创建目录，白名单安全控制
- **Docker 管理** — 容器列表、启停、日志查看，镜像列表
- **Web 终端** — 基于 xterm.js + PTY 的浏览器终端，支持多会话（最多 5 个），30 分钟空闲超时
- **日志查看** — syslog / auth / nginx 日志读取，级别/正则/日期过滤
- **告警系统** — CPU / 内存 / 磁盘阈值规则，WebSocket 实时推送，webhook 通知，自动恢复

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | FastAPI (Python 3.10+) |
| 数据库 | SQLite（WAL 模式，7 天数据保留） |
| 前端 | Vanilla JS (ES Modules, 无框架) |
| 图表 | Chart.js 4.4 + Canvas 2D 波形图 |
| 终端 | xterm.js 5.3 + PTY（ConPTY / Unix PTY / Pipe 三层后端） |
| 认证 | JWT (HS256) + bcrypt，HttpOnly Cookie |
| 实时通信 | WebSocket（/ws/live 指标推送 + /ws/terminal 终端） |

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
│   ├── ws.py               # WebSocket 连接池（发布/订阅 + 心跳）
│   ├── routers/            # 路由模块（auth/system/files/docker/logs/alerts/terminal/processes/services）
│   ├── services/           # 业务逻辑（docker_svc/log_reader/alert_engine/terminal_audit）
│   ├── models/             # 数据层（database/schemas）
│   └── middleware/         # 中间件（rate_limit/security）
├── js/                     # 前端（Vanilla JS, ES Modules）
│   ├── app.js              # 入口：认证检查 → 登录页或仪表盘
│   ├── screens/            # 页面级模块（login/dashboard）
│   ├── tabs/               # 8 个 Tab 模块（overview/processes/services/files/docker/terminal/logs/alerts）
│   └── utils/              # 工具函数（dom/format/notify/icons）
├── css/                    # 三层 OKLCH 设计令牌（tokens/reset/layout/components/themes）
├── tests/                  # pytest 测试套件（内存 SQLite）
├── deploy/                 # Ubuntu 部署（Nginx + Let's Encrypt + systemd）
├── index.html              # 单页入口
├── start.py                # 统一启动器（跨平台）
├── start.sh / start.bat    # 平台启动脚本
├── .env.example            # 环境变量参考
```

## 设计原则

- **零构建** — Vanilla JS，无 webpack/vite，单文件部署
- **零运维** — SQLite，无需单独数据库进程
- **安全嵌入** — CSP/速率限制/JWT/白名单/审计日志贯穿每个层级
- **单用户** — 无 RBAC，面向单管理员设计
- **中文 UI** — 面向中文运维人员，无国际化负担

## 部署

目标环境：Ubuntu 26.04。详见 `deploy/setup.sh` —— 自动配置 Nginx 反向代理、Let's Encrypt SSL 证书、systemd 服务（安全加固：`ProtectSystem=strict`、`NoNewPrivileges=yes`、`MemoryMax=256M`）。

## 配置

全部配置通过环境变量（`LING_*` 前缀），详见 `.env.example`：

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

MIT

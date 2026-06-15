#!/usr/bin/env bash
set -euo pipefail
# LingServer Dashboard — 启动脚本 (Linux / WSL / macOS)
# 用法: ./start.sh         生产模式
#       ./start.sh --dev   开发模式

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON=$(which python3 2>/dev/null || which python 2>/dev/null || echo "")

if [ -z "$PYTHON" ]; then
  echo "[X] 未找到 Python，请安装 Python 3.10+"
  exit 1
fi

exec "$PYTHON" start.py "$@"

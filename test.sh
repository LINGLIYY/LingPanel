#!/usr/bin/env bash
# LingServer Dashboard — 快速测试脚本
set -euo pipefail
cd "$(dirname "$0")"

echo "╔══════════════════════════════════╗"
echo "║  测试套件                        ║"
echo "╚══════════════════════════════════╝"

PYTHON=$(which python3 2>/dev/null || which python 2>/dev/null)

echo ""
echo "[1/2] 安装测试依赖..."
$PYTHON -m pip install pytest pytest-asyncio -q 2>/dev/null || true

echo "[2/2] 运行测试..."
echo ""

if [ -n "${1:-}" ]; then
  # 指定模块：./test.sh test_terminal.py
  $PYTHON -m pytest "tests/$1" -v
else
  $PYTHON -m pytest tests/ -v
fi

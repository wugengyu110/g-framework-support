#!/usr/bin/env bash
# 本地首次拉起：依赖 + Chromium + catalog + 前端构建
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> npm install"
npm install
(cd frontend && npx playwright install chromium)

echo "==> catalog + build"
npm run catalog
npm run build

echo ""
echo "启动:  npm run api"
echo "或:    docker compose up --build"
echo "预览:  http://127.0.0.1:18800/"
echo "文档:  http://127.0.0.1:18800/docs"

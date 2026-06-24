#!/bin/bash
# Anthropic→OpenAI 翻译网关启动脚本（供 launchd 调用）。
# token 从 dashboard DB 单一来源读取，避免在多处重复存密钥。
set -euo pipefail

GATEWAY_DIR="/Users/xiaoqin/agentma2/dashboard/gateway"
CONFIG="$GATEWAY_DIR/litellm.config.yaml"
PORT="${GATEWAY_PORT:-4000}"

# 上游 aicodemirror token：从 600 权限密钥文件读（与 dashboard 的入站 master_key 分离）。
# 轮换上游 token 只需改这个文件再重启网关，不再碰 DB 的 profile。
AICODEMIRROR_TOKEN="$(cat "$GATEWAY_DIR/upstream-token")"
export AICODEMIRROR_TOKEN

# 入站鉴权 master_key（dashboard 用它访问网关）。从 600 密钥文件读，不入 git。
LITELLM_MASTER_KEY="$(cat "$GATEWAY_DIR/master-key")"
export LITELLM_MASTER_KEY

# 绕开本地 SOCKS 代理（:7897），让 httpx 直连 aicodemirror
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

exec /opt/homebrew/bin/uvx --from 'litellm[proxy]' litellm --config "$CONFIG" --port "$PORT"

#!/bin/sh
# 在宿主 PATH 里没有 node 时（如 Devin Desktop）自行找到 Node.js 22.13+ 再启动 MCP 服务。
# stdout 是 JSON-RPC 通道，这里只允许写 stderr。
HERE=$(cd "$(dirname "$0")" && pwd)
USER_HOME=${HOME:-}

usable() { [ -n "$1" ] && [ -x "$1" ] && [ -f "$1" ]; }

newest() {
  for cand in "$@"; do
    [ -x "$cand" ] || continue
    ver=${cand#*node-v}; ver=${ver#*versions/node/v}; ver=${ver%%/*}; ver=${ver%%-*}
    printf '%s %s\n' "$ver" "$cand"
  done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1 | sed 's/^[^ ]* //'
}

NODE=""
if usable "$XANDER_NODE"; then NODE=$XANDER_NODE; fi
if [ -z "$NODE" ] && [ -n "$USER_HOME" ]; then
  NODE=$(newest "$USER_HOME"/.local/share/xander-runtime/node-v*/bin/node)
fi
if [ -z "$NODE" ]; then
  found=$(command -v node 2>/dev/null) && usable "$found" && NODE=$found
fi
if [ -z "$NODE" ]; then
  for cand in /opt/homebrew/bin/node /usr/local/bin/node; do
    if usable "$cand"; then NODE=$cand; break; fi
  done
fi
if [ -z "$NODE" ] && [ -n "$USER_HOME" ]; then
  NODE=$(newest "$USER_HOME"/.nvm/versions/node/*/bin/node)
fi
if [ -z "$NODE" ] && [ -n "$USER_HOME" ] && usable "$USER_HOME/.volta/bin/node"; then
  NODE=$USER_HOME/.volta/bin/node
fi

if [ -z "$NODE" ]; then
  echo "[xander] 找不到 Node.js。请安装 Node.js 22.13 或更高版本（https://nodejs.org），或用环境变量 XANDER_NODE 指定 node 的完整路径。" >&2
  exit 1
fi
exec "$NODE" "$HERE/index.js" "$@"

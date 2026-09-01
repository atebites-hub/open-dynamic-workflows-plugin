#!/usr/bin/env bash
# scripts/install-cursor-cli.sh — one-command Cursor CLI install (no Customize UI).
#
# From a checkout:
#   ./scripts/install-cursor-cli.sh
# Or:
#   curl -fsSL https://raw.githubusercontent.com/atebites-hub/open-dynamic-workflows-plugin/main/scripts/install-cursor-cli.sh | bash

set -euo pipefail

PLUGIN_NAME="open-dynamic-workflows"
REPO_URL="${ODW_PLUGIN_REPO:-https://github.com/atebites-hub/open-dynamic-workflows-plugin.git}"
HOME_DIR="${ODW_CURSOR_HOME:-${HOME:?HOME is not set}}"
DEST="${HOME_DIR}/.cursor/plugins/local/${PLUGIN_NAME}"

die() {
  printf '[odw] %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "need '$1' on PATH"
}

need node

self="${BASH_SOURCE[0]:-$0}"
source_root=""
if [[ -n "$self" && "$self" != "bash" && "$self" != "-bash" && "$self" != "sh" && -f "$self" ]]; then
  candidate="$(cd "$(dirname "$self")/.." && pwd)"
  if [[ -f "$candidate/dist/mcp/server.js" && -f "$candidate/scripts/install-cursor-cli.mjs" ]]; then
    source_root="$candidate"
  fi
fi

if [[ -z "$source_root" ]]; then
  need git
  mkdir -p "$(dirname "$DEST")"
  if [[ -d "$DEST/.git" ]]; then
    git -C "$DEST" fetch --depth 1 origin
    git -C "$DEST" reset --hard FETCH_HEAD
  elif [[ -f "$DEST/scripts/install-cursor-cli.mjs" && -f "$DEST/dist/mcp/server.js" ]]; then
    source_root="$DEST"
  else
    if [[ -e "$DEST" ]]; then
      die "refusing to overwrite ${DEST}; remove it or run from a plugin checkout"
    fi
    git clone --depth 1 "$REPO_URL" "$DEST"
  fi
  if [[ -z "$source_root" ]]; then
    source_root="$DEST"
  fi
fi

exec node "$source_root/scripts/install-cursor-cli.mjs" --source "$source_root" --home "$HOME_DIR" "$@"

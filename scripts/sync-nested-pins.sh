#!/usr/bin/env bash
# Compare (or apply) nested submodule pins against each atebites-hub remote's main.
# Used by humans/agents and by .github/workflows/sync-nested-pins.yml.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

mode="${1:-check}"
case "$mode" in
  check | apply) ;;
  -h | --help)
    cat <<'EOF'
Usage: scripts/sync-nested-pins.sh <check|apply>

  check   Print pin vs remote main for every .gitmodules entry. Exit 1 if drifted.
  apply   Point drifted gitlinks at that remote's current main. Does not commit.
EOF
    exit 0
    ;;
  *)
    echo "usage: $0 <check|apply>" >&2
    exit 2
    ;;
esac

if ! git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "not a git work tree: $root" >&2
  exit 2
fi

drifted=0
applied=0
printf '%-28s %-40s %-40s %s\n' "PATH" "PINNED" "REMOTE main" "STATUS"
printf '%-28s %-40s %-40s %s\n' "----" "------" "-----------" "------"

while IFS= read -r key; do
  name="${key#submodule.}"
  name="${name%.path}"
  path="$(git config -f .gitmodules --get "submodule.${name}.path")"
  url="$(git config -f .gitmodules --get "submodule.${name}.url")"
  if [[ -z "$path" || -z "$url" ]]; then
    echo "incomplete .gitmodules entry: $name" >&2
    exit 2
  fi

  pin="$(git rev-parse ":${path}")"
  remote_line="$(git ls-remote --heads "$url" main)"
  if [[ -z "$remote_line" ]]; then
    echo "no heads/main on $url" >&2
    exit 2
  fi
  remote_sha="${remote_line%%[[:space:]]*}"

  if [[ "$pin" == "$remote_sha" ]]; then
    status="current"
  else
    status="ahead on remote"
    drifted=1
  fi
  printf '%-28s %-40s %-40s %s\n' "$path" "$pin" "$remote_sha" "$status"

  if [[ "$mode" == "apply" && "$pin" != "$remote_sha" ]]; then
    git update-index --cacheinfo "160000,${remote_sha},${path}"
    applied=$((applied + 1))
    echo "applied ${path} -> ${remote_sha}"
  fi
done < <(git config -f .gitmodules --name-only --get-regexp '^submodule\..*\.path$')

if [[ "$mode" == "apply" ]]; then
  echo "updated ${applied} gitlink(s)"
  exit 0
fi

if [[ "$drifted" -ne 0 ]]; then
  echo
  echo "nested remotes moved ahead of pins; see UPSTREAM.md"
  exit 1
fi

echo
echo "nested pins match remote main"
exit 0

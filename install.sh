#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="wzj386776067/html-share-publisher"
API_BASE="https://share.bi-cheng.cn"
INSTALL_ROOT="${HOME}/.local/share/html-share-publisher"
VERSION=""
PAYLOAD_DIR=""
CLIENTS="auto"
SKIP_REGISTER=0
SKIP_API_CHECK=0

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --version VERSION       Install a release tag such as v0.2.1 (default: latest)
  --api-base URL          Workbench API origin
  --install-root PATH     MCP installation root
  --client CLIENTS        auto, all, codex, workbuddy, trae, codebuddy, or generic
  --payload-dir PATH      Install an already extracted release (used by CI)
  --skip-register         Install files without changing any AI client configuration
  --skip-api-check        Do not check the workbench health endpoint
  -h, --help              Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --api-base)
      API_BASE="${2:-}"
      shift 2
      ;;
    --install-root)
      INSTALL_ROOT="${2:-}"
      shift 2
      ;;
    --client)
      CLIENTS="${2:-}"
      shift 2
      ;;
    --payload-dir)
      PAYLOAD_DIR="${2:-}"
      shift 2
      ;;
    --skip-register)
      SKIP_REGISTER=1
      shift
      ;;
    --skip-api-check)
      SKIP_API_CHECK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo "Missing SHA-256 tool: install shasum or sha256sum" >&2
    exit 1
  fi
}

script_dir=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [[ -z "$PAYLOAD_DIR" && -n "$script_dir" && -f "$script_dir/mcp/package.json" && -f "$script_dir/skills/html-share-publisher/SKILL.md" ]]; then
  PAYLOAD_DIR="$script_dir"
fi

if [[ -z "$PAYLOAD_DIR" ]]; then
  require_command curl
  require_command tar

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT
  asset="html-share-publisher.tar.gz"
  if [[ -n "$VERSION" ]]; then
    release_base="https://github.com/${REPOSITORY}/releases/download/${VERSION}"
  else
    release_base="https://github.com/${REPOSITORY}/releases/latest/download"
  fi

  echo "Downloading HTML Share Publisher ${VERSION:-latest}..."
  curl -fL --retry 3 --retry-delay 1 -o "$temp_dir/$asset" "$release_base/$asset"
  curl -fL --retry 3 --retry-delay 1 -o "$temp_dir/$asset.sha256" "$release_base/$asset.sha256"

  expected_checksum="$(awk 'NR == 1 { print $1 }' "$temp_dir/$asset.sha256")"
  actual_checksum="$(sha256_file "$temp_dir/$asset")"
  if [[ -z "$expected_checksum" || "$actual_checksum" != "$expected_checksum" ]]; then
    echo "Release checksum verification failed." >&2
    exit 1
  fi

  mkdir -p "$temp_dir/release"
  tar -xzf "$temp_dir/$asset" -C "$temp_dir/release"
  PAYLOAD_DIR="$temp_dir/release/html-share-publisher"
fi

if [[ ! -f "$PAYLOAD_DIR/mcp/package.json" || ! -f "$PAYLOAD_DIR/skills/html-share-publisher/SKILL.md" || ! -f "$PAYLOAD_DIR/installer/configure-clients.mjs" ]]; then
  echo "Invalid release payload: $PAYLOAD_DIR" >&2
  exit 1
fi

if [[ -z "$VERSION" && -f "$PAYLOAD_DIR/VERSION" ]]; then
  VERSION="$(tr -d '\r\n' < "$PAYLOAD_DIR/VERSION")"
fi
VERSION="${VERSION:-local}"

require_command node
require_command npm
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$node_major" -lt 22 ]]; then
  echo "Node.js 22 or newer is required; found $(node --version)." >&2
  exit 1
fi
API_BASE="${API_BASE%/}"
mkdir -p "$INSTALL_ROOT/releases"
release_dir="$INSTALL_ROOT/releases/$VERSION"
release_temp="$INSTALL_ROOT/releases/.install-$VERSION-$$"
rm -rf "$release_temp"
mkdir -p "$release_temp"
cp -R "$PAYLOAD_DIR/mcp" "$release_temp/mcp"
cp -R "$PAYLOAD_DIR/skills/html-share-publisher" "$release_temp/skill"
cp -R "$PAYLOAD_DIR/installer" "$release_temp/installer"

echo "Installing MCP dependencies..."
npm ci --omit=dev --prefix "$release_temp/mcp"
npm run verify --prefix "$release_temp/mcp"

rm -rf "$release_dir"
mv "$release_temp" "$release_dir"

current_link="$INSTALL_ROOT/current"
if [[ -e "$current_link" && ! -L "$current_link" ]]; then
  echo "Cannot replace non-symlink path: $current_link" >&2
  exit 1
fi
current_temp="$INSTALL_ROOT/.current-$$"
rm -f "$current_temp"
ln -s "$release_dir" "$current_temp"
rm -f "$current_link"
mv "$current_temp" "$current_link"

if [[ "$SKIP_REGISTER" -eq 0 ]]; then
  echo "Configuring detected AI clients..."
  node_path="$(command -v node)"
  node "$current_link/installer/configure-clients.mjs" \
    --client "$CLIENTS" \
    --install-root "$INSTALL_ROOT" \
    --skill-source "$current_link/skill" \
    --server-path "$current_link/mcp/src/server.js" \
    --node-path "$node_path" \
    --api-base "$API_BASE"
fi

if [[ "$SKIP_API_CHECK" -eq 0 ]]; then
  node -e '
    const url = `${process.argv[1]}/api/health`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`health check returned ${response.status}`);
  ' "$API_BASE"
fi

echo
echo "HTML Share Publisher $VERSION installed successfully."
echo "MCP:   $current_link/mcp/src/server.js"
echo "Clients: $CLIENTS"
if [[ "$SKIP_REGISTER" -eq 0 ]]; then
  echo "Restart the current AI client or open a new task, then ask it to publish an HTML site."
fi

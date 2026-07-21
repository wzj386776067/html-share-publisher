#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
default_version="v$(node -p "require('$root_dir/mcp/package.json').version")"
version="${1:-$default_version}"
output_dir="$root_dir/output/releases"
asset="$output_dir/html-share-publisher.tar.gz"
stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT

package_dir="$stage_dir/html-share-publisher"
mkdir -p "$package_dir/mcp" "$package_dir/skills"
cp "$root_dir/install.sh" "$package_dir/install.sh"
cp "$root_dir/install.ps1" "$package_dir/install.ps1"
cp "$root_dir/launcher.mjs" "$package_dir/launcher.mjs"
cp "$root_dir/README.md" "$package_dir/README.md"
cp "$root_dir/INSTALL_FOR_AI.md" "$package_dir/INSTALL_FOR_AI.md"
cp "$root_dir/mcp/package.json" "$root_dir/mcp/package-lock.json" "$package_dir/mcp/"
cp -R "$root_dir/mcp/src" "$package_dir/mcp/src"
cp -R "$root_dir/mcp/scripts" "$package_dir/mcp/scripts"
cp -R "$root_dir/installer" "$package_dir/installer"
cp -R "$root_dir/skills/html-share-publisher" "$package_dir/skills/html-share-publisher"
printf '%s\n' "$version" > "$package_dir/VERSION"
chmod +x "$package_dir/install.sh" "$package_dir/launcher.mjs" "$package_dir/mcp/src/server.js"

mkdir -p "$output_dir"
rm -f "$asset" "$asset.sha256" "$asset.sig"
COPYFILE_DISABLE=1 tar -czf "$asset" -C "$stage_dir" html-share-publisher

if command -v shasum >/dev/null 2>&1; then
  checksum="$(shasum -a 256 "$asset" | awk '{print $1}')"
else
  checksum="$(sha256sum "$asset" | awk '{print $1}')"
fi
printf '%s  %s\n' "$checksum" "$(basename "$asset")" > "$asset.sha256"

if [[ -n "${HTML_SHARE_RELEASE_SIGNING_KEY_FILE:-}" ]]; then
  node "$root_dir/scripts/sign-release.mjs" "$asset" "$HTML_SHARE_RELEASE_SIGNING_KEY_FILE"
fi

echo "$asset"

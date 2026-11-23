#!/usr/bin/env bash
# Fails unless every file a release needs for <platform> exists and isn't empty (RELEASES.md 6.1).
# Usage: scripts/check-assets.sh linux|windows|all <dir>
set -euo pipefail
platform="$1"
dir="$2"
v=$(node -p "require('./package.json').version")
linux=("Heartline-$v-Linux-x64.AppImage" "Heartline-$v-Linux-x64.deb" "Heartline-$v-Linux-x64.rpm" "Heartline-$v-Linux-x64.tar.gz" "Heartline-$v-Extension.zip")
windows=("Heartline-$v-Windows-x64-Setup.exe" "Heartline-$v-Windows-x64-portable.exe")
# Decision (RELEASES.md 6.4): the MSI is required only once the app icon exists, because WiX can't build without one.
if [[ -s build/icons/256x256.png ]]; then
  windows+=("Heartline-$v-Windows-x64.msi")
else
  echo "note: no app icon yet, MSI not required"
fi
case "$platform" in
  linux) want=("${linux[@]}") ;;
  windows) want=("${windows[@]}") ;;
  all) want=("${linux[@]}" "${windows[@]}") ;;
  *) echo "Unknown platform: $platform" >&2; exit 2 ;;
esac
missing=0
for f in "${want[@]}"; do
  if [[ ! -s "$dir/$f" ]]; then
    echo "Missing or empty: $f" >&2
    missing=1
  else
    echo "ok  $f ($(wc -c < "$dir/$f") bytes)"
  fi
done
exit "$missing"

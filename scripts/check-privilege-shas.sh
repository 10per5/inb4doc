#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

MODE="${1:-check}"

MAPPINGS=(
  "gui:gui/predep.toml"
  "editor:editor/predep.toml"
  "hugo:hugo-view/predep.toml"
  "package:predep.toml"
)

error=0

for entry in "${MAPPINGS[@]}"; do
  IFS=: read -r name toml <<< "$entry"
  expected=$(sha256sum "$toml" | cut -d' ' -f1)
  actual=$(awk -v k="$name" '$1==k":"{print $2}' .github/predep-shas.yml)

  if [ -z "$actual" ]; then
    echo "MISSING: $name not found in .github/predep-shas.yml"
    if [ "$MODE" = "--update" ]; then
      printf '%s: %s\n' "$name" "$expected" >> .github/predep-shas.yml
      echo "  -> added"
    fi
    error=1
    continue
  fi

  if [ "$actual" != "$expected" ]; then
    echo "MISMATCH: $name (.github/predep-shas.yml)"
    echo "  has:      $actual"
    echo "  expects:  $expected  (sha256sum $toml)"
    if [ "$MODE" = "--update" ]; then
      sed -i "s/^${name}: .*/${name}: ${expected}/" .github/predep-shas.yml
      echo "  -> updated"
    fi
    error=1
  fi
done

if [ "$MODE" = "--list" ]; then
  for entry in "${MAPPINGS[@]}"; do
    IFS=: read -r name toml <<< "$entry"
    sha=$(sha256sum "$toml" | cut -d' ' -f1)
    echo "$sha  .github/predep-shas.yml  # $toml (key: $name)"
  done
  exit 0
fi

if [ $error -gt 0 ]; then
  if [ "$MODE" != "--update" ]; then
    echo "---"
    echo "Run \`scripts/check-privilege-shas.sh --update\` to auto-fix mismatches."
  fi
  exit 1
fi

echo "All privilege SHAs match their predep.toml files."

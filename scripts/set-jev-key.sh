#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
# Saves your TypeSafe (Jev) API key to ~/.config/ghosthand/env with mode 0600.
# Usage (from the repo root):  ./scripts/set-jev-key.sh
# The key is read from a hidden prompt, so it never lands in shell history.
set -euo pipefail

dir="${XDG_CONFIG_HOME:-$HOME/.config}/ghosthand"
file="$dir/env"
mkdir -p "$dir"
chmod 700 "$dir"
touch "$file"
chmod 600 "$file"

printf 'Paste your TypeSafe API key and press Enter (input is hidden): '
IFS= read -rs key
echo
key="$(printf '%s' "$key" | tr -d '[:space:]')"
if [ -z "$key" ]; then
  echo "No key entered; nothing changed." >&2
  exit 1
fi

tmp="$(mktemp "$dir/env.XXXXXX")"
chmod 600 "$tmp"
grep -v '^TYPESAFE_API_KEY=' "$file" > "$tmp" || true
printf 'TYPESAFE_API_KEY=%s\n' "$key" >> "$tmp"
mv "$tmp" "$file"
chmod 600 "$file"
unset key

echo "Saved to $file (mode 600). Checking it:"
node apps/cli/src/main.ts doctor 2>/dev/null | grep -i typesafe || true

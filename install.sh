#!/usr/bin/env sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден, пробую установить..."
  if command -v brew >/dev/null 2>&1; then brew install node
  elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nodejs npm
  elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y nodejs
  elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm nodejs npm
  else echo "Установите Node.js 18+ с https://nodejs.org и запустите снова."; exit 1; fi
fi
if [ -f installer/install.js ]; then exec node installer/install.js "$@"; else exec node install.js "$@"; fi

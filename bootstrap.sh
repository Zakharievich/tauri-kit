#!/usr/bin/env bash
#
# One-line remote bootstrap for the TauriKit server deploy. Installs git,
# clones (or updates) the repository, then hands off to deploy.sh — which does
# the real work. Keep this file tiny: all deployment logic lives in deploy.sh.
#
# Usage (public repo required):
#   curl -fsSL https://raw.githubusercontent.com/Zakharievich/tauri-kit/main/bootstrap.sh \
#     | sudo bash -s -- --domain conf.example.com
#
# All arguments after `--` are forwarded verbatim to deploy.sh.
set -euo pipefail

REPO_URL="${TAURIKIT_REPO_URL:-https://github.com/Zakharievich/tauri-kit.git}"
CLONE_DIR="${TAURIKIT_DIR:-$HOME/tauri-kit}"

# Must run as root (piped stdin can't be reliably re-exec'd — run under sudo).
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Запустите через sudo, например:" >&2
  echo "  curl -fsSL <url>/bootstrap.sh | sudo bash -s -- --domain conf.example.com" >&2
  exit 1
fi

echo "==> Установка git (если нужно)"
if ! command -v git >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y git
fi

if [[ -d "$CLONE_DIR/.git" ]]; then
  echo "==> Обновление репозитория в $CLONE_DIR"
  git -C "$CLONE_DIR" pull --ff-only
else
  echo "==> Клонирование $REPO_URL в $CLONE_DIR"
  git clone "$REPO_URL" "$CLONE_DIR"
fi

echo "==> Запуск deploy.sh"
cd "$CLONE_DIR"
exec bash ./deploy.sh "$@"

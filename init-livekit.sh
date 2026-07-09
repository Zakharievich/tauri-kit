#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Ошибка: не найдена команда '$1'" >&2
    exit 1
  }
}

require_cmd docker
require_cmd curl
require_cmd cut
require_cmd tr

PAIR="$(docker run --rm livekit/livekit-server generate-keys)"
API_KEY="$(printf '%s' "$PAIR" | cut -d':' -f1 | tr -d '[:space:]')"
API_SECRET="$(printf '%s' "$PAIR" | cut -d':' -f2- | tr -d '[:space:]')"

if [[ -z "$API_KEY" || -z "$API_SECRET" ]]; then
  echo "Ошибка: не удалось сгенерировать LIVEKIT_API_KEY/LIVEKIT_API_SECRET" >&2
  exit 1
fi

DETECTED_IP="$(curl -4fsS ifconfig.me || curl -4fsS icanhazip.com || curl -4fsS ipecho.net/plain || true)"
LK_HOST="${LK_HOST:-$DETECTED_IP}"

if [[ -z "$LK_HOST" ]]; then
  read -r -p "Введите IP или домен сервера: " LK_HOST
fi

if [[ -z "$LK_HOST" ]]; then
  echo "Ошибка: не удалось определить хост" >&2
  exit 1
fi

umask 077

# LK_HOST is used both as the LiveKit/token-server public hostname and as
# the domain Caddy requests a TLS certificate for (see Caddyfile). A real
# domain gets a trusted Let's Encrypt certificate automatically; a bare IP
# falls back to Caddy's self-signed internal CA (works, but shows an
# untrusted-cert warning) — see docs/README.md.
cat > "$ENV_FILE" <<EOF
LK_HOST=${LK_HOST}
LIVEKIT_URL=wss://${LK_HOST}
LIVEKIT_API_KEY=${API_KEY}
LIVEKIT_API_SECRET=${API_SECRET}
TOKEN_SERVER_PORT=3001
ALLOWED_ORIGIN=http://localhost:1420,tauri://localhost,http://tauri.localhost
EOF

echo "============================================"
echo "LK_HOST=${LK_HOST}"
echo "LIVEKIT_URL=wss://${LK_HOST}"
echo "LIVEKIT_API_KEY=${API_KEY}"
echo "LIVEKIT_API_SECRET=***hidden***"
echo ".env создан: ${ENV_FILE}"
echo "Теперь запусти: docker compose up -d"
echo "В клиенте укажи \"URL сервера\" = https://${LK_HOST}"
echo "============================================"

#!/usr/bin/env bash
set -e

# Генерируем пару API_KEY:API_SECRET
PAIR=$(docker run --rm livekit/livekit-server generate-keys)
API_KEY=$(echo "$PAIR" | cut -d':' -f1 | tr -d '[:space:]')
API_SECRET=$(echo "$PAIR" | cut -d':' -f2 | tr -d '[:space:]')

# Определяем внешний IP сервера
DETECTED_IP=$(curl -4 -s ifconfig.me || curl -4 -s icanhazip.com || curl -4 -s ipecho.net/plain)
LK_HOST="${LK_HOST:-$DETECTED_IP}"

if [ -z "$LK_HOST" ]; then
  read -p "Введите IP сервера [${DETECTED_IP}]: " LK_HOST
  LK_HOST="${LK_HOST:-$DETECTED_IP}"
  if [ -z "$LK_HOST" ]; then
    echo "Не удалось определить хост. Укажи его вручную."
    exit 1
  fi
fi

# Формируем .env для docker-compose
cat > .env <<EOF
LIVEKIT_URL=wss://${LK_HOST}:7880
LIVEKIT_API_KEY=${API_KEY}
LIVEKIT_API_SECRET=${API_SECRET}
TOKEN_SERVER_PORT=3001
EOF

echo "============================================"
echo " LIVEKIT_API_KEY=${API_KEY}"
echo " LIVEKIT_API_SECRET=${API_SECRET}"
echo " LIVEKIT_URL=wss://${LK_HOST}:7880"
echo " .env создан. Теперь запусти: docker compose up -d"
echo "============================================"

chmod +x init-livekit.sh

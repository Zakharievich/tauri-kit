cat > init-livekit.sh << 'EOF'
#!/usr/bin/env bash
set -e

# Генерируем пару API_KEY:API_SECRET через официальный livekit/livekit-server
PAIR=$(docker run --rm livekit/livekit-server generate-keys)
API_KEY=$(echo "$PAIR" | cut -d':' -f1 | tr -d '[:space:]')
API_SECRET=$(echo "$PAIR" | cut -d':' -f2 | tr -d '[:space:]')

# Спрашиваем домен/адрес для LiveKit (то, к чему будут подключаться клиенты)
read -p "Введите IP ващего сервера для LiveKit: " LK_HOST
if [ -z "$LK_HOST" ]; then
  echo "Хост обязателен, прерываем."
  exit 1
fi

# Формируем .env для docker-compose
cat > .env <<EOF2
LIVEKIT_URL=wss://${LK_HOST}:7880
LIVEKIT_API_KEY=${API_KEY}
LIVEKIT_API_SECRET=${API_SECRET}
TOKEN_SERVER_PORT=3001
EOF2

echo "============================================"
echo " LIVEKIT_API_KEY=${API_KEY}"
echo " LIVEKIT_API_SECRET=${API_SECRET}"
echo " LIVEKIT_URL=wss://${LK_HOST}:7880"
echo " .env создан. Теперь запусти: docker compose up -d"
echo "============================================"
EOF

chmod +x init-livekit.sh

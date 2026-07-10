#!/usr/bin/env bash
#
# One-shot server deployment for TauriKit (LiveKit SFU + token-server + Caddy).
# Collapses the manual VPS steps from docs/README.md (§2–§8) into a single,
# idempotent script: base packages, firewall, Docker, the systemd-networkd /
# Docker networking fix, key/.env generation (via init-livekit.sh) and
# `docker compose up`. Safe to re-run.
#
# NOT handled here (see docs/README.md): the DNS A-record (§1, done at your
# registrar before running this) and the desktop client build (§10–§11, per-OS
# on user machines — Tauri does not cross-compile).
#
# Usage:
#   sudo bash deploy.sh --domain conf.example.com
#   sudo bash deploy.sh                       # prompts for the domain
#
# Flags:
#   --domain <host>      Public domain (or bare IP) for LiveKit/Caddy/TLS.
#   --force              Regenerate .env even if one already exists.
#   --skip-network-fix   Skip the systemd-networkd / Docker networking fix.
#   --with-agent         (Not yet implemented) install the optional STT agent.
#   --yes                Non-interactive: never prompt, assume "yes".
#   -h, --help           Show this help.
set -euo pipefail

# --- run as root so docker / apt / systemctl work without per-command sudo,
#     and the generated .env is owned consistently. Re-exec via sudo if needed.
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" "$@"
  fi
  echo "Запустите скрипт от root или установите sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# --- pretty output --------------------------------------------------------
log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[ошибка]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '3,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# --- arguments ------------------------------------------------------------
DOMAIN="${LK_HOST:-}"
FORCE_ENV=0
SKIP_NETWORK_FIX=0
WITH_AGENT=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)          DOMAIN="${2:-}"; shift 2 ;;
    --domain=*)        DOMAIN="${1#*=}"; shift ;;
    --force)           FORCE_ENV=1; shift ;;
    --skip-network-fix) SKIP_NETWORK_FIX=1; shift ;;
    --with-agent)      WITH_AGENT=1; shift ;;
    --yes|-y)          ASSUME_YES=1; shift ;;
    -h|--help)         usage 0 ;;
    *) die "Неизвестный аргумент: $1 (см. --help)" ;;
  esac
done

confirm() {
  # confirm "question" -> 0 (yes) / 1 (no). Honors --yes and non-TTY.
  local prompt="$1"
  if [[ "$ASSUME_YES" -eq 1 ]]; then return 0; fi
  if [[ ! -t 0 ]]; then return 0; fi
  local reply
  read -r -p "$prompt [Y/n] " reply
  [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

# --- preflight ------------------------------------------------------------
log "Проверка окружения"
command -v apt-get >/dev/null 2>&1 || die "Нужен apt (Ubuntu/Debian). См. docs/README.md для других ОС."
[[ -f "$SCRIPT_DIR/init-livekit.sh" ]] || die "init-livekit.sh не найден рядом с deploy.sh — запускайте из клона репозитория."
[[ -f "$SCRIPT_DIR/docker-compose.yml" ]] || die "docker-compose.yml не найден — запускайте из корня репозитория."
ok "Окружение подходит (root, apt, файлы репозитория на месте)"

if [[ -z "$DOMAIN" ]]; then
  if [[ -t 0 ]]; then
    read -r -p "Введите домен сервера (например conf.example.com): " DOMAIN
  fi
fi
[[ -n "$DOMAIN" ]] || die "Не задан домен. Передайте --domain conf.example.com."

# --- §2 base packages -----------------------------------------------------
log "Установка базовых пакетов (curl, git, ufw, dnsutils)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ufw dnsutils
ok "Базовые пакеты установлены"

# --- DNS sanity check (§1 verification) -----------------------------------
log "Проверка DNS: домен должен указывать на этот сервер"
SERVER_IP="$(curl -4fsS ifconfig.me || curl -4fsS icanhazip.com || curl -4fsS ipecho.net/plain || true)"
RESOLVED_IP="$(dig +short A "$DOMAIN" 2>/dev/null | tail -n1 || true)"
info "Внешний IP сервера : ${SERVER_IP:-<не определён>}"
info "A-запись $DOMAIN → : ${RESOLVED_IP:-<не резолвится>}"
if [[ -z "$RESOLVED_IP" ]]; then
  warn "Домен $DOMAIN пока не резолвится. Let's Encrypt не сможет выпустить сертификат."
  confirm "Продолжить всё равно?" || die "Прервано. Создайте A-запись (docs/README.md §1) и запустите снова."
elif [[ -n "$SERVER_IP" && "$RESOLVED_IP" != "$SERVER_IP" ]]; then
  warn "A-запись ведёт на $RESOLVED_IP, а IP сервера $SERVER_IP — они не совпадают."
  confirm "Продолжить всё равно?" || die "Прервано. Поправьте A-запись и запустите снова."
else
  ok "Домен указывает на этот сервер"
fi

# --- §3 firewall ----------------------------------------------------------
log "Настройка firewall (ufw)"
ufw allow 22/tcp            >/dev/null   # SSH
ufw allow 80/tcp            >/dev/null   # Caddy: ACME HTTP-01 challenge
ufw allow 443/tcp           >/dev/null   # Caddy: HTTPS / WSS
ufw allow 7881/tcp          >/dev/null   # LiveKit RTC (TCP fallback)
ufw allow 50000:50100/udp   >/dev/null   # LiveKit RTC (UDP media)
ufw default deny incoming   >/dev/null
ufw default allow outgoing  >/dev/null
ufw --force enable          >/dev/null
ok "ufw включён (открыты 22, 80, 443, 7881/tcp, 50000-50100/udp)"

# --- §4 Docker ------------------------------------------------------------
log "Установка Docker"
if command -v docker >/dev/null 2>&1; then
  ok "Docker уже установлен ($(docker --version))"
else
  curl -fsSL https://get.docker.com | sh
  ok "Docker установлен"
fi
docker compose version >/dev/null 2>&1 || die "docker compose недоступен после установки Docker."

# Add the invoking (non-root) user to the docker group for future sessions.
TARGET_USER="${SUDO_USER:-}"
if [[ -n "$TARGET_USER" && "$TARGET_USER" != "root" ]]; then
  usermod -aG docker "$TARGET_USER" 2>/dev/null || true
  info "Пользователь $TARGET_USER добавлен в группу docker (применится в новой SSH-сессии)."
fi

# --- §4b systemd-networkd / Docker networking fix -------------------------
if [[ "$SKIP_NETWORK_FIX" -eq 1 ]]; then
  log "Сетевой фикс пропущен (--skip-network-fix)"
else
  log "Сетевой фикс для Docker (systemd-networkd, idempotent)"

  EXT_IF="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  [[ -n "$EXT_IF" ]] || warn "Не удалось определить внешний интерфейс; часть шагов будет пропущена."
  [[ -n "$EXT_IF" ]] && info "Внешний интерфейс: $EXT_IF"

  # Mark Docker's virtual interfaces Unmanaged so networkd's DHCP does not
  # steal their addressing (the root cause of containers losing the network).
  tee /etc/systemd/network/05-docker-veth.network >/dev/null <<'EOF'
[Match]
Name=veth*
Driver=veth

[Link]
Unmanaged=yes
EOF
  tee /etc/systemd/network/06-docker-bridge.network >/dev/null <<'EOF'
[Match]
Name=docker*

[Link]
Unmanaged=yes
EOF
  tee /etc/systemd/network/07-docker-compose-bridge.network >/dev/null <<'EOF'
[Match]
Name=br-*

[Link]
Unmanaged=yes
EOF

  # IPv4 forwarding — containers reach the internet through the VPS.
  tee /etc/sysctl.d/99-docker-forward.conf >/dev/null <<'EOF'
net.ipv4.ip_forward = 1
EOF

  # Docker resolver: only write if there is no daemon.json yet (never clobber
  # an existing one blindly — the user may have their own config).
  mkdir -p /etc/docker
  if [[ ! -s /etc/docker/daemon.json ]]; then
    tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "dns": ["1.1.1.1", "8.8.8.8"]
}
EOF
    info "Записан /etc/docker/daemon.json с DNS 1.1.1.1/8.8.8.8"
  elif grep -q '"dns"' /etc/docker/daemon.json; then
    info "/etc/docker/daemon.json уже задаёт dns — не трогаю"
  else
    warn "/etc/docker/daemon.json существует без ключа \"dns\" — добавьте \"dns\": [\"1.1.1.1\",\"8.8.8.8\"] вручную при проблемах с сетью."
  fi

  # Narrow the broad Name=* DHCP rule to the real NIC (the specific cloud-image
  # misconfig). Only if present; back up first. Idempotent (no Name=* → no-op).
  NETWORKD_FILE="/etc/systemd/network/10-all.network"
  if [[ -n "$EXT_IF" && -f "$NETWORKD_FILE" ]] && grep -qE '^[[:space:]]*Name=\*' "$NETWORKD_FILE"; then
    cp -a "$NETWORKD_FILE" "${NETWORKD_FILE}.bak"
    sed -i -E "s/^[[:space:]]*Name=\*.*/Name=${EXT_IF}/" "$NETWORKD_FILE"
    info "Сужено правило networkd в $NETWORKD_FILE до Name=$EXT_IF (бэкап: ${NETWORKD_FILE}.bak)"
  fi

  sysctl --system >/dev/null
  if systemctl is-active --quiet systemd-networkd; then
    systemctl restart systemd-networkd || warn "Не удалось перезапустить systemd-networkd"
  fi
  systemctl restart docker

  # Allow container egress through the firewall (host networking bypasses this
  # for LiveKit/Caddy, but bridge networks — e.g. the token-server build — need it).
  if [[ -n "$EXT_IF" ]]; then
    ufw route allow in on docker0 out on "$EXT_IF" >/dev/null 2>&1 || true
    ufw route allow in on "$EXT_IF" out on docker0 >/dev/null 2>&1 || true
    ufw reload >/dev/null 2>&1 || true
  fi
  ok "Сетевой фикс применён"

  # Definitive connectivity test: a container must reach the npm registry,
  # otherwise `docker compose up --build` will fail while fetching deps.
  log "Проверка сети из контейнера"
  if docker run --rm curlimages/curl:8.12.1 -sfI https://registry.npmjs.org/ >/dev/null 2>&1; then
    ok "Контейнер выходит в интернет (registry.npmjs.org доступен)"
  else
    warn "Контейнер не смог достучаться до registry.npmjs.org. Диагностика:"
    docker run --rm busybox ping -c 2 172.17.0.1 || true
    docker run --rm busybox ping -c 2 1.1.1.1 || true
    docker run --rm busybox nslookup registry.npmjs.org 1.1.1.1 || true
    die "Сеть контейнеров не работает — см. docs/README.md, раздел «Docker и systemd-networkd». Исправьте и запустите снова."
  fi
fi

# --- §6 keys + .env (reuse init-livekit.sh) -------------------------------
log "Генерация ключей LiveKit и .env"
if [[ -f "$SCRIPT_DIR/.env" && "$FORCE_ENV" -ne 1 ]]; then
  ok ".env уже существует — пропускаю (--force чтобы перегенерировать)"
else
  env LK_HOST="$DOMAIN" bash "$SCRIPT_DIR/init-livekit.sh"
  ok ".env создан для домена $DOMAIN"
fi

# --- §7 start the stack ---------------------------------------------------
log "Запуск стека (docker compose up -d --build)"
cd "$SCRIPT_DIR"
docker compose pull 2>/dev/null || true
docker compose up -d --build
ok "Контейнеры запущены"

# --- §9 optional agent (not implemented yet) ------------------------------
if [[ "$WITH_AGENT" -eq 1 ]]; then
  warn "Установка опционального STT-агента (--with-agent) пока не автоматизирована."
  warn "Следуйте docs/README.md §9 (agent/README_AGENT.md) вручную."
fi

# --- §8 verification ------------------------------------------------------
log "Проверка работоспособности"
TOKEN_PORT="$(grep -E '^TOKEN_SERVER_PORT=' "$SCRIPT_DIR/.env" | cut -d= -f2 || echo 3001)"
TOKEN_PORT="${TOKEN_PORT:-3001}"

info "Жду, пока token-server станет healthy…"
HEALTHY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${TOKEN_PORT}/health" >/dev/null 2>&1; then
    HEALTHY=1; break
  fi
  sleep 2
done
if [[ "$HEALTHY" -eq 1 ]]; then
  ok "token-server отвечает на /health (локально)"
else
  warn "token-server пока не отвечает. Логи: docker compose logs -f token-server"
fi

info "Проверяю публичный HTTPS (сертификат может ещё выпускаться)…"
if curl -fsS --max-time 15 "https://${DOMAIN}/health" >/dev/null 2>&1; then
  ok "https://${DOMAIN}/health отвечает — TLS работает"
else
  warn "https://${DOMAIN}/health пока недоступен. При первом запуске Caddy выпускает сертификат —"
  warn "подождите минуту и проверьте: docker compose logs -f caddy"
fi

# --- summary --------------------------------------------------------------
log "Готово"
cat <<EOF
Сервер развёрнут.

  • URL сервера для клиента:  https://${DOMAIN}
  • LiveKit (WSS):            wss://${DOMAIN}
  • token-server:            https://${DOMAIN}/token

Дальше:
  1. Соберите или скачайте десктоп-клиент (docs/README.md §10, Releases).
  2. В клиенте укажите «URL сервера» = https://${DOMAIN} и создайте комнату.

Полезные команды:
  docker compose ps
  docker compose logs -f caddy
  docker compose logs -f livekit
  docker compose logs -f token-server
EOF

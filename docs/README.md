# Развёртывание и запуск TauriKit

Инструкция по развёртыванию серверной части на VPS (**Ubuntu 24.04**) и сборке десктоп‑клиента.

## Архитектура

На VPS размещаются серверные компоненты; десктопный клиент устанавливается на машинах пользователей (Windows/Linux/macOS).

1. **LiveKit SFU** — self‑hosted медиасервер, к которому подключаются клиенты по WSS/WebRTC.
2. **Token‑server** (`server/`) — Node.js‑сервис, выдающий короткоживущие (TTL 1ч) JWT‑токены по `POST /token`.
3. **Caddy** — reverse‑proxy: терминирует TLS на 80/443 и проксирует на LiveKit и token‑server. Автоматически получает и продлевает сертификат Let's Encrypt.
4. **Python‑агент** (`agent/`) — опциональный скрытый участник комнаты (STT + саммари); его отсутствие не мешает звонку.
5. **Tauri‑клиент** — десктопное приложение; получает токен у token‑server, подключается к LiveKit, при необходимости сохраняет транскрипт локально.

```
Клиент ──HTTPS /token──┐
Клиент ──WSS /  ───────┤   :443  ┌─────────┐   127.0.0.1:3001   ┌──────────────┐
                       ├────────▶│  Caddy  │───────────────────▶│ token-server │
                       │  (TLS)  │ (proxy) │───────────────────▶│   LiveKit    │
Клиент ──UDP 50000-50100 / TCP 7881 (медиа, напрямую)          └──────────────┘
```

## Важно прочитать до начала

**Вам нужен домен** (например `conf.example.com`), а не голый IP. Caddy автоматически выпускает **доверенный** TLS‑сертификат Let's Encrypt только для домена. С голым IP Caddy выдаёт самоподписанный сертификат, который WebView десктоп‑клиента отвергнет при `wss://`‑подключении — звонок не установится (обойти можно лишь установкой корневого CA Caddy на каждый клиент — не рекомендуется). Инструкция ниже идёт по варианту с доменом.

## Системные требования

| | Базовая конфигурация (звонки + чат + E2EE) | С опциональным агентом (STT + саммари) |
|---|---|---|
| VPS ОС | Ubuntu 24.04 | то же |
| RAM (сервер) | от 1 GB | от 5 GB (+4 GB на STT/саммари) |
| Диск | ~1 GB (образы Docker) | + ~1.5 GB (модели whisper `tiny` + `qwen2.5:0.5b`) |
| ПО (сервер) | Docker Engine + compose | + Python 3.10+, Ollama |
| Клиент ОС | Windows 10+/Linux/macOS 11+ | то же |

Порты, открываемые наружу:

| Компонент                  | Порт/диапазон | Протокол | Назначение |
| --------------------------- | ------------- | -------- | ---------- |
| Caddy                       | 80            | TCP      | ACME HTTP‑01 challenge (выпуск сертификата) |
| Caddy                       | 443           | TCP      | HTTPS / WSS |
| LiveKit RTC (TCP fallback)  | 7881          | TCP      | медиа, когда UDP недоступен |
| LiveKit RTC (UDP media)     | 50000–50100   | UDP      | основной медиа‑трафик |

LiveKit API/WS (7880) и token‑server (3001) наружу **не** публикуются — они доступны только через Caddy на 80/443. Порты 8000 (faster‑whisper) и 11434 (Ollama) остаются только для локального доступа.

---

## Шаг 1. Домен (DNS)

Создайте **A‑запись**, указывающую на IP вашего VPS:

```
conf.example.com.  A  <IP-вашего-VPS>
```

Дождитесь распространения — `dig conf.example.com +short` должен вернуть IP сервера. Без этого Let's Encrypt не выпустит сертификат.

## Шаг 2. Базовая настройка сервера

Зайдите по SSH и обновите систему:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw
```

Опционально (хардненинг — удаление ненужных сетевых сервисов):
```bash
sudo apt --purge remove -y xinetd nis yp-tools tftpd atftpd tftpd-hpa telnetd rsh-server rsh-redone-server 2>/dev/null || true
```

## Шаг 3. Firewall (ufw)

Открываем **только** нужные порты. LiveKit (7880) и token‑server (3001) наружу НЕ открываются — только через Caddy:

```bash
sudo ufw allow 22/tcp            # SSH
sudo ufw allow 80/tcp            # Caddy: ACME HTTP-01 challenge
sudo ufw allow 443/tcp           # Caddy: HTTPS / WSS
sudo ufw allow 7881/tcp          # LiveKit RTC (TCP fallback)
sudo ufw allow 50000:50100/udp   # LiveKit RTC (UDP media)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status
```

> В `docker-compose.yml` LiveKit и Caddy используют `network_mode: host` (рекомендация LiveKit — меньше NAT‑накладных на UDP). Благодаря host‑сети правила ufw применяются напрямую, а не обходятся Docker'ом. Если у облачного провайдера есть свой security group / firewall — откройте те же порты и там.

## Шаг 4. Установка Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

**Перелогиньтесь по SSH** (чтобы применилась группа `docker`), затем проверьте:
```bash
docker --version && docker compose version
```

### Docker и systemd-networkd (Ubuntu 24.04 / cloud-образы)

На некоторых cloud-образах VPS systemd-networkd содержит правило с широким матчем (`Name=*` + `Type=ether` в `/etc/systemd/network/10-all.network`), которое применяет DHCP ко **всем** Ethernet-интерфейсам, включая виртуальные интерфейсы Docker (`veth*`, `docker0`, `br-*`). Из-за этого у контейнеров пропадает выход в сеть, и `docker compose up -d --build` падает при скачивании зависимостей.

> Это не специфично для Ubuntu как таковой: широкое правило приносит cloud-образ провайдера вместе с systemd-networkd (на Ubuntu Server встречается чаще всего). На Debian с классическим `ifupdown` обычно не воспроизводится, но Debian на systemd-networkd с таким же матчем словит то же самое. Фикс ниже — сузить networkd до реального NIC и пометить интерфейсы Docker `Unmanaged=yes` — универсален для любого дистрибутива.

Если столкнулись с этим на своём VPS — после установки Docker выполните шаги ниже.

### Проверить внешний интерфейс

```bash
ip route get 1.1.1.1
```
В выводе будет имя внешнего интерфейса (часто `eth0`). Если у вас он называется иначе — подставляйте своё имя вместо `eth0` в командах ниже.

### Убрать широкое правило networkd
Сначала сохранить резервную копию:
```bash
sudo cp -a /etc/systemd/network/10-all.network /etc/systemd/network/10-all.network.bak
```
Затем отредактировать файл:
```bash
sudo nano /etc/systemd/network/10-all.network
```
Было неправильно:
```
[Match]
  Name=* Type=ether 
[Network]
  DHCP=ipv4
```
Должно быть так — networkd обслуживает только сетевую карту VPS:
```
[Match]
  Name=eth0
[Network]
  DHCP=ipv4
```

**Не использовать Name=* и Type=ether для DHCP на сервере с Docker: Docker создаёт виртуальные Ethernet-интерфейсы для контейнеров.**

### Исключить интерфейсы Docker
Это дополнительная защита от повторения проблемы:
```bash
sudo tee /etc/systemd/network/05-docker-veth.network >/dev/null <<'EOF'
[Match]
Name=veth*
Driver=veth

[Link]
Unmanaged=yes
EOF
```
```bash
sudo tee /etc/systemd/network/06-docker-bridge.network >/dev/null <<'EOF'
[Match]
Name=docker*

[Link]
Unmanaged=yes
EOF
```
```bash
sudo tee /etc/systemd/network/07-docker-compose-bridge.network >/dev/null <<'EOF'
[Match]
Name=br-*

[Link]
Unmanaged=yes
EOF
```
Так systemd-networkd не будет пытаться самостоятельно настраивать:
docker0 — стандартный bridge Docker;
br-* — bridge-сети Docker Compose;
veth* — виртуальные концы сетевых интерфейсов контейнеров.

### Включить маршрутизацию IPv4
Docker-контейнерам нужен forwarding, чтобы выходить через VPS в интернет:
```bash
sudo tee /etc/sysctl.d/99-docker-forward.conf >/dev/null <<'EOF'
net.ipv4.ip_forward = 1
EOF
sudo sysctl --system
```
Проверка:
```bash
sysctl net.ipv4.ip_forward
```
Нужен результат:
```
net.ipv4.ip_forward = 1
```

### Перезапустить сеть и Docker
Перед этим лучше открыть вторую SSH-сессию, чтобы не потерять доступ при ошибке сетевой конфигурации.
```bash
sudo systemctl restart systemd-networkd
sudo systemctl restart docker
```

### Настроить DNS Docker
```bash
cd /etc/docker
sudo tee daemon.json >/dev/null <<'EOF'
{
  "dns": ["1.1.1.1", "8.8.8.8"]
}
EOF
sudo systemctl restart docker
```

**Не добавлять туда "iptables": false: Docker должен сам создавать правила NAT и маршрутизации для bridge-сетей.**

### Прокинуть правила UFW в Docker
Для исходящего трафика контейнеров в интернет:
```bash
sudo ufw route allow in on docker0 out on eth0
sudo ufw route allow in on eth0 out on docker0
sudo ufw reload
```

### Контрольные тесты
После установки Docker всегда проверьте сеть контейнера до сборки приложения:
```bash
docker run --rm busybox ping -c 2 172.17.0.1
docker run --rm busybox ping -c 2 1.1.1.1
docker run --rm busybox nslookup registry.npmjs.org 1.1.1.1
docker run --rm curlimages/curl:8.12.1 -I https://registry.npmjs.org/
```

Успешный последний тест должен вернуть примерно:
```
HTTP/2 200
```

**Только после этого имеет смысл запускать docker compose up -d --build в Шаг 7**

## Шаг 5. Клонирование репозитория

```bash
cd ~
git clone https://github.com/Zakharievich/tauri-kit.git
cd tauri-kit
```

## Шаг 6. Генерация ключей и `.env`

Скрипт `init-livekit.sh` генерирует API‑ключ/секрет LiveKit и создаёт `.env`. **Передайте свой домен через переменную `LK_HOST`** — иначе скрипт подставит голый IP (см. предупреждение выше):

```bash
chmod +x ./init-livekit.sh
LK_HOST=conf.example.com bash ./init-livekit.sh
cat .env
```

Ожидаемый результат (`.env` уже покрыт `.gitignore` — секреты в git не попадут):
```
LK_HOST=conf.example.com
LIVEKIT_URL=wss://conf.example.com
LIVEKIT_API_KEY=APIxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxx
TOKEN_SERVER_PORT=3001
ALLOWED_ORIGIN=http://localhost:1420,tauri://localhost,http://tauri.localhost
```

## Шаг 7. Запуск стека

Docker Compose сам соберёт образ token‑server из `server/Dockerfile` (отдельный `docker build` не нужен):

```bash
docker compose pull
docker compose up -d --build
```

При первом запуске Caddy обратится к Let's Encrypt и выпустит сертификат для вашего домена (нужны открытые 80/443 и корректная A‑запись).

## Шаг 8. Проверка

```bash
docker compose ps                     # все сервисы Up; token-server — healthy
docker compose logs -f caddy          # успешный выпуск сертификата, без ошибок ACME
docker compose logs -f livekit
```

С любой машины:
```bash
curl https://conf.example.com/health   # ожидаем {"status":"ok"}
```

Готово: LiveKit доступен по `wss://conf.example.com`, token‑server — по `https://conf.example.com/token`.

---

## Шаг 9 (опционально). Python‑агент STT/саммари

Агент **не обязателен** — без него звонки, чат, демонстрация экрана и E2EE работают полностью, недоступна лишь транскрипция.

```bash
cd ~/tauri-kit/agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Ollama (саммари) + модель
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:0.5b

# faster-whisper-server (STT) на localhost:8000 (модель tiny скачается сама)
uvicorn faster_whisper_server.app:app --port 8000

# .env агента — ключи ДОЛЖНЫ совпадать с корневым .env
cp .env.example .env
python main.py dev
```

Переменные окружения агента (`agent/.env`):

| Переменная           | Обязательна | Значение |
| -------------------- | ----------- | -------- |
| `LIVEKIT_URL`        | да          | совпадает с `LIVEKIT_URL` из корневого `.env` |
| `LIVEKIT_API_KEY`    | да          | совпадает с корневым `.env` |
| `LIVEKIT_API_SECRET` | да          | совпадает с корневым `.env` |
| `ENABLE_STT`         | нет (`true`)| при `false` агент не подключается к комнате |
| `FASTER_WHISPER_URL` | нет         | по умолчанию `http://localhost:8000/v1` |
| `FASTER_WHISPER_MODEL`| нет        | по умолчанию `tiny`; при плохом звуке — `small` |
| `ENABLE_SUMMARY`     | нет (`true`)| запрос саммари в Ollama по завершении сессии |
| `OLLAMA_URL`         | нет         | по умолчанию `http://localhost:11434` |
| `OLLAMA_MODEL`       | нет         | по умолчанию `qwen2.5:0.5b` |

Порты 8000 и 11434 остаются только на localhost — наружу их открывать не нужно.

---

## Шаг 10. Сборка десктоп‑клиента

Клиент собирается **на отдельной машине** под каждую ОС (Tauri не кросс‑компилирует инсталляторы). На VPS клиент не собирается.

Есть два пути:

**A. Скачать готовый установщик** со страницы [Releases](https://github.com/Zakharievich/tauri-kit/releases) (собирается автоматически по тегу `vX.Y.Z`):
- Windows: `.exe` (NSIS)
- Linux: `.AppImage`
- macOS: `.dmg`

**B. Собрать из исходников** на своём ПК. Зависимости: Node.js 18+, pnpm, [Rust + Tauri CLI](https://tauri.app/start/prerequisites/).
```bash
git clone https://github.com/Zakharievich/tauri-kit.git
cd tauri-kit
pnpm install
pnpm tauri build
```
Артефакты:
- Windows: `src-tauri/target/release/bundle/nsis/*.exe`
- Linux: `src-tauri/target/release/bundle/appimage/*.AppImage`
- macOS: `src-tauri/target/release/bundle/dmg/*.dmg` (для дистрибуции за пределами своей машины нужна подпись Apple)

## Шаг 11. Использование клиента

После установки в форме подключения:

- **URL сервера** — базовый URL token‑server, **без** `/token` в конце (клиент добавит путь сам): `https://conf.example.com`
- **Имя комнаты** — произвольное, одинаковое у всех участников (например `team-daily`).
- **Ваше имя** — уникальный идентификатор участника (попадает в JWT).
- **Шифрование (E2EE)** — опционально; ключ создаётся у хоста локально и передаётся остальным вне приложения (out‑of‑band). При включённом E2EE транскрипция недоступна.
- **Транскрибация речи** — опционально; работает только если на сервере запущен Python‑агент. Взаимоисключает с E2EE.

Для звонка на 2+ человек у всех участников должны совпадать «URL сервера» и «Имя комнаты». По завершении сессии кнопка **«Сохранить .txt»** пишет транскрипт (если был) в папку Documents.

---

## Обновление проекта на сервере

```bash
cd ~/tauri-kit
git pull
docker compose up -d --build
```

## Диагностика частых проблем

| Симптом | Причина / что проверить |
|--------|--------------------------|
| Клиент не подключается, в логах Caddy ошибки ACME | Домен не резолвится на сервер, или закрыт порт 80/443. Проверьте `dig домен`, `ufw status`, security group провайдера. |
| «Ошибка подключения к token‑server» / CORS | `ALLOWED_ORIGIN` в `.env` должен содержать `tauri://localhost,http://tauri.localhost`; после правки `.env` — `docker compose up -d`. |
| Подключается, но участники не видят/не слышат друг друга | Закрыт UDP `50000–50100` или TCP `7881` (в ufw и/или у провайдера). |
| Токен отвергается, никто не входит в комнату | Ключ/секрет LiveKit не совпадает с token‑server. Сверьте `docker compose logs livekit` и значения в `.env`. |
| Самоподписанный сертификат (использован IP) | Перегенерируйте `.env` с доменом: `LK_HOST=домен bash ./init-livekit.sh`, затем `docker compose up -d`. |

## Проверка работоспособности

```bash
docker compose logs -f livekit
docker compose logs -f token-server
docker compose logs -f caddy
```

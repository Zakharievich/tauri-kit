## Архитектура
На VPS размещаются серверные компоненты; десктопный клиент устанавливается на машинах пользователей (Windows/Linux/macOS).
1. LiveKit SFU — self‑hosted медиасервер, к которому подключаются клиенты по WSS/WebRTC.
2. Token‑server (server/) — Node.js‑сервис, выдающий одноразовые JWT‑токены по POST /token.
3. Python‑агент (agent/) — опциональный скрытый участник комнаты LiveKit, делающий STT через faster-whisper-server и саммари через Ollama; его отсутствие не мешает звонку.
4. Tauri‑клиент — десктопное приложение; получает токен у token‑server, подключается к LiveKit, при необходимости сохраняет транскрипт локально.

## Системные требования

| | Базовая конфигурация (звонки + чат + E2EE) | С опциональным агентом (STT + саммари) |
|---|---|---|
| ОС | Windows 10+/Linux/macOS 11+ | то же |
| RAM | от 2 GB свободных | от 6 GB свободных (+4 GB на STT/саммари) |
| Диск | ~200 MB (клиент + зависимости) | + ~1.5 GB (модели whisper `tiny` + `qwen2.5:0.5b`) |
| CPU | любой современный x64/ARM | тоже CPU-only, GPU не требуется |
| Сеть | доступ к LiveKit SFU и token-серверу | + доступ к faster-whisper-server и Ollama |
| ПО | Node.js 18+, pnpm, Rust + Tauri CLI, Docker (для LiveKit) | + Python 3.10+, Ollama |

Порты, которые должны быть открыты наружу:

| Компонент         | Порт/диапазон | Протокол |
| ----------------- | ------------- | -------- |
| LiveKit API/WS    | 7880          | TCP      |
| LiveKit RTC (TCP) | 7881          | TCP      |
| LiveKit RTC (UDP) | 50000–50100   | UDP      |
| Token‑server      | 3001          | TCP      |

Порты 8000 (faster‑whisper) и 11434 (Ollama) оставляются
только для локального доступа — агент обращается к ним по localhost.

## Установка зависимостей
1.1.1 Вход на сервер уже должен быть уже реализован по SSH.
Обновляем систему, устанавливаем базовые инструменты:
```bash
sudo apt update && sudo apt upgrade -y
apt --purge remove -y xinetd nis yp-tools tftpd atftpd tftpd-hpa telnetd rsh-server rsh-redone-server
sudo apt install -y curl git ufw
```

1.2.1 Установка Docker Engine:
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

1.3.1 После этого перелогиниваемся по SSH.

1.4.1 Открываем нужные порты:
```bash
sudo ufw allow 22/tcp          # SSH
sudo ufw allow 7880/tcp        # LiveKit API/WS
sudo ufw allow 7881/tcp        # RTC TCP
sudo ufw allow 50000:50100/udp # RTC UDP
sudo ufw allow 3001/tcp        # token-server
sudo ufw allow 80
sudo ufw allow 443
ufw default deny incoming
ufw default allow outgoing
sudo ufw enable
sudo ufw status
```

1.5.1 Клонирование репозитория:
```bash
cd ~
mkdir -p projects
cd projects
git clone https://github.com/Zakharievich/tauri-kit.git
cd tauri-kit
```

1.6.1 Запуск стека. Генерируем ключи и создаём .env :
```bash
chmod +x ./init-livekit.sh
bash ./init-livekit.sh
ls -la .env   # проверяем создались ли ключи
cat .env
```

Сгенерированные значение LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL и TOKEN_SERVER_PORT будут использованы из .env дальше при вызове docker compose.

1.6.2 Поднимаем LiveKit + token-server:
```bash
docker compose pull
docker compose up -d
```

1.6.3 Проверяем:
```bash
docker compose ps
```

## После этого:
- LiveKit SFU доступен на wss://<IP-сервера>:7880.
- token‑server отдаёт токены по http://<IP-сервера>:3001/token.

## Опциональный Python‑агент (agent/).
Агент полностью опционален — без него звонки, чат и E2EE работают без ограничений; транскрипция и саммари просто будут недоступны.
Требования
- Python 3.10+, RAM от 4 GB.
- Disk: +500 MB (только STT tiny) или +1 GB (STT + саммари qwen2.5:0.5b).

1.7.1 Установка:
```bash
cd ~/tauri-kit/agent

python -m venv .venv
source .venv/bin/activate   # Linux/macOS

pip install -r requirements.txt
cp .env.example .env
```

1.7.2 Установка Ollama и модели:
```bash
ollama pull qwen2.5:0.5b
```

1.7.3 Запуск faster-whisper-server
```bash
uvicorn faster_whisper_server.app:app --port 8000   # модель tiny скачается автоматически при первом запуске.
```

1.7.4 Настройка agent/.env :

| Переменная           | Обязательна | Значение                                         |
| -------------------- | ----------- | ------------------------------------------------ |
| LIVEKIT_URL          | да          | совпадает с LIVEKIT_URL из корневого .env        |
| LIVEKIT_API_KEY      | да          | совпадает с LIVEKIT_API_KEY из корневого .env    |
| LIVEKIT_API_SECRET   | да          | совпадает с LIVEKIT_API_SECRET из корневого .env |
| ENABLE_STT           | нет (true)  | при false агент не подключается к комнате        |
| FASTER_WHISPER_URL   | нет         | по умолчанию http://localhost:8000/v1            |
| FASTER_WHISPER_MODEL | нет         | по умолчанию tiny; при плохом звуке — small      |
| ENABLE_SUMMARY       | нет (true)  | запрос саммари в Ollama по завершении сессии     |
| OLLAMA_URL           | нет         | по умолчанию http://localhost:11434              |
| OLLAMA_MODEL         | нет         | по умолчанию qwen2.5:0.5b                        |

1.7.5 Запуск агента:
```bash
cd ~/tauri-kit/agent
source .venv/bin/activate
python main.py dev
```

Агент подключается к комнате как скрытый участник agent-transcriber, подписывается только на аудио и не публикует свои медиапотоки. E2EE и Transcription — взаимоисключающие режимы: при включённом E2EE агент физически не может расшифровать медиапоток.


## Сборка и установка десктоп‑клиента.
Сборка выполняется на отдельной машине (Windows/Linux/macOS) — Tauri не поддерживает кросс‑компиляцию инсталляторов из коробки.
Зависимости: Node.js 18+, pnpm.
Rust + Tauri CLI: https://tauri.app/start/prerequisites/

```bash
cd tauri-kit
pnpm install
cd server && pnpm install && cd ..
```

## Сборка
1.8.1 Разработка:
```bash
pnpm tauri dev
```

1.8.2 Продакшен:
```bash
pnpm tauri build
```

## Артефакты:
Windows: src-tauri/target/release/bundle/msi/*.msi и .../nsis/*.exe

Linux: src-tauri/target/release/bundle/appimage/*.AppImage

macOS: src-tauri/target/release/bundle/dmg/*.dmg (для дистрибуции за пределами своей машины потребуется подпись Apple)


## Использование клиента:
После запуска установленного клиента открывается страница подключения:

1.9.1 "URL сервера" — базовый URL token‑server: http://<IP сервера>:3001 (если без reverse‑proxy).

1.9.2 "Имя комнаты" (roomName) — произвольное имя комнаты (например team-daily). Все участники с одинаковым roomName оказываются в одной комнате.

1.9.3 "Ваше имя" (identity) — уникальный ID участника в комнате (например Stepan). Попадает в JWT‑токен.

1.9.4 "Шифрование" — включает сквозное шифрование медиапотоков. Ключ остаётся только на стороне клиента, на сервер не передаётся. При включённом E2EE транскрипция недоступна.

1.9.5 "Транскрибация речи" — включает передачу транскрипта от Python‑агента. Взаимоисключает с E2EE. При включённой транскрипции и запущенном агенте по завершении звонка появится страница TranscriptPage с сегментами [HH:MM:SS] текст и, при ENABLE_SUMMARY=true, кратким саммари. Если агент не запущен или недоступны faster-whisper-server/Ollama — звонок продолжает работать в обычном режиме без транскрипта (graceful degradation).

1.9.6 Кнопка "Присоединиться" — Клиент отправляет POST {Server URL}/token с телом { identity, roomName } и получает { token, wsUrl } для подключения к LiveKit.

1.9.7 Кнопка "Сохранить .txt" — появляется по завершению сессии и сохраняет транскрипт в директорию Documents через Tauri‑команду save_transcript; возвращает абсолютный путь к файлу.


## Проверка работоспособности
1.10.1 посмотреть логи:
```bash
docker compose logs -f livekit
```

1.10.2 убедиться что token-server отвечает:
```bash
curl http://localhost:3001/health
```

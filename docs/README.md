# tauri-kit

Кроссплатформенное приложение для аудио/видеозвонков.
Стек: **Tauri 2 + React + TypeScript + LiveKit (self-hosted SFU)**.

## Функциональность

- Аудио/видеозвонки нескольких участников на базе self-hosted LiveKit SFU.
- Демонстрация экрана.
- Встроенный чат (LiveKit DataChannel, `lk-chat-topic`).
- E2EE (сквозное шифрование медиапотоков через `ExternalE2EEKeyProvider`).
- Сохранение транскрипта звонка в `.txt`-файл локально у участника (Tauri
  IPC-команда `save_transcript`).
- **STT и саммари — опционально.** Распознавание речи и автоматическое
  саммари звонка обеспечивает отдельный Python-агент (`agent/`), который
  можно не запускать вообще — основной звонок при этом работает без каких-
  либо ограничений (graceful degradation). E2EE и транскрипция —
  взаимоисключающие опции (агент физически не может расшифровать медиапоток
  при включённом E2EE).

Подробное архитектурное описание — в [ARCHITECTURE.md](./ARCHITECTURE.md),
план разработки и зафиксированные решения — в [PLAN.md](./PLAN.md).

## Системные требования

| | Базовая конфигурация (звонки + чат + E2EE) | С опциональным агентом (STT + саммари) |
|---|---|---|
| ОС | Windows 10+/Linux/macOS 11+ | то же |
| RAM | от 2 GB свободных | от 6 GB свободных (+4 GB на STT/саммари) |
| Диск | ~200 MB (клиент + зависимости) | + ~1.5 GB (модели whisper `tiny` + `qwen2.5:0.5b`) |
| CPU | любой современный x64/ARM | тоже CPU-only, GPU не требуется |
| Сеть | доступ к LiveKit SFU и token-серверу | + доступ к faster-whisper-server и Ollama |
| ПО | Node.js 18+, pnpm, Rust + Tauri CLI, Docker (для LiveKit) | + Python 3.10+, Ollama |

## Установка и запуск

### 1. Установка зависимостей

```bash
pnpm install
cd server && pnpm install && cd ..
```

Rust/Tauri toolchain должен быть установлен согласно
[официальной инструкции Tauri](https://tauri.app/start/prerequisites/).

### 2. Запуск LiveKit (self-hosted SFU)

Пример `docker-compose.yml` для локального запуска LiveKit:

```yaml
version: "3.9"
services:
  livekit:
    image: livekit/livekit-server:latest
    command: --dev --bind 0.0.0.0
    ports:
      - "7880:7880"      # LiveKit API/WS
      - "7881:7881"      # RTC TCP
      - "50000-50100:50000-50100/udp"  # RTC UDP
    environment:
      - LIVEKIT_KEYS=devkey:devsecret
```

```bash
docker compose up -d
```

`--dev` поднимает LiveKit с ключами `devkey`/`devsecret` — используйте их же
в `server/.env` (`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`) для локальной
разработки. Для продакшена сгенерируйте собственные ключи и настройте TLS.

### 3. Запуск token server

```bash
cd server
cp src/.env.example .env   # заполнить LIVEKIT_URL / KEY / SECRET
pnpm dev                   # разработка (tsx watch)
# или
pnpm build && pnpm start   # продакшен
```

Сервер поднимается на `http://localhost:3001` (см. `PORT` в `.env`) и
отдаёт одноразовые токены (`POST /token`, TTL 1 час, HIGH RISK — см.
`PLAN.md` §4.1).

### 4. Сборка и запуск Tauri-клиента

Разработка:

```bash
pnpm tauri dev
```

Продакшен-сборка:

```bash
pnpm tauri build
```

## Опциональный агент

Python-агент (`agent/`) подключается к комнате как скрытый участник и
обеспечивает распознавание речи (faster-whisper-server, модель `tiny`) и
опциональное саммари (Ollama, `qwen2.5:0.5b`). Полностью опционален:
отсутствие или сбой агента не мешает обычному звонку.

Подробности установки, запуска, переменных окружения и протокола передачи
транскрипта — в [agent/README_AGENT.md](../agent/README_AGENT.md).

## Сборка клиента под разные платформы

`pnpm tauri build` собирает нативные пакеты под текущую ОС. Для
кросс-платформенной сборки нужно запускать сборку на соответствующей ОС
(или в CI-раннерах с нужной ОС) — Tauri не поддерживает кросс-компиляцию
инсталляторов "из коробки".

### Windows (.exe / .msi)

```bash
pnpm tauri build
```

Готовые артефакты: `src-tauri/target/release/bundle/msi/*.msi` и
`src-tauri/target/release/bundle/nsis/*.exe`.

### Linux (.AppImage)

Требуются системные зависимости для сборки Tauri (WebKitGTK и др., см.
[Tauri prerequisites для Linux](https://tauri.app/start/prerequisites/#linux)).

```bash
pnpm tauri build
```

Артефакт: `src-tauri/target/release/bundle/appimage/*.AppImage`.

### macOS (.dmg)

```bash
pnpm tauri build
```

Артефакт: `src-tauri/target/release/bundle/dmg/*.dmg`. Для распространения
за пределами своей машины потребуется подпись (codesign) и нотаризация
Apple.

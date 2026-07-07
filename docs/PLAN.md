# tauri-kit — План разработки

> Кроссплатформенное приложение для аудио/видеозвонков.
> Стек: **Tauri 2 + React + TypeScript + LiveKit (self-hosted SFU)**.

Статус на момент написания: репозиторий инициализируется с нуля, ни один из
модулей (`src/`, `src-tauri/`, `server/`, `agent/`, `docs/`, `.github/`) ещё
не создан. Документ фиксирует согласованную структуру и порядок работ.

---

## 1. Структура репозитория

```
tauri-kit/
├─ src/                      # React + TS фронтенд (UI + клиентская логика LiveKit)
│  ├─ components/            # чистые UI-компоненты (VideoTile, Chat, Controls…)
│  ├─ hooks/                 # useRoom, useMedia, useChat, useE2EE
│  ├─ pages/                 # Lobby (JoinPage), Room, PostCall
│  ├─ services/              # livekit-client, token-api, e2ee-provider, tauri-ipc
│  ├─ store/                 # Zustand: useRoomStore, useChatStore, useSettingsStore
│  └─ types/                 # общие TS-типы (DTO токена, chat message, config)
│
├─ src-tauri/                # Rust — нативная оболочка
│  ├─ src/commands/          # IPC-команды (save_transcript, get_app_config…)
│  ├─ src/lib.rs / main.rs
│  ├─ tauri.conf.json        # capabilities, permissions, CSP
│  └─ Cargo.toml
│
├─ server/                   # Token server (Node.js + TypeScript, pnpm)
│  ├─ src/routes/            # POST /token, room lifecycle
│  ├─ src/services/          # JWT (livekit-server-sdk), room manager
│  ├─ src/config/            # env-валидация (zod)
│  └─ package.json
│
├─ agent/                    # ОПЦИОНАЛЬНЫЙ Python-агент
│  ├─ agent.py               # LiveKit Agents entrypoint
│  ├─ stt/                   # обёртка faster-whisper-server (tiny)
│  ├─ summary/               # обёртка Ollama qwen2.5:0.5b
│  ├─ .env.example           # ENABLE_STT / ENABLE_SUMMARY
│  └─ requirements.txt
│
├─ docs/                     # README, ARCHITECTURE, TESTING, AI_GUIDELINES, PLAN (этот файл)
├─ .github/workflows/        # CI (pnpm install → lint → build → test)
├─ .gitignore                # все .env, target/, node_modules/, dist/
└─ .clinerules
```

Единый пакетный менеджер — **pnpm**, используется и во фронтенде, и в `server/`
(упрощает CI: один кэш, одна версия lockfile).

---

## 2. Модули и их ответственность (SOLID)

### `src/` — React frontend
Отвечает только за представление и оркестрацию UI. Бизнес-логика вынесена в
`hooks/` и `services/`, компоненты в неё не лезут напрямую.
- `services/livekit` — инкапсулирует LiveKit SDK (комнаты, треки, DataChannel).
- `services/token-api` — общение с token-сервером.
- `services/e2ee` — работа с `ExternalE2EEKeyProvider` и обменом ключом.
- `services/tauri-ipc` — вызовы Rust-команд (сохранение файла и т.п.).
- `store/` (Zustand) — `useRoomStore` (состояние комнаты/участников),
  `useChatStore` (сообщения), `useSettingsStore` (флаги E2EE / Transcription,
  взаимоисключение между ними).
- `hooks/` — тонкий связующий слой между store/services и компонентами.

### `src-tauri/` — Rust (Tauri команды)
Отвечает за нативные операции, недоступные из webview: запись `.txt` на диск,
чтение конфигурации, ограниченный доступ к ФС. Все команды типизированы,
ошибки обрабатываются явно (`Result`), права доступа минимальны через
`tauri.conf.json` capabilities + строгий CSP.

### `server/` — Token server (Node.js + TS)
Единственная ответственность — выдача одноразовых JWT-токенов LiveKit и
управление жизненным циклом комнаты. **Не хранит** данные пользователей,
чат или историю сессий. Env-конфигурация валидируется (zod) при старте.

### `agent/` — опциональный Python-агент
Подключается к комнате как обычный участник **только если E2EE выключен**
(см. раздел 4). Делает STT (faster-whisper-server, tiny) и опционально
саммари (Ollama qwen2.5:0.5b). Полностью изолирован от остальной системы:
отсутствие агента не ломает основной функционал звонков (graceful
degradation).

### `docs/` и `.github/`
Документация и CI-конвейер (`pnpm build && pnpm lint`, тесты) — не несут
бизнес-логики, но обязательны для контроля качества перед мержем.

---

## 3. Порядок реализации

**Этап 0 — Каркас**
1. Инициализация Tauri 2 + React + TS (Vite) через pnpm, базовый `.gitignore`.
2. `docs/ARCHITECTURE.md`, `docs/README.md` (черновики).
3. CI (`.github/workflows`): pnpm install → lint → build.

**Этап 1 — Token server**
4. `server/`: эндпоинт `POST /token` (livekit-server-sdk), одноразовость,
   TTL 1 час, env-валидация, базовый room lifecycle.

**Этап 2 — Базовый звонок**
5. `src/services/livekit` + хуки `useRoom` / `useMedia`; подключение к
   комнате, аудио/видео 2+ участников.
6. Демонстрация экрана.

**Этап 3 — Чат**
7. `useChat` поверх LiveKit DataChannel + UI чата (`useChatStore`).

**Этап 4 — E2EE**
8. `src/services/e2ee` с `ExternalE2EEKeyProvider`, обмен ключом out-of-band,
   проверка совместимости со screen-share.
9. На `JoinPage`: toggle E2EE ⇄ toggle Transcription, взаимоисключение
   (см. раздел 4), `useSettingsStore`.

**Этап 5 — Tauri-команды**
10. `src-tauri/commands/save_transcript` — сохранение `.txt` локально у
    участника; типизация, обработка ошибок; настройка capabilities/CSP.

**Этап 6 — Опциональный агент**
11. `agent/`: скелет LiveKit Agent, чтение флагов `ENABLE_STT` /
    `ENABLE_SUMMARY`, подключение к комнате только при выполнении условий
    запуска (раздел 4).
12. STT (faster-whisper tiny) → накопление транскрипта в памяти агента.
13. Summary (Ollama qwen2.5:0.5b) → добавление в конец `.txt` при
    `ENABLE_SUMMARY=true`.
14. Доставка готового транскрипта участнику (событие завершения сессии /
    DataChannel) → сохранение через Tauri-команду из Этапа 5.

**Этап 7 — Финал**
15. Тесты (unit + integration), `docs/TESTING.md`.
16. Финальная проверка: `pnpm build && pnpm lint && тесты проходят`.

---

## 4. Зоны риска (HIGH RISK)

### 4.1 Токены (`server/` + `src/services/token-api`)
- TTL строго 1 час, одноразовое использование, **никакого** хранения токенов
  или сессий на сервере.
- Риск: переиспользование токена, попадание токена в логи. Требуется
  серверная проверка одноразовости и запрет логирования значений токена.

### 4.2 E2EE (`src/services/e2ee`)
- `ExternalE2EEKeyProvider`: ключ шифрования **никогда** не проходит через
  token-server и не логируется ни на клиенте, ни на сервере.
- Обмен ключом между участниками — только out-of-band (вне LiveKit/сервера).
- Нужно отдельно проверить совместимость E2EE со screen-share и с
  Web Worker шифрованием внутри Tauri webview.

### 4.3 Опциональный агент (`agent/`) ⇄ E2EE
- Агент — такой же участник комнаты, как и остальные, поэтому при включённом
  E2EE он физически не может расшифровать медиапоток без ключа.
- **Решение (утверждено):** E2EE и Transcription — взаимоисключающие опции.
  На `JoinPage` два toggle; включение одного автоматически выключает другой
  с explain-тултипом («Транскрипция недоступна при включённом E2EE»).
- Транскрипт сохраняется **только локально** у участника через Tauri
  (`save_transcript`), никогда на сервере агента/token-сервере.
- Ресурсы агента: whisper tiny (~1 GB RAM), Ollama qwen2.5:0.5b (~400 MB),
  CPU-only — при недоступности агента приложение продолжает работать без
  транскрипции (graceful degradation).

### 4.4 Tauri capabilities / CSP
- Разрешения ФС ограничены только необходимой командой сохранения файла.
- Строгий CSP для webview, минимальный набор capabilities в
  `tauri.conf.json`.

### 4.5 Секреты и конфигурация
- Все ключи/секреты — только в `.env`-файлах, которые полностью в
  `.gitignore`. Никаких секретов в исходном коде или коммитах.

---

## 5. Условия запуска опционального агента

Матрица принятия решения о подключении/поведении агента:

| E2EE | Transcription toggle | ENABLE_STT | ENABLE_SUMMARY | Поведение агента                              |
|------|-----------------------|------------|-----------------|------------------------------------------------|
| ON   | (принудительно OFF)   | —          | —               | Агент не подключается к комнате                |
| OFF  | OFF                   | any        | any             | Агент не подключается к комнате                |
| OFF  | ON                    | false      | any             | Агент подключён, но STT неактивен (транскрипта нет) |
| OFF  | ON                    | true       | false           | STT активен → `.txt` без саммари в конце       |
| OFF  | ON                    | true       | true            | STT активен + саммари → `.txt` с саммари внизу |

Дополнительно:
- Переключатели E2EE и Transcription на `JoinPage` **взаимоисключающие**:
  включение одного автоматически выключает второй с пояснением в UI.
- Итоговый `.txt` (транскрипт + опциональное саммари) сохраняется **локально
  у каждого участника** через Tauri-команду `save_transcript`, сервер и агент
  не хранят копию после завершения сессии.
- Отсутствие/сбой агента не должен блокировать звонок — деградация до
  обычного звонка без транскрипции.

---

## 6. Зафиксированные архитектурные решения

1. **E2EE ⇄ Transcription** — взаимоисключающие опции в UI (вариант a).
2. **State manager** — Zustand (`useRoomStore`, `useChatStore`,
   `useSettingsStore`).
3. **Пакетный менеджер** — pnpm везде: фронтенд, `src-tauri` (через
   tauri-cli), `server/`. Единый lockfile-подход упрощает CI.

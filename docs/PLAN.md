# tauri-kit — План разработки

> Кроссплатформенное приложение для аудио/видеозвонков.
> Стек: **Tauri 2 + React + TypeScript + LiveKit (self-hosted SFU)**.

Статус на момент написания: репозиторий инициализируется с нуля, ни один из
модулей (`src/`, `src-tauri/`, `server/`, `agent/`, `docs/`, `.github/`) ещё
не создан. Документ фиксирует согласованную структуру и порядок работ.

> **Отклонения от плана при реализации.** Этот документ описывает
> первоначальный план — часть решений по факту оказалась другой. За
> актуальным описанием реализованной архитектуры смотри
> [ARCHITECTURE.md](./ARCHITECTURE.md). Основные отличия:
> - **Стейт-менеджер:** Zustand (`store/`, `useRoomStore`/`useChatStore`/
>   `useSettingsStore`/`useTranscriptStore`) не использовался. Конфигурация
>   сессии (`SessionConfig`) передаётся между страницами через React Router
>   `location.state` (см. `src/pages/JoinPage.tsx` → `src/pages/RoomPage.tsx`),
>   состояние чата и транскрипта живёт в `useChat()`/`useTranscription()`
>   без отдельного глобального стора.
> - **`ParticipantTile.tsx`, `useScreenShare.ts`** не выделялись в отдельные
>   файлы — `RoomView.tsx` использует `<ParticipantTile>` из
>   `@livekit/components-react` напрямую, переключение экрана — через
>   `<TrackToggle source={Track.Source.ScreenShare}>` в `ControlBar.tsx`.
> - **Room lifecycle** на token-сервере (создание/закрытие комнат) не
>   реализован — см. §8.8.

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
Единственная ответственность — выдача короткоживущих (TTL 1ч) JWT-токенов
LiveKit и управление жизненным циклом комнаты. **Не хранит** данные
пользователей, чат или историю сессий — соответственно, не отслеживает
повторное использование токена (stateless-дизайн, см. раздел 4.1).
Env-конфигурация валидируется (zod) при старте.

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
4. `server/`: эндпоинт `POST /token` (livekit-server-sdk), TTL 1 час,
   env-валидация, базовый room lifecycle.

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
- TTL строго 1 час, **никакого** хранения токенов или сессий на сервере
  (stateless-дизайн).
- Компромисс: раз сервер stateless, он **не** отслеживает повторное
  использование токена — токен валиден для повторных запросов вплоть до
  истечения TTL. Реализация одноразовости потребовала бы серверного
  хранилища состояния, что противоречило бы stateless-принципу; вместо
  этого `/token` защищён rate-limit'ом (см. `server/src/index.ts`) и
  запретом логирования значений токена.

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
2. **State manager** — по факту реализации Zustand не понадобился:
   `SessionConfig` передаётся между страницами через React Router
   `location.state`, чат/транскрипт живут в `useChat()`/`useTranscription()`
   без отдельного глобального стора (см. отклонения от плана в начале файла).
3. **Пакетный менеджер** — pnpm везде: фронтенд, `src-tauri` (через
   tauri-cli), `server/`. Единый lockfile-подход упрощает CI.
4. **`<LiveKitRoom>` вместо ручного `Room`** — используем высокоуровневый
   компонент `<LiveKitRoom>` из `@livekit/components-react`: он сам управляет
   жизненным циклом соединения, переподключением и cleanup. Ручное создание
   `livekit-client` `Room` — только если позже понадобится нестандартное
   поведение, не покрываемое компонентом.
5. **Чат — встроенный `useChat`** — используем `useChat` из
   `@livekit/components-react` поверх стандартного топика DataChannel
   (`lk-chat-topic`), а не собственную реализацию поверх `publishData`.
6. **Топики DataChannel закреплены** (см. раздел 7).

---

## 7. Фронтенд: компоненты и хуки для видеозвонков

### 7.1 Общие типы — `src/types/`
- `TokenRequest { identity, roomName }`, `TokenResponse { token, wsUrl }` —
  соответствуют контракту token server (`POST /token`).
- `AgentMessage<T> { type: string, version: number, payload: T }` — общая
  обёртка всех сообщений, публикуемых Python-агентом по DataChannel
  (зафиксировано, см. §7.2). Неизвестные `type` игнорируются потребителем —
  это защищает от ошибок при будущем расширении протокола.
- `TranscriptFinalPayload { transcript: string, summary: string }` —
  `payload` для `AgentMessage` с `type: "transcript_final"`. `summary` — это
  `""`, если `ENABLE_SUMMARY=false` на агенте либо Ollama была недоступна
  (graceful degradation, HIGH RISK 4.3).
- `TranscriptLivePayload { text: string }` — `payload` для `AgentMessage` с
  `type: "transcript_live"` (зарезервировано, не реализуется в первой
  итерации — см. §7.2).
- `SessionConfig { serverUrl, roomName, identity, e2eeKey?, transcriptionEnabled }`.

### 7.2 Топики DataChannel (зафиксировано)
| Топик              | Назначение                                             | Кто публикует | Кто потребляет |
|--------------------|---------------------------------------------------------|---------------|-----------------|
| `lk-chat-topic`    | Встроенный чат (стандартный топик `useChat`)            | Участники     | `useChat` (автоматически) |
| `transcript_final` | Финальный транскрипт + опциональное саммари по итогу звонка | Python-агент  | `hooks/useTranscription.ts` |
| `transcript_live`  | (опционально, MVP+) стриминг субтитров в реальном времени | Python-агент  | `hooks/useTranscription.ts` |

**Формат сообщения (зафиксировано, общая обёртка для обоих топиков):**
```json
{
  "type": "transcript_final",
  "version": 1,
  "payload": {
    "transcript": "...",
    "summary": "..."
  }
}
```
- `type` — строковый идентификатор, совпадает с именем топика
  (`"transcript_final"` | `"transcript_live"`).
- `version` — число, сейчас `1`; зарезервировано под обратную совместимость
  при будущих изменениях формата `payload`.
- `payload` для `transcript_final`: `{ transcript: string, summary: string }`
  (`summary` — пустая строка, если саммари выключено или Ollama недоступна).
- `payload` для `transcript_live`: `{ text: string }` — текущий сегмент в
  реальном времени.
- Потребитель (`hooks/useTranscription.ts`) обязан проверять `message.type`
  перед обработкой и **игнорировать неизвестные типы** — защита от поломки
  при будущем расширении протокола.

`transcript_live` не реализуется в первой итерации — зарезервирован, чтобы
не потребовалось менять протокол при добавлении live-субтитров.

### 7.3 Модули

**`services/tokenService.ts`** — единственная точка общения с token server.
- `requestToken(serverUrl, { identity, roomName }): Promise<TokenResponse>` —
  `POST {serverUrl}/token`, типизированные ошибки (сеть/400/500). Токен не
  логируется и не кэшируется (HIGH RISK 4.1).

**`services/e2eeService.ts`** — инкапсуляция `ExternalE2EEKeyProvider` из
`livekit-client`.
- `createE2EEOptions(key: string): RoomOptions['e2ee'] | undefined` — при
  пустом ключе возвращает `undefined` (E2EE выключен). Ключ передаётся в
  `keyProvider.setKey(key)`, никогда не уходит на сервер и не логируется
  (HIGH RISK 4.2).

**`hooks/useLiveKitRoom.ts`** — тонкая обвязка вокруг `<LiveKitRoom>`:
готовит `token`/`serverUrl` (через `tokenService`) и `RoomOptions` (через
`e2eeService`) до монтирования `<LiveKitRoom>`; синхронизирует
connection-state в `useRoomStore` через колбэки `onConnected`/
`onDisconnected`/`onError` компонента `<LiveKitRoom>`.

**`hooks/useTranscription.ts`** — приём транскрипта, **graceful**.
- Подписка на `RoomEvent.DataReceived` с фильтром по топикам
  `transcript_final` (и опционально `transcript_live`), парсинг payload.
- Если агент не подключён — событий не будет, хук просто возвращает пустое
  состояние без ошибок (`{ segments: [], summary: undefined, isActive: false }`)
  (HIGH RISK 4.3). Активен только когда `transcriptionEnabled` (взаимоисключён
  с E2EE).
- Результат складывается в `useTranscriptStore`.

**`components/Room/`** — `RoomView.tsx` (grid-раскладка участников,
использует `useTracks`/`useParticipants` из `@livekit/components-react`),
`ParticipantTile.tsx` (обёртка над `<ParticipantTile>`/`VideoTrack`/
`AudioTrack`, индикаторы mute/speaking).

**`components/ScreenShare/`** — `ScreenShareView.tsx` (рендер трека
`Track.Source.ScreenShare`), `useScreenShare.ts` (локальный хук:
`localParticipant.setScreenShareEnabled`, обработка отмены системного
диалога). Совместимость со screen-share при E2EE проверяется отдельно на
этапе реализации (HIGH RISK 4.2).

**`components/Chat/`** — `ChatPanel.tsx`, построен поверх `useChat()` из
`@livekit/components-react` (топик `lk-chat-topic` из коробки); сообщения
дублируются в `useChatStore` для UI-состояния (непрочитанные и т.п.).

**`components/Controls/`** — `ControlBar.tsx`: mute mic, toggle camera,
screen share, leave. Реализуется на базе примитивов
`@livekit/components-react` (`TrackToggle` и т.п.), обёрнутых в наш UI;
компонент не содержит бизнес-логики, только вызовы хуков/методов
`localParticipant`.

**`pages/JoinPage.tsx`** — форма: `serverUrl`, `roomName`, `identity`,
поле E2EE-ключа + два взаимоисключающих toggle (E2EE ⇄ Transcription,
решение 6.1/4.3.). Состояние — `useSettingsStore`.

**`pages/RoomPage.tsx`** — оборачивает контент в `<LiveKitRoom>` с
опциями из `useLiveKitRoom`; внутри — `Room/`, `ScreenShare/`, `Chat/`,
`Controls/`; активирует `useTranscription`, если включена транскрипция.
При выходе (`leave`) — переход на `TranscriptPage`.

**`pages/TranscriptPage.tsx`** — показывает `useTranscriptStore`
(сегменты + саммари, если пришли по `transcript_final`). Пустой стейт, если
транскрипта нет (агент отсутствовал / был включён E2EE). Кнопка «Сохранить
.txt» вызывает Tauri-команду `save_transcript` через `services/tauri-ipc`
(строго локально, сервер/агент копию не хранят — HIGH RISK 4.3).

### 7.4 Поток данных (кратко)
```
JoinPage → useSettingsStore (serverUrl, roomName, identity, e2eeKey, transcriptionEnabled)
         → RoomPage
              → <LiveKitRoom> (token из tokenService, e2ee-опции из e2eeService)
              → Room/ ScreenShare/ Chat/ (useChat, топик lk-chat-topic) / Controls/
              → useTranscription (топики transcript_final / transcript_live, graceful)
         → leave → TranscriptPage → tauri-ipc save_transcript (.txt локально)
```

---

## 8. Token server (детальная спецификация) — реализовано

Статус: **реализовано** (Этап 1). Room lifecycle из раздела 1/2 сознательно
**отложен** как отдельная задача — текущий сервер отвечает только за выдачу
токенов.

### 8.1 Стек
Node.js + TypeScript (ESM) · Fastify · `livekit-server-sdk` · `zod` ·
`dotenv` · `@fastify/cors` · Vitest.

### 8.2 Структура
```
server/
├─ src/
│  ├─ index.ts          # Fastify-сервер, CORS (ALLOWED_ORIGIN), POST /token, GET /health
│  ├─ tokenService.ts   # createAccessToken({ identity, roomName }) → { token, wsUrl }
│  ├─ config.ts         # dotenv + zod-валидация env (fail-fast)
│  └─ .env.example
├─ tests/
│  └─ tokenService.test.ts
└─ package.json
```
Примечание: фактическая структура плоская (`src/*.ts`), без вложенных
`routes/`/`services/`/`config/` из раздела 1 — осознанное упрощение, пока
сервер выполняет одну функцию (выдача токена).

### 8.3 Переменные окружения (`.env.example`)
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` — обязательные.
- `ALLOWED_ORIGIN` — origin для CORS (default `http://localhost:1420`).
- `PORT` — default `3001`.
- `TOKEN_TTL_SECONDS` — default `3600` (1 час, HIGH RISK 4.1).

### 8.4 Ответственность модулей
- **`config.ts`** — загрузка `.env`, zod-схема, типизированный экспорт
  конфига; падение с понятной ошибкой при невалидной конфигурации; секреты
  не логируются.
- **`tokenService.ts`** — чистая функция генерации: `AccessToken` с
  `identity`, `ttl` = 1 час, `VideoGrant` (`roomJoin`, `room`, `canPublish`,
  `canSubscribe`); возвращает `{ token, wsUrl }`; без хранения состояния,
  без логирования значения токена.
- **`index.ts`** — Fastify, `@fastify/cors` с `ALLOWED_ORIGIN`,
  `POST /token` с валидацией тела (непустые `identity`/`roomName`) → 400 при
  ошибке, 500 на внутренние; `GET /health`.

### 8.5 Тесты (`tests/tokenService.test.ts`, Vitest)
1. Генерация валидного JWT (3 сегмента) + корректный `wsUrl`.
2. Claims: `sub` = identity, `video.room`, `roomJoin`/`canPublish`/
   `canSubscribe: true`.
3. TTL — ровно `TOKEN_TTL_SECONDS`. Проверяется как `exp - nbf`: у
   `livekit-server-sdk` нет отдельного `iat`, время выпуска зафиксировано в
   `nbf`.
4. Отклонение пустых `identity`/`roomName` (ошибка, а не тихий проход).

Фиктивные ключи используются только в тестах, реальные — исключительно в
`.env` (см. раздел 4.5).

### 8.6 `package.json`
- deps: `fastify`, `@fastify/cors`, `livekit-server-sdk`, `zod`, `dotenv`.
- devDeps: `typescript`, `vitest`, `@types/node`, `tsx`.
- scripts: `dev` (tsx watch), `build` (tsc), `start` (node dist), `test`
  (vitest run), `lint` (eslint).

### 8.7 Проверено при реализации
- `server/.env` присутствует в `.gitignore` (HIGH RISK 4.5).
- `server` подключён как workspace в `pnpm-workspace.yaml`.

### 8.8 Отложено
- **Room lifecycle** (создание/закрытие комнат, room manager) — отдельная
  будущая задача, не блокирует текущий функционал звонков.

---

## 9. Опциональный Python-агент (детальная спецификация)

Статус: **реализуется** (Этап 6). Агент подключается к комнате только при
условиях из раздела 5 (E2EE выключен, transcription-toggle включён).

### 9.1 Стек
Python 3 · `livekit-agents` · `livekit` · `python-dotenv` · `httpx` (async
HTTP-клиент для faster-whisper-server и Ollama).

### 9.2 Структура
```
agent/
├─ main.py             # AgentServer entrypoint, чтение флагов, оркестрация
├─ transcriber.py       # STT-логика (faster-whisper-server), накопление сегментов
├─ summarizer.py        # запрос к Ollama, graceful fallback
├─ exporter.py          # форматирование .txt + рассылка по DataChannel
├─ requirements.txt
├─ .env.example
└─ README_AGENT.md
```

### 9.3 Переменные окружения (`.env.example`)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — подключение к SFU.
- `ENABLE_STT` — default `true`; при `false` агент завершает работу с
  предупреждением при старте, не подключаясь к комнате.
- `FASTER_WHISPER_URL` — default `http://localhost:8000/v1` (OpenAI-совместимое
  API faster-whisper-server).
- `FASTER_WHISPER_MODEL` — default `tiny`.
- `ENABLE_SUMMARY` — default `true`; управляет вызовом `summarizer.py`.
- `OLLAMA_URL` — default `http://localhost:11434`.
- `OLLAMA_MODEL` — default `qwen2.5:0.5b`.

### 9.4 Ответственность модулей
- **`main.py`** — единственная точка входа и оркестрации (SRP):
  - загружает `.env`, проверяет `ENABLE_STT`; при `false` — `logger.warning`
    и выход без подключения к комнате;
  - `WorkerOptions`/`cli.run_app` из `livekit-agents`;
  - `entrypoint(ctx)` подключает агента как **скрытого участника**:
    `auto_subscribe=AudioOnly`, identity `agent-transcriber`, без публикации
    собственных видео/аудио треков;
  - подписывается на аудиотреки всех участников комнаты и передаёт кадры в
    `Transcriber`;
  - по завершении сессии (все участники вышли/комната закрылась) вызывает
    `Exporter.build_document` → опционально `Summarizer.summarize` → 
    `Exporter.publish_final`.
- **`transcriber.py`** — `Transcriber`:
  - буферизует аудио (VAD/оконная нарезка), шлёт чанки в
    `POST {FASTER_WHISPER_URL}/audio/transcriptions` (`model=tiny`,
    OpenAI-совместимый формат, `httpx`);
  - хранит сегменты с меткой времени от начала сессии, формат
    `[HH:MM:SS] текст сегмента`;
  - `get_transcript_text()` → полный текст транскрипта (это `payload.transcript`);
  - graceful: недоступность whisper-сервера → `logger.warning`, чанк
    пропускается, работа агента продолжается (HIGH RISK 4.3).
  - Не знает про Ollama и про DataChannel — изоляция ответственности.
- **`summarizer.py`** — `summarize(transcript_text) -> str`:
  - вызывается только при `ENABLE_SUMMARY=true`, иначе возвращает `""`;
  - `POST {OLLAMA_URL}/api/generate`, `model={OLLAMA_MODEL}`, промпт на
    саммари из 3–5 пунктов;
  - при недоступности/таймауте Ollama — `logger.warning`, возврат `""`;
    финальный документ уходит без саммари, агент не падает.
- **`exporter.py`**:
  - `build_document(segments) -> str` — итоговый текст транскрипта из строк
    `[HH:MM:SS] текст`;
  - `publish_final(room, transcript, summary)` — формирует сообщение по
    зафиксированному контракту (см. §7.2):
    `{ "type": "transcript_final", "version": 1, "payload": { "transcript": ..., "summary": summary or "" } }`,
    сериализует в JSON → `room.local_participant.publish_data(reliable=True,
    topic="transcript_final")`, рассылая всем участникам.

### 9.5 Требования к ресурсам
Whisper tiny (~1 GB RAM), Ollama qwen2.5:0.5b (~400 MB), CPU-only. Полностью
опционально: отсутствие/сбой агента не блокирует звонок (graceful
degradation, HIGH RISK 4.3).

### 9.6 `requirements.txt`
`livekit-agents`, `livekit`, `python-dotenv`, `httpx`.

### 9.7 `README_AGENT.md`
Описывает: назначение, требования к ресурсам, запуск (`.env` → `python
main.py`), таблицу флагов и матрицу поведения (раздел 5), зафиксированный
DataChannel-контракт (§7.2), явные заметки о graceful degradation и о
несовместимости с включённым E2EE.

### 9.8 Синхронизация с фронтендом
`src/types/index.ts` и `src/hooks/useTranscription.ts` приведены к
зафиксированному контракту `AgentMessage { type, version, payload }` (см.
§7.1/7.2): хук проверяет `message.type === "transcript_final"`, игнорирует
неизвестные `type`, берёт готовые `payload.transcript`/`payload.summary` без
самостоятельного форматирования из сегментов.




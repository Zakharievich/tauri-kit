# Архитектура tauri-kit

## Диаграмма модулей

```
┌───────────────────────────────────────────────────────────────────────┐
│                          Tauri Desktop App                            │
│  ┌───────────────────────────────┐   ┌───────────────────────────┐   │
│  │           src/                │   │        src-tauri/          │   │
│  │  (React + TS, webview UI)     │◄──┤  (Rust, native IPC)        │   │
│  │                                │   │                             │   │
│  │  pages/  components/  hooks/  │   │  commands.rs:               │   │
│  │  services/  store/  types/    │──►│    save_transcript()        │   │
│  │                                │   │  tauri.conf.json (CSP, caps)│   │
│  └───────────┬───────────────────┘   └───────────────────────────┘   │
└──────────────┼──────────────────────────────────────────────────────┘
               │ HTTPS POST /token            │ WSS (LiveKit protocol)
               ▼                              ▼
   ┌────────────────────────┐        ┌───────────────────────────┐
   │        server/         │        │      LiveKit SFU           │
   │  (Node.js + TS)        │        │  (self-hosted, Docker)     │
   │  POST /token → JWT     │───────►│  комнаты, треки, DataChannel│
   │  (TTL 1ч)              │        └─────────────┬───────────────┘
   └────────────────────────┘                      │
                                                     │ WSS, скрытый участник
                                                     ▼
                                      ┌───────────────────────────────┐
                                      │      agent/  [ОПЦИОНАЛЬНО]     │
                                      │  (Python, LiveKit Agents)      │
                                      │  main.py → transcriber.py      │
                                      │           → summarizer.py      │
                                      │           → exporter.py        │
                                      │  ├─► faster-whisper-server (STT)│
                                      │  └─► Ollama (summary)          │
                                      │  публикует transcript_final    │
                                      │  по DataChannel                │
                                      └───────────────────────────────┘
```

## Описание модулей

### `src/` — React frontend
- **Роль:** UI и клиентская оркестрация звонка. Никакой бизнес-логики в
  компонентах — она вынесена в `hooks/` и `services/`.
- **Вход:** действия пользователя (Join, mute, screen share, leave),
  сообщения по DataChannel от LiveKit (чат, транскрипт).
- **Выход:** HTTP-запрос токена к `server/`, WSS-соединение с LiveKit SFU,
  IPC-вызовы к `src-tauri/` (сохранение файла).
- **Зависимости:** `livekit-client`, `@livekit/components-react`,
  `@tauri-apps/api`, `server/` (по сети), `src-tauri/` (по IPC).
- Ключевые сервисы: `services/tokenService.ts` (общение с token server),
  `services/e2eeService.ts` (`ExternalE2EEKeyProvider`), `hooks/useLiveKitRoom.ts`
  (обвязка `<LiveKitRoom>`), `hooks/useTranscription.ts` (приём транскрипта,
  graceful degradation при отсутствии агента).

### `src-tauri/` — Rust (Tauri команды)
- **Роль:** нативные операции, недоступные из webview — запись файлов на
  диск, доступ к системным директориям.
- **Вход:** типизированный IPC-вызов `save_transcript(transcript_content,
  filename)` из `src/`.
- **Выход:** абсолютный путь к сохранённому `.txt`-файлу либо строка ошибки
  (`Result<String, String>`).
- **Зависимости:** `tauri` (Manager для `path().document_dir()`), файловая
  система пользователя. Права ограничены `tauri.conf.json`
  (capabilities/CSP) — доступ только к операции сохранения файла.

### `server/` — Token server (Node.js + TypeScript)
- **Роль:** единственная ответственность — выдача короткоживущих (TTL 1ч)
  JWT-токенов LiveKit. Не хранит данные пользователей, чат или историю
  сессий — соответственно, не отслеживает повторное использование токена
  (stateless-дизайн); `/token` защищён rate-limit'ом.
- **Вход:** `POST /token { identity, roomName }` от `src/`.
- **Выход:** `{ token, wsUrl }` — токен с TTL 1 час (`TOKEN_TTL_SECONDS`),
  правами `roomJoin`/`canPublish`/`canSubscribe`.
- **Зависимости:** `livekit-server-sdk` (генерация JWT), `zod`
  (env-валидация), Fastify (HTTP), сам LiveKit SFU (общие ключи API).

### `agent/` [ОПЦИОНАЛЬНО] — Python LiveKit Agent
- **Роль:** подключается к комнате как скрытый участник (без публикации
  собственных медиа) только когда E2EE выключен и включена транскрипция.
  Делает STT и опциональное саммари.
- **Вход:** аудиотреки участников комнаты (подписка через LiveKit SFU).
- **Выход:** сообщение `transcript_final` по DataChannel всем участникам
  (транскрипт + опциональное саммари); ничего не сохраняет на диск и не
  отправляет ни на один сервер.
- **Зависимости:** `livekit-agents`/`livekit` (подключение к SFU),
  `faster-whisper-server` (STT, модель `tiny`), `Ollama` (саммари,
  `qwen2.5:0.5b`), `httpx` (HTTP-клиент).
- Отсутствие/сбой агента **не блокирует звонок** — приложение продолжает
  работать без транскрипции.

### `docs/` и `.github/`
- Документация (этот файл, `README.md`, `TESTING.md`, `AI_GUIDELINES.md`,
  `PLAN.md`) и CI-конвейер (`pnpm install → lint → build → test`). Не несут
  бизнес-логики, но обязательны для контроля качества перед мержем.

## Поток данных: от «Join» до «звонок завершён + файл сохранён»

```
1. Пользователь на JoinPage вводит serverUrl/roomName/identity,
   опционально включает E2EE-ключ ИЛИ Transcription (взаимоисключающе).
        │
2. RoomPage → useLiveKitRoom → tokenService.requestToken()
        │        POST {serverUrl}/token → server/ → { token, wsUrl }
        ▼
3. <LiveKitRoom> подключается к LiveKit SFU по wsUrl с полученным token;
   если E2EE включён — RoomOptions.e2ee из e2eeService (ключ никогда
   не уходит на сервер).
        │
4. Внутри комнаты: Room/ (видео участников), ScreenShare/, Chat/ (useChat,
   lk-chat-topic), Controls/ (mute/camera/share/leave).
        │
5. Если Transcription включена — agent/ (если запущен) подписывается на
   аудиотреки участников, гонит их через faster-whisper-server (STT),
   копит сегменты транскрипта.
        │
6. useTranscription слушает RoomEvent.DataReceived на топике
   transcript_final; если агент отсутствует — просто остаётся в пустом
   состоянии, без ошибок (graceful degradation).
        │
7. Пользователь нажимает Leave → отключение от комнаты.
        │
8. Агент (если был активен) по завершении сессии формирует финальный
   документ: exporter.build_document(segments) → опционально
   summarizer.summarize() → exporter.publish_final() публикует
   { type: "transcript_final", version: 1, payload: { transcript, summary } }
   по DataChannel всем участникам (пока они ещё в комнате либо агент
   успевает опубликовать до дисконнекта — зависит от таймингов сессии).
        │
9. TranscriptPage отображает текст, полученный от useTranscription (текст с
   транскриптом + опциональным саммари, либо пустой стейт, если транскрипта
   не было) — передаётся со страницы Room через `location.state`.
        │
10. Пользователь нажимает «Сохранить .txt» → services/tauri-ipc вызывает
    IPC-команду save_transcript(transcript_content, filename) →
    src-tauri/commands.rs пишет файл в Documents-директорию пользователя →
    возвращает абсолютный путь.
        │
        ▼
   Звонок завершён, файл сохранён локально. Ни server/, ни agent/ не
   хранят копию транскрипта.
```

## Как агент подключается к комнате и передаёт транскрипт

1. **Подключение.** `agent/main.py` использует `livekit-agents`
   (`WorkerOptions`/`cli.run_app`). В `entrypoint(ctx)` агент подключается к
   комнате как обычный участник LiveKit с identity `agent-transcriber`,
   `auto_subscribe=AudioOnly` — то есть подписывается только на аудио и не
   публикует собственных видео/аудио треков (скрытый участник).
2. **Условие подключения.** Агент проверяет `ENABLE_STT` при старте: если
   `false` — выходит с предупреждением, не подключаясь к комнате. На
   уровне продукта агент имеет смысл подключать только когда E2EE выключен
   (иначе он физически не может расшифровать медиапоток без ключа) и
   включён toggle Transcription на фронтенде — это ответственность
   деплоя/оркестрации, а не самого агента.
3. **Транскрипция.** `transcriber.py` буферизует аудио от каждого
   подписанного трека и отправляет чанки в
   `POST {FASTER_WHISPER_URL}/audio/transcriptions` (OpenAI-совместимый API
   faster-whisper-server, модель `tiny`). Полученный текст сохраняется как
   сегмент `[HH:MM:SS] текст` с меткой времени от начала сессии.
4. **Саммари (опционально).** По завершении сессии, если
   `ENABLE_SUMMARY=true`, `summarizer.py` отправляет накопленный транскрипт
   в Ollama (`POST {OLLAMA_URL}/api/generate`, модель `qwen2.5:0.5b`) и
   получает саммари из 3–5 пунктов. При недоступности Ollama — `""`, без
   падения агента.
5. **Передача транскрипта.** `exporter.py`:
   - `build_document(segments)` собирает полный текст транскрипта;
   - `publish_final(room, transcript, summary)` формирует сообщение по
     зафиксированному контракту:
     ```json
     {
       "type": "transcript_final",
       "version": 1,
       "payload": { "transcript": "...", "summary": "..." }
     }
     ```
     сериализует в JSON и публикует через
     `room.local_participant.publish_data(reliable=True,
     topic="transcript_final")` — это доставляет сообщение всем участникам
     комнаты по WebRTC DataChannel LiveKit.
6. **Приём на фронтенде.** `hooks/useTranscription.ts` подписан на
   `RoomEvent.DataReceived`, фильтрует по топику `transcript_final`,
   проверяет `message.type` (игнорируя неизвестные типы для защиты от
   будущих изменений протокола) и форматирует `payload.transcript`/
   `payload.summary` в текст, который хук хранит в своём состоянии.

Полный протокол, переменные окружения и матрица поведения агента
зафиксированы в [agent/README_AGENT.md](../agent/README_AGENT.md) и
[PLAN.md](./PLAN.md) (§7.2, §9, HIGH RISK 4.3).

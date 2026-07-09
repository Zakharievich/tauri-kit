# Тестирование tauri-kit

## Что покрывают тесты по каждому модулю

### `src/` (Vitest)
- `services/e2eeService.test.ts` — проверяет, что `createE2EEOptions`
  возвращает `undefined` при пустом ключе (E2EE выключен) и корректные
  `RoomOptions['e2ee']` при непустом ключе, а также что ключ не попадает
  никуда, кроме `keyProvider.setKey()` (HIGH RISK 4.2 — ключ не должен
  логироваться/уходить на сервер).
- Тесты сервисов/хуков используют `jsdom`-окружение (`vitest.config.ts`) для
  имитации браузерного контекста внутри Tauri webview.

### `server/` (Vitest)
- `tests/tokenService.test.ts` покрывает:
  1. генерацию валидного JWT (3 сегмента) и корректного `wsUrl`;
  2. корректность claims — `sub` = identity, `video.room`, права
     `roomJoin`/`canPublish`/`canSubscribe: true`;
  3. TTL токена ровно `TOKEN_TTL_SECONDS` (проверка `exp - nbf`);
  4. отклонение пустых `identity`/`roomName` (ошибка, а не тихий проход).
- Используются фиктивные API-ключи только в тестах — реальные секреты не
  участвуют в тестовом окружении (HIGH RISK 4.5).

### `src-tauri/` (`cargo test`)
- `commands.rs` содержит юнит-тесты для `write_transcript_to_dir` —
  внутренней функции, вынесенной отдельно от `save_transcript` именно
  чтобы её можно было тестировать без реального `tauri::AppHandle`
  (резолвинг Documents-директории требует запущенного приложения):
  1. успешная запись файла и корректный возврат пути с ожидаемым
     содержимым;
  2. корректная обработка ошибки при записи в несуществующую директорию
     (`Result::Err`, а не паника).

### `agent/` (pytest, `agent/tests/`)
- `test_transcriber.py` — накопление сегментов с корректными временными
  метками `[HH:MM:SS]`, graceful-обработка недоступности
  faster-whisper-server (чанк пропускается, работа продолжается), tail-чанк
  ниже порога отправляется через `flush_all()`.
- `test_summarizer.py` — вызов Ollama только при `ENABLE_SUMMARY=true`,
  возврат `""` при пустом транскрипте, HTTP-ошибке или недоступности Ollama,
  без падения агента.
- `test_exporter.py` — корректная сборка текста транскрипта из сегментов и
  формирование сообщения `transcript_final` по зафиксированному контракту
  (`type`, `version`, `payload.transcript`, `payload.summary`); публикация
  не падает, если `publish_data` бросает исключение (best-effort).
- `test_main.py` — `_env_bool` парсинг флагов; `entrypoint()`/`main()` не
  подключаются к комнате и не стартуют worker при `ENABLE_STT=false`.

HTTP-вызовы (faster-whisper-server, Ollama) мокируются через
`monkeypatch.setattr(httpx.AsyncClient, "post", ...)` — без реального SFU
или STT/LLM бэкенда. Зависимости для тестов — в `agent/requirements-dev.txt`
(`pip install -r requirements-dev.txt`).

## Команды запуска тестов

```bash
# Frontend + token server (Vitest, из корня для src/, из server/ для сервера)
pnpm test              # src/
cd server && pnpm test # server/

# Rust (Tauri commands)
cd src-tauri
cargo test

# Python agent (first: pip install -r requirements-dev.txt)
cd agent
pytest
```

Перед мержем обязателен полный прогон (см. `docs/AI_GUIDELINES.md` и
`.clinerules`):

```bash
pnpm build && pnpm lint && pnpm test
```

## Оценочный уровень покрытия по модулям

| Модуль | Оценочное покрытие | Комментарий |
|---|---|---|
| `server/` (tokenService) | высокое (~90%) | Чистая функция генерации токена, легко тестируется изолированно. |
| `src-tauri/` (commands.rs) | среднее-высокое (~70%) | Ядровая логика записи файла покрыта; сам `#[tauri::command]` обвязку (резолвинг `document_dir`) юнит-тестами не покрыть без интеграционного окружения. |
| `src/services` (e2ee, token) | среднее (~60%) | Покрыты чистые функции сервисов; UI-компоненты и хуки, зависящие от `<LiveKitRoom>`, требуют интеграционных/E2E тестов (не реализованы). |
| `src/components`, `src/pages` | низкое | Компоненты почти не покрыты юнит-тестами — рекомендуется E2E/визуальное тестирование в будущем. |
| `agent/` | среднее (~65%) | Основная логика (`transcriber`/`summarizer`/`exporter`) покрыта юнит-тестами через мокирование HTTP; `ENABLE_STT=false` покрыт для `main.py`/`entrypoint()`. Реальная интеграция с LiveKit SFU (join/subscribe/shutdown callback) тестируется хуже без реального SFU — не покрыта. |

Модули с высокими рисками (токены, E2EE, сохранение файла) намеренно
покрыты тестами в первую очередь, согласно `docs/AI_GUIDELINES.md`.

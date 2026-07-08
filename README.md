# TauriKit

Кроссплатформенное десктоп-приложение для аудио/видеозвонков.

Стек: **Tauri 2 + React + TypeScript + LiveKit (self-hosted SFU)**.

- Многопользовательские аудио/видеозвонки, демонстрация экрана и встроенный чат на базе self-hosted LiveKit SFU.
- E2EE (сквозное шифрование медиапотоков).
- Локальное сохранение транскрипта звонка через Tauri IPC — без передачи на сервер.
- **Опциональный** Python-агент (`agent/`) для распознавания речи (STT) и автоматического саммари звонка.
  Полностью необязателен: его отсутствие или отключение (`ENABLE_STT=false` / `ENABLE_SUMMARY=false`)
  никак не влияет на основной звонок — работает graceful degradation.

## Документация

Полное описание установки, запуска, архитектуры и тестирования — в [docs/](./docs/):

- [docs/README.md](./docs/README.md) — установка, запуск, сборка под Windows/Linux/macOS.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — архитектура и модули проекта.
- [docs/PLAN.md](./docs/PLAN.md) — план разработки и зафиксированные решения.
- [docs/TESTING.md](./docs/TESTING.md) — стратегия тестирования.
- [agent/README_AGENT.md](./agent/README_AGENT.md) — опциональный Python-агент (STT + саммари).

## Быстрый старт

```bash
pnpm install
pnpm tauri dev
```

Подробности (запуск LiveKit, token-сервера, опционального агента) — см. [docs/README.md](./docs/README.md).

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

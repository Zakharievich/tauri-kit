# TauriKit

Кроссплатформенное десктоп-приложение для аудио/видеозвонков.

Стек: **Tauri 2 + React + TypeScript + LiveKit (self-hosted SFU)**.

- Многопользовательские аудио/видеозвонки, демонстрация экрана и встроенный чат на базе self-hosted LiveKit SFU.
- **Опционально**: E2EE (сквозное шифрование медиапотоков).
- **Опционально**: Python-агент (`agent/`) для распознавания речи (STT) и автоматического саммари звонка.
  Полностью необязателен: его отсутствие или отключение (`ENABLE_STT=false` / `ENABLE_SUMMARY=false`)
  никак не влияет на основной звонок — работает graceful degradation.

## Документация

- [docs/README.md](./docs/README.md) — установка, запуск, сборка под Windows/Linux/macOS.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — архитектура и модули проекта.
- [docs/AI_GUIDELINES.md](./docs/AI_GUIDELINES.md) — правила доработки с помощью AI.
- [docs/PLAN.md](./docs/PLAN.md) — план разработки и зафиксированные решения.
- [docs/TESTING.md](./docs/TESTING.md) — стратегия тестирования.
- [agent/README_AGENT.md](./agent/README_AGENT.md) — опциональный Python-агент (STT + саммари).

## Быстрый запуск

Порядок такой: сначала поднимается сервер (LiveKit + token-server), затем ставится клиент.

**1. Разверните сервер** на VPS (Ubuntu 24.04). Полная пошаговая инструкция — [docs/README.md](./docs/README.md).
После деплоя вы получите «URL сервера» вида `https://ваш-домен`.

**2. Получите клиент** — одним из двух способов:

- **Скачать готовый установщик** со страницы [Releases](https://github.com/Zakharievich/tauri-kit/releases)
  (Windows `.exe`, Linux `.AppImage`, macOS `.dmg`).
- **Собрать из исходников** (нужны Node.js 18+, pnpm и [Rust + Tauri CLI](https://tauri.app/start/prerequisites/)):
  ```bash
  pnpm install
  pnpm tauri build
  ```

**3. Установите и запустите** приложение, затем либо заполните поля:
- **URL сервера** — `https://ваш-домен`;
- **Ваше имя**;
- при необходимости выберите опции (E2EE / транскрибация).
либо вставьте полученную ссылку-приглашение в соответствующее поле.

Подробнее о развёртывании сервера, token-сервера и опционального агента — [docs/README.md](./docs/README.md).

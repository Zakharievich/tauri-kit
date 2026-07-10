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

**1. Разверните сервер** на VPS (Ubuntu 24.04). Создайте DNS A‑запись на IP сервера, затем разверните всё **одним скриптом**:
```bash
git clone https://github.com/Zakharievich/tauri-kit.git
cd tauri-kit && sudo bash deploy.sh --domain conf.example.com
```
Полная инструкция (и путь `curl … | sudo bash` одной строкой, и ручная установка) — [docs/README.md](./docs/README.md).
После деплоя вы получите «URL сервера» вида `https://ваш-домен`.

**2. Получите клиент** — одним из двух способов:

- **Скачать готовый файл** со страницы [Releases](https://github.com/Zakharievich/tauri-kit/releases).
  Имена файлов включают версию, платформу и архитектуру:
  - Windows — `TauriKit_v1.0.7_Windows_x64.exe`;
  - Linux — `TauriKit_v1.0.7_Linux_x64.AppImage` (portable: `chmod +x`, затем запуск);
  - macOS (Apple Silicon) — `TauriKit_v1.0.7_macOS_arm64.dmg` (откройте образ и перетащите
    `TauriKit.app` в `Applications`).
- **Собрать из исходников** (нужны Node.js 18+, pnpm и [Rust + Tauri CLI](https://tauri.app/start/prerequisites/)):
  ```bash
  pnpm install
  pnpm tauri build
  ```

> **macOS: обход Gatekeeper.** Приложение пока не подписано Apple Developer ID и не нотаризовано,
> поэтому при первом запуске macOS может сообщить, что приложение «повреждено». Это ожидаемо для
> неподписанной сборки. Снимите карантин одной командой:
> ```bash
> xattr -cr /Applications/TauriKit.app
> ```
> либо запустите через **ПКМ → «Открыть» → «Открыть»**. Подпись и нотаризация будут добавлены
> в CI, как только появятся сертификаты.
>
> **Windows:** SmartScreen может предупредить о неизвестном издателе — «Подробнее» → «Выполнить в
> любом случае» (до появления code-signing сертификата).
>
> **Windows: старая иконка после обновления.** Если при установке поверх прежней версии в меню Пуск
> или на ярлыке видна старая иконка — это кэш иконок Explorer, а не сборки. Обычно обновляется само
> после перезахода; принудительно: `ie4uinit.exe -show` и перезапуск `explorer.exe`.

**3. Установите/запустите** приложение. Дальше есть два сценария:
- **Присоединиться к комнате по ссылке** — вставьте ссылку-приглашение в верхнее поле, введите
  своё имя и нажмите **Join**.
- **Создать новую комнату** — укажите **URL сервера** (`https://ваш-домен`), **своё имя**, при
  необходимости выберите опции (E2EE / транскрибация) и нажмите **Создать**.

Подробнее о развёртывании сервера, token-сервера и опционального агента — [docs/README.md](./docs/README.md).

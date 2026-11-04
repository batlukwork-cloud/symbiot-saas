# СИМБИОТ — SaaS-разработка (диспетчерская + runtime)

Рабочий репозиторий продуктовой части Симбиота: локальный диспетчер, SaaS-runtime (FastAPI + Next.js),
клиентский плагин/десктоп и вся проектная документация L0→L7.

> Реорганизовано 2026-11-04 из прежней структуры `00_УПРАВЛЕНИЕ / 01_L0 … 99_АРХИВ_ВЕРСИЙ`.
> Удалено 117 281 файл (7,5 ГБ) вендорных рантаймов, сборок и дублей. Ни один файл кода или документа не потерян.

## Структура

```
product/                     исходники (единственный уникальный код проекта)
  dispatcher-mvp/            Диспетчерский цикл: коннектор, графовый executor, UI, Telegram, мост в Obsidian
  saas-runtime/              SaaS-runtime: backend (FastAPI), frontend (Next.js), contracts, scripts
  obsidian-plugin/           Плагин Obsidian + локальный connector-service + Electron-шелл, proof-скрипты
  desktop-app/               Исходники десктопной оболочки (без бинарников)

docs/                        проектная документация по уровням (в публичной сборке отсутствует)
  00_idea/                   L0 — идея, рынок, бенчмарки
  01_initiation/             L1 — инициация, политики, границы
  02_planning/               L2 — ТЗ и планирование
  03_design/                 L3 — архитектура, UX, ADR, контракты API
  04_demo_package/           демо-пакет AI System Readiness
  05_pilot/                  L6 — пилот (С1 Застройщики)
  06_management/             управление разработкой, КСГ, handoff, реестры
  07_versions/               архив версий документов
  08_prototype_graph_hero/   HTML-прототип графа
  09_testing_L5/             L5 — чек-листы и отчёты приёмки
  10_scaling_L7/             L7 — мониторинг

evidence/                    доказательства и методики (proof-матрицы, prompt-методология)

data/                        сырые данные исследований (~2 ГБ), в git НЕ попадают
```

## Документация

Проектная документация (КСГ-дорожная карта, реестры, handoff, доказательства фаз)
ведётся в отдельном приватном репозитории и в публичную сборку не входит.
В публичном репозитории — код и методики проверки (`evidence/`).

## Быстрый старт

### Диспетчер (локально, без внешних сервисов)

```bash
cd product/dispatcher-mvp
node 01_CONNECTOR_SERVICE/local_dev_server.js      # http://127.0.0.1:8788
```

Проверка приёмки графа (24 сценария):

```bash
cd product/dispatcher-mvp/02_GRAPH_EXECUTOR
node test_executor.js        # ожидаемо: 24 passed, 0 failed
```

### SaaS-runtime

```bash
cd product/saas-runtime/backend
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000     # /health
```

```bash
cd product/saas-runtime/frontend
npm install && npm run dev
```

`docker-compose.yml` — Postgres/pgvector, Redis, Keycloak. Конфигурация через `.env` (образец — `.env.example`,
секретов в репозитории нет).

### Плагин Obsidian

`product/obsidian-plugin/symbiot-obsidian-plugin` — собранный `main.js` + `manifest.json`.
Локальный коннектор: `product/obsidian-plugin/symbiot-connector-service` (`node server.js`, 58 маршрутов).

## Состояние (честно)

| Что | Статус |
|---|---|
| `dispatcher-mvp` | Работает локально, полный цикл «событие → карточка решения → Human Gate → контракт миссии → песочница». Адаптеры Telegram/email/WhatsApp/Bitrix24 — локальные/mock |
| `saas-runtime/backend` | 13 роутеров, 136 эндпоинтов, очереди задач, quality gates, RAG/pgvector, аудит. Провайдер LLM по умолчанию `mock` |
| `saas-runtime/frontend` | Работает, но UI собран в одном файле `app/page.tsx` (~11,7 тыс. строк) — требует декомпозиции |
| `obsidian-plugin` | Код есть и запускается; в боевом vault выведен из эксплуатации как нестабильный |
| Автотесты бэкенда | Отсутствуют (только proof-скрипты JS + сценарные проверки графа) |
| Версионирование | До 2026-11-04 git не использовался; история начинается с этого коммита |

## Правила работы

- Секреты — только в `.env`/менеджере секретов, никогда в репозитории.
- `data/` и `runtime_logs/` не коммитятся (см. `.gitignore`).
- Крупные бинарники и вендорные рантаймы (Postgres, pgAdmin, Electron-сборки, `node_modules`) в репозиторий не возвращаем.

## Лицензия

Copyright (c) 2026 Батлук Дмитрий Александрович.

| Что | Лицензия | Файл |
|---|---|---|
| Исходный код (`product/`, `evidence/`) | **GNU AGPL-3.0-or-later** | [`LICENSE`](LICENSE) |
| Документация, методология, КСГ | **CC BY-NC-ND 4.0** | [`LICENSE-DOCS.md`](LICENSE-DOCS.md) |
| Сторонние компоненты | свои лицензии (MIT / Apache-2.0 / BSD / ISC; `psycopg` — LGPL-3.0) | [`NOTICE`](NOTICE) |

**Что это значит на практике:** использовать, изменять и распространять код можно, но если вы
поднимаете изменённую версию как сетевой сервис (SaaS, API, веб-интерфейс), AGPL §13 требует
предоставить пользователям исходный код вашей версии. Для случаев, когда AGPL неприемлема
(закрытое использование, встраивание в проприетарный продукт), у правообладателя можно
запросить коммерческую лицензию — см. [`NOTICE`](NOTICE).

Название «СИМБИОТ» лицензией на код не покрывается: права на товарный знак сохраняются.
Участие в разработке и правила вкладов — [`CONTRIBUTING.md`](CONTRIBUTING.md) (DCO + уступка прав
на релицензирование), уязвимости — [`SECURITY.md`](SECURITY.md).

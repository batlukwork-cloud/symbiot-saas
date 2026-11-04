# G3 Product Workbench MVP

Дата: 2026-07-03
КСГ: SAAS-0924
Статус: закрыто как первый продуктовый экран

## Назначение

Product Workbench превращает Runtime из технического набора панелей в первый пользовательский экран продукта. Пользователь должен сразу увидеть, что Симбиот делает: принимает задачу, собирает рабочую группу, запускает TaskRun, показывает результат, качество, evidence и следующий шаг.

## Что реализовано

- Верхний экран `Product Workbench`.
- Product-Fit статус на первом экране.
- Главный сценарий: задача -> рабочая группа -> TaskRun -> артефакт -> quality/evidence -> решение.
- Форма постановки задачи: цель, ожидаемый артефакт, контекст/источники, срочность.
- Карточка "что считаем продуктом".
- Preview выбранного процесса.
- Preview рабочей группы на базе runtime role directory.
- Центр результата с артефактом после запуска.
- Старый технический dashboard оставлен ниже как evidence/advanced слой, а не как первый продуктовый экран.

## Проверка

- `npm run build`: passed.
- `python scripts/g3_smoke_check.py`: passed.
- live backend `/health`: `ok`.
- live frontend `/`: `200`.
- frontend contains `Product Workbench`: `true`.
- frontend contains `Product-Fit`: `true`.

## Следующий слой

`SAAS-0925`: Task Intake + Role Preview. Требуется сделать постановку задачи и выбор рабочей группы не только визуальными, но и более управляемыми как продуктовый сценарий.

## Связи

- [[Product-Fit Gate v0.1]]
- [[Product Workbench MVP]]
- [[Runtime]]
- [[Quality Gates]]
- [[Audit Layer]]
- [[RAG]]

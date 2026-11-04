from pathlib import Path
from docx import Document
from docx.shared import Pt
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from datetime import date, timedelta, datetime
import re
import json
import csv
import html

SRC = Path(r"<локальный путь>")
ROOT = Path(r"<локальный путь>")
SUBS = [
    "00_ТЗ_И_АНАЛИЗ",
    "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ",
    "02_АРХИТЕКТУРА",
    "03_BACKLOG",
    "04_ЧЕК_ЛИСТЫ",
    "05_МОНИТОРИНГ",
    "06_РЕЛИЗЫ",
    "07_РИСКИ_И_АУДИТ",
]
for sub in SUBS:
    (ROOT / sub).mkdir(parents=True, exist_ok=True)

OBS_ROOT = Path(r"D:\СИСТЕМА\01.Базы данных\01_База № 3 (MAC)\15.03_База № 3 (MAC)")
OBS_SAAS = OBS_ROOT / r"01_Симбиот_что_и_зачем\00_Смысл_и_стратегия\03_Симбиот_как_система_масштабирования\05_SAAS_РАЗРАБОТКА"
OBS_SAAS.mkdir(parents=True, exist_ok=True)
LOG_DIR = OBS_ROOT / r"02_Личная_операционная_система_ритм\01_ПРОТОКОЛЫ_ДНЯ_И_ЛОГИ\2026-07\ОД-011_2026-07-01_SAAS_разработка_Симбиота"
LOG_DIR.mkdir(parents=True, exist_ok=True)

doc = Document(str(SRC))
paras = []
for i, paragraph in enumerate(doc.paragraphs):
    text = " ".join(paragraph.text.split())
    if text:
        paras.append({"i": i, "style": paragraph.style.name if paragraph.style else "", "text": text})

full_txt = [f"Источник: {SRC}", f"Дата извлечения: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", ""]
for para in paras:
    full_txt.append(f"[{para['i']:03d}] {para['text']}")
(ROOT / "00_ТЗ_И_АНАЛИЗ" / "ТЗ_на_разработку_SAAS_извлечение.txt").write_text("\n".join(full_txt), encoding="utf-8")

tables_md = []
for ti, table in enumerate(doc.tables, 1):
    tables_md.append(f"## Таблица {ti}")
    rows = []
    for row in table.rows:
        rows.append([" ".join(cell.text.split()) for cell in row.cells])
    if rows:
        tables_md.append("| " + " | ".join(rows[0]) + " |")
        tables_md.append("| " + " | ".join(["---"] * len(rows[0])) + " |")
        for row in rows[1:]:
            tables_md.append("| " + " | ".join(cell.replace("|", "/") for cell in row) + " |")
    tables_md.append("")
(ROOT / "00_ТЗ_И_АНАЛИЗ" / "ТЗ_таблицы_извлечение.md").write_text("\n".join(tables_md), encoding="utf-8")

requirements = []
for ti, table in enumerate(doc.tables, 1):
    if not table.rows:
        continue
    headers = [" ".join(cell.text.split()) for cell in table.rows[0].cells]
    for row in table.rows[1:]:
        cells = [" ".join(cell.text.split()) for cell in row.cells]
        if cells and re.match(r"^(FR|NFR|SEC|UX|ADM|AI|ADR|DOC|RISK|AC)-?\d+", cells[0] or "", re.I):
            requirements.append({
                "table": ti,
                "id": cells[0],
                "requirement": cells[1] if len(cells) > 1 else "",
                "priority": cells[2] if len(cells) > 2 and cells[2] else "Acceptance",
                "headers": headers,
                "cells": cells,
            })

with open(ROOT / "00_ТЗ_И_АНАЛИЗ" / "РЕЕСТР_ТРЕБОВАНИЙ_ИЗ_ТЗ.csv", "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["table", "id", "requirement", "priority"])
    writer.writeheader()
    writer.writerows([{key: row[key] for key in ["table", "id", "requirement", "priority"]} for row in requirements])

module_map = [
    ((1, 7), "Каталог процессов", "Product/Frontend"),
    ((10, 17), "Мастер запуска", "Product/Frontend"),
    ((20, 25), "Профили выполнения", "Backend/Product"),
    ((30, 37), "Монитор процесса", "Frontend/Backend"),
    ((40, 48), "Центр результатов и артефакты", "Backend/Frontend"),
    ((50, 60), "Knowledge Hub", "RAG/Backend"),
    ((70, 76), "RAG Layer", "RAG/AI"),
    ((80, 87), "Quality Gates", "AI Governance/Backend"),
    ((90, 98), "LLM Gateway", "AI/Backend"),
    ((100, 103), "Профессиональный режим", "Security/Product"),
    ((110, 114), "Архитектор процесса и Compiler", "Architecture/Backend"),
    ((120, 126), "Admin Panel", "Admin/Security"),
    ((130, 134), "Audit Layer", "Audit/Security"),
]


def num_from_id(req_id):
    match = re.search(r"(\d+)", req_id)
    return int(match.group(1)) if match else 0


def classify(req_id, text):
    number = num_from_id(req_id)
    if req_id.startswith("NFR-"):
        if 1 <= number <= 10:
            return ("Безопасность и доступы", "Security")
        if 20 <= number <= 25:
            return ("ПДн и российский контур", "Legal/Security")
        if 30 <= number <= 35:
            return ("Производительность и очереди", "Backend/DevOps")
        if 40 <= number <= 44:
            return ("Масштабируемость", "Architecture/DevOps")
        if 50 <= number <= 54:
            return ("Надежность и восстановление", "DevOps/Backend")
        if 60 <= number <= 65:
            return ("Наблюдаемость", "DevOps/Audit")
    if req_id.startswith("AC-"):
        if number < 20:
            return ("MVP-приемка пользователя", "QA/Product")
        if number < 30:
            return ("MVP-приемка администратора", "QA/Admin")
        return ("MVP-техническая приемка", "QA/Tech")
    for limits, module, role in module_map:
        lo, hi = limits
        if lo <= number <= hi:
            return (module, role)
    return ("Общие требования", "Product")


roles = [
    ("Дмитрий", "Владелец продукта / финальная приемка", "Принимает ключевые решения, фиксирует приоритеты, утверждает релизные gates", "Ежедневный checkpoint 09:30 и 21:30"),
    ("[[РОЛЬ_AI_Симбиот_архитектор_системы]]", "Архитектор продукта и оркестратор", "Сохраняет ядро методологии, трассирует ТЗ, принимает архитектурный результат", "Финальный архитектурный вердикт"),
    ("[[РОЛЬ_AI_Диспетчер_задач_Симбиота]]", "PMO / диспетчер разработки", "Декомпозирует задачи, ведет WBS, назначает роли, следит за очередью", "КСГ и ежедневный статус"),
    ("CTO / IT-директор", "Технический владелец реализации", "Выбор стека, архитектура backend/frontend/devops, контроль техдолга", "ADR, repo, релиз"),
    ("Product Manager / бизнес-аналитик", "Продуктовая трассировка", "Преобразует ТЗ в user stories, DoR, acceptance, управляет scope", "Backlog, RTM"),
    ("UX/UI Designer", "Проектирование клиентского Runtime GUI", "Экраны, сценарии, прототип, дизайн-система, UX-проверка", "Figma/макеты/UX check"),
    ("Backend Lead", "Core Engine и API", "TaskRun, Artifact Service, Process Catalog, Admin API, очереди", "API tests"),
    ("Frontend Lead", "Runtime GUI", "Каталог, мастер запуска, монитор, результат, админка", "UI acceptance"),
    ("AI/LLM Architect", "LLM Gateway и профили выполнения", "Провайдеры, маршрутизация, fallback, token/cost limits", "LLM eval"),
    ("RAG / Knowledge Engineer", "Knowledge Hub и поиск", "Загрузка документов, парсинг, chunking, embeddings, vector store, rerank", "RAG eval"),
    ("QA Lead / Контролер качества", "Контроль качества и приемка", "Чек-листы, тест-кейсы, smoke/regression/security gates", "QA report"),
    ("Security / Compliance", "ИБ, ПДн, IP, RBAC/ABAC", "Секреты, TLS, изоляция клиентов, российский контур, логирование", "Security checklist"),
    ("DevOps / SRE", "Среда, CI/CD, мониторинг", "Развертывание, бэкапы, алерты, логи, scaling", "Release readiness"),
    ("[[РОЛЬ_AI_Методолог]]", "Методология и стандарты", "Следит, чтобы процессы и gates были воспроизводимы и проверяемы", "Методические checklists"),
    ("[[РОЛЬ_AI_Секретарь_ЛОС]]", "Фиксация хода", "Логи, протокол дня, решения, версия результата", "ЛОС"),
    ("[[РОЛЬ_AI_Синхронизатор_ролей]]", "Синхронизация Obsidian/файлов", "Связи, карты, зеркала, отсутствие дублей", "Obsidian graph"),
    ("[[РОЛЬ_AI_Архивариус_и_реестратор]]", "Реестры и версии", "Файлы, версии, пути, история изменений", "Реестр артефактов"),
    ("[[РОЛЬ_AI_Контролер_рисков]]", "Управление рисками", "Риски релиза, IP, качества, сроков, бюджета, провайдеров", "Risk register"),
    ("[[РОЛЬ_AI_Учитель_Симбиота]]", "Обучение системы", "Уроки, повторные ошибки, обновление правил", "Lessons learned"),
]

START = date(2026, 7, 1)
target_mvp = date(2026, 7, 15)
target_beta = date(2026, 7, 22)
target_rc = date(2026, 7, 29)
block_dates = {
    "Каталог процессов": (START + timedelta(days=2), START + timedelta(days=6)),
    "Мастер запуска": (START + timedelta(days=2), START + timedelta(days=7)),
    "Профили выполнения": (START + timedelta(days=2), START + timedelta(days=8)),
    "Монитор процесса": (START + timedelta(days=4), START + timedelta(days=10)),
    "Центр результатов и артефакты": (START + timedelta(days=5), START + timedelta(days=11)),
    "Knowledge Hub": (START + timedelta(days=3), START + timedelta(days=10)),
    "RAG Layer": (START + timedelta(days=4), START + timedelta(days=11)),
    "Quality Gates": (START + timedelta(days=5), START + timedelta(days=12)),
    "LLM Gateway": (START + timedelta(days=3), START + timedelta(days=9)),
    "Профессиональный режим": (START + timedelta(days=6), START + timedelta(days=12)),
    "Архитектор процесса и Compiler": (START + timedelta(days=3), START + timedelta(days=13)),
    "Admin Panel": (START + timedelta(days=4), START + timedelta(days=12)),
    "Audit Layer": (START + timedelta(days=5), START + timedelta(days=13)),
    "Безопасность и доступы": (START + timedelta(days=2), START + timedelta(days=14)),
    "ПДн и российский контур": (START + timedelta(days=2), START + timedelta(days=14)),
    "Производительность и очереди": (START + timedelta(days=6), START + timedelta(days=16)),
    "Масштабируемость": (START + timedelta(days=7), START + timedelta(days=18)),
    "Надежность и восстановление": (START + timedelta(days=7), START + timedelta(days=18)),
    "Наблюдаемость": (START + timedelta(days=7), START + timedelta(days=18)),
    "MVP-приемка пользователя": (START + timedelta(days=10), START + timedelta(days=14)),
    "MVP-приемка администратора": (START + timedelta(days=10), START + timedelta(days=14)),
    "MVP-техническая приемка": (START + timedelta(days=10), START + timedelta(days=14)),
}


def sprint_for(day):
    delta = (day - START).days
    if delta <= 6:
        return "S0: сборка ядра"
    if delta <= 13:
        return "S1: MVP до демо"
    if delta <= 20:
        return "S2: beta / hardening"
    return "S3: RC / аудит"


ksg = []


def add_task(wbs, block, req_id, name, desc, owner, support, priority, release, start, finish, pred="", status="Не начато", percent=0, units=1, acceptance="", checklist="", risk="Средний", artifact=""):
    ksg.append({
        "ID": f"SAAS-{len(ksg) + 1:04d}",
        "WBS": wbs,
        "Блок": block,
        "Requirement_ID": req_id,
        "Задача": name,
        "Описание": desc,
        "Ответственный": owner,
        "Участники": support,
        "Приоритет": priority,
        "Релиз": release,
        "Спринт": sprint_for(start),
        "Старт": start,
        "Финиш": finish,
        "Длительность_дн": max(1, (finish - start).days + 1),
        "Предшественник": pred,
        "Статус": status,
        "Готовность_%": percent,
        "Контрольные_единицы": units,
        "Критерий_приемки": acceptance,
        "Чек_лист": checklist,
        "Риск": risk,
        "Артефакт": artifact,
        "Примечание": "",
    })


for item in [
    ("0.1", "Инициация и управление", "TZ", "Создать рабочий контур SaaS-разработки", "Папки, карта, КСГ, чек-листы и мониторинг", "[[РОЛЬ_AI_Диспетчер_задач_Симбиота]]", "Секретарь, Синхронизатор, Архивариус", "Must", "Planning", START, START, "", "Готово", 100, 8, "КСГ и dashboard созданы", "CHECK-PMO", "Низкий", "КСГ + dashboard"),
    ("0.2", "Инициация и управление", "TZ", "Разобрать ТЗ на требования", "Извлечь требования, таблицы, headings, сформировать RTM", "Product Manager / бизнес-аналитик", "Методолог, QA", "Must", "Planning", START, START, "SAAS-0001", "Готово", 100, 8, "Реестр требований создан", "CHECK-REQ", "Низкий", "Реестр требований"),
    ("0.3", "Инициация и управление", "TZ", "Согласовать рабочую группу", "Определить роли, зоны ответственности, 24/7 режим, checkpoints", "Симбиот-архитектор", "Дмитрий, CTO, PMO", "Must", "Planning", START, START, "SAAS-0002", "Готово", 100, 5, "Рабочая группа в КСГ", "CHECK-PMO", "Низкий", "Лист Рабочая группа"),
    ("0.4", "Инициация и управление", "TZ", "Зафиксировать релизную стратегию", "MVP 14 дней, beta 21 день, RC 28 дней при заморозке scope", "CTO / IT-директор", "PM, QA, Security", "Must", "Planning", START, START + timedelta(days=1), "SAAS-0003", "В работе", 40, 10, "Есть gates и условия релиза", "CHECK-RELEASE", "Высокий", "Release gates"),
    ("1.1", "Требования и трассировка", "ALL", "Собрать полную RTM", "Связать каждое FR/NFR/AC с задачей, тестом и артефактом", "Product Manager / бизнес-аналитик", "QA Lead, Методолог", "Must", "MVP", START, START + timedelta(days=1), "SAAS-0002", "В работе", 30, 12, "RTM без пустых Must", "CHECK-REQ", "Высокий", "Матрица трассировки"),
    ("1.2", "Требования и трассировка", "ALL", "Заморозить MVP scope", "Отделить Must для MVP от Should для после-MVP", "Дмитрий", "Product Manager, CTO", "Must", "MVP", START + timedelta(days=1), START + timedelta(days=1), "SAAS-0005", "Не начато", 0, 8, "Scope freeze подписан", "CHECK-PMO", "Высокий", "Scope freeze"),
    ("2.1", "UX/UI", "GUI", "Собрать карту экранов Runtime", "Login, Dashboard, Catalog, Wizard, Monitor, Result, Knowledge, Admin", "UX/UI Designer", "Product Manager, Frontend Lead", "Must", "MVP", START, START + timedelta(days=2), "SAAS-0006", "Не начато", 0, 12, "Все MVP экраны есть", "CHECK-UX", "Средний", "UX map"),
    ("2.2", "UX/UI", "GUI", "Сделать кликабельный прототип MVP", "Проверить сквозной сценарий: вход -> процесс -> запуск -> монитор -> результат", "UX/UI Designer", "Дмитрий, QA", "Must", "MVP", START + timedelta(days=1), START + timedelta(days=4), "SAAS-0007", "Не начато", 0, 20, "Дмитрий может пройти сценарий", "CHECK-UX", "Высокий", "Prototype"),
    ("3.1", "Архитектура", "ARCH", "Зафиксировать архитектуру Studio/Compiler/Runtime", "Развести внутреннее ядро и клиентский Runtime", "Симбиот-архитектор", "CTO, Security", "Must", "MVP", START, START + timedelta(days=2), "SAAS-0006", "Не начато", 0, 15, "ADR и схема согласованы", "CHECK-ARCH", "Высокий", "ADR"),
    ("3.2", "Архитектура", "DATA", "Утвердить модель данных", "Tenant, User, Role, Process, ProcessVersion, TaskRun, Artifact, GateResult, SourceChunk, AuditEvent", "Backend Lead", "AI Architect, RAG Engineer, QA", "Must", "MVP", START + timedelta(days=1), START + timedelta(days=3), "SAAS-0009", "Не начато", 0, 18, "ERD и миграции готовы", "CHECK-ARCH", "Высокий", "Data model"),
    ("4.1", "DevOps", "ENV", "Поднять окружения dev/stage", "Репозиторий, CI/CD, секреты, база, очереди, storage, vector store", "DevOps / SRE", "Backend Lead, Security", "Must", "MVP", START, START + timedelta(days=3), "SAAS-0010", "Не начато", 0, 18, "Dev/stage доступны", "CHECK-DEVOPS", "Высокий", "Environment"),
    ("4.2", "QA", "TEST", "Создать тестовую стратегию", "Smoke, regression, API, UI, RAG eval, LLM eval, security, release checklist", "QA Lead / Контролер качества", "Product, Security, AI Architect", "Must", "MVP", START, START + timedelta(days=2), "SAAS-0011", "Не начато", 0, 12, "Тест-план покрывает Must", "CHECK-QA", "Высокий", "Test plan"),
]:
    add_task(*item)

stage_names = [
    ("AN", "Уточнить acceptance и DoR", "Разложить требование на user story, входы, выходы, ограничения и критерии приемки", "Product Manager / бизнес-аналитик", 1),
    ("DS", "Спроектировать UX/API/Data", "Определить экран, API, события, модель данных и права доступа", "UX/UI Designer + Backend Lead", 2),
    ("DEV", "Реализовать требование", "Разработать функциональность в Runtime/Core с учетом multi-tenant и аудита", "Backend/Frontend Lead", 3),
    ("QA", "Проверить требование", "Провести unit/API/UI/e2e или eval-проверку по типу требования", "QA Lead / Контролер качества", 1),
    ("ACC", "Принять и связать с RTM", "Зафиксировать прохождение acceptance, обновить RTM, аудит и релизный статус", "Product Manager + QA Lead", 1),
]

for idx, req in enumerate(requirements, 1):
    block, owner_hint = classify(req["id"], req["requirement"])
    bstart, bfinish = block_dates.get(block, (START + timedelta(days=2), START + timedelta(days=14)))
    days = max(1, (bfinish - bstart).days)
    offset = idx % max(1, days)
    base_start = bstart + timedelta(days=min(offset, days - 1))
    priority = req["priority"] if req["priority"] else "Must"
    release = "MVP Gate" if req["id"].startswith("AC-") else ("Beta/After MVP" if priority == "Should" else "MVP")
    pred = ""
    for si, (_code, stage, desc, owner, unit) in enumerate(stage_names, 1):
        st = base_start + timedelta(days=max(0, si - 2))
        fn = st + timedelta(days=0 if si in [1, 4, 5] else 1)
        risk = "Высокий" if priority == "Must" and block in ["Безопасность и доступы", "Quality Gates", "LLM Gateway", "RAG Layer", "Архитектор процесса и Compiler"] else "Средний"
        checklist = "CHECK-SEC" if "Безопас" in block or "ПДн" in block else ("CHECK-AI" if block in ["RAG Layer", "LLM Gateway", "Quality Gates"] else ("CHECK-QA" if req["id"].startswith("AC-") else "CHECK-FUNC"))
        add_task(f"5.{idx}.{si}", block, req["id"], f"{stage}: {req['id']}", f"{desc}. Требование: {req['requirement']}", owner, "Симбиот-архитектор; QA; Security при необходимости", priority, release, st, fn, pred, "Не начато", 0, unit, f"{req['id']}: {req['requirement']}", checklist, risk, f"{req['id']} artifact")
        pred = ksg[-1]["ID"]

for item in [
    ("6.1", "Интеграция", "INT", "Сквозной сценарий MVP #1", "Вход -> каталог -> запуск КП -> RAG -> LLM -> gates -> результат -> аудит", "QA Lead / Контролер качества", "Все лиды", "Must", "MVP", START + timedelta(days=10), target_mvp, "", "Не начато", 0, 25, "Сценарий проходит без ручных обходов", "CHECK-E2E", "Высокий", "E2E report"),
    ("6.2", "Интеграция", "INT", "Демо-процесс коммерческого предложения", "Собрать первый MVP-процесс из раздела 23 ТЗ", "Product Manager / бизнес-аналитик", "AI Architect, Backend, Frontend", "Must", "MVP", START + timedelta(days=9), target_mvp, "", "Не начато", 0, 20, "КП, письмо, источники, gates, версия документа", "CHECK-PROCESS", "Высокий", "Demo process"),
    ("6.3", "Релизные gates", "REL", "MVP Gate 1: пользовательская приемка", "Проверка AC-001..AC-010", "QA Lead / Контролер качества", "Дмитрий, Product", "Must", "MVP Gate", target_mvp, target_mvp, "", "Не начато", 0, 10, "Все пользовательские AC закрыты или заведены в blocker", "CHECK-RELEASE", "Высокий", "MVP Gate report"),
    ("6.4", "Релизные gates", "REL", "MVP Gate 2: административная приемка", "Проверка AC-020..AC-025", "QA Lead / Контролер качества", "Admin, Security", "Must", "MVP Gate", target_mvp, target_mvp, "", "Не начато", 0, 8, "Admin AC закрыты", "CHECK-RELEASE", "Высокий", "Admin Gate report"),
    ("6.5", "Релизные gates", "REL", "MVP Gate 3: техническая приемка", "Проверка AC-030..AC-038", "CTO / IT-директор", "QA, DevOps, Security", "Must", "MVP Gate", target_mvp, target_mvp, "", "Не начато", 0, 12, "Technical AC закрыты", "CHECK-RELEASE", "Высокий", "Technical Gate report"),
    ("7.1", "Beta hardening", "BETA", "Исправить blockers после MVP", "Закрыть дефекты P0/P1, усилить безопасность, логи, восстановление", "CTO / IT-директор", "Все лиды", "Must", "Beta", target_mvp + timedelta(days=1), target_beta, "", "Не начато", 0, 35, "Нет P0/P1", "CHECK-QA", "Высокий", "Beta report"),
    ("7.2", "RC и аудит", "RC", "Финальный аудит перед внешним показом", "ИБ, ПДн, IP, качество, документация, эксплуатация", "Security / Compliance", "QA, Legal, DevOps, Symbiot Architect", "Must", "RC", target_beta + timedelta(days=1), target_rc, "", "Не начато", 0, 30, "Аудит принят Дмитрием", "CHECK-AUDIT", "Высокий", "Audit report"),
]:
    add_task(*item)

total_units = sum(task["Контрольные_единицы"] for task in ksg)

checklists = [
    ("CHECK-PMO", "Управление разработкой", "Есть WBS; есть владелец; есть срок; есть DoD; есть зависимость; задача попала в КСГ; статус обновляется ежедневно; решение Дмитрия фиксируется."),
    ("CHECK-REQ", "Требования и трассировка", "Требование имеет ID; приоритет; источник в ТЗ; user story; DoR; acceptance; связанный тест; связанный артефакт; статус в RTM."),
    ("CHECK-UX", "UX/UI", "Сценарий проходит без объяснений; экран имеет пустые/error/loading states; роли доступа учтены; нет технических параметров для обычного пользователя; макет согласован."),
    ("CHECK-ARCH", "Архитектура", "Studio/Runtime разделены; IP защищен; multi-tenant учтен; данные и события описаны; ADR оформлен; нет нарушения ТЗ."),
    ("CHECK-FUNC", "Функциональный блок", "Функция реализует требование; работает по ролям; ошибки обработаны; состояние сохраняется; действия логируются; acceptance проходит."),
    ("CHECK-AI", "AI/RAG/LLM", "Провайдер заменяем; источники видны; prompt injection учтен; fallback есть; token/cost логируются; eval-набор пройден; результат не выдумывает факты без источников."),
    ("CHECK-SEC", "Безопасность/ПДн", "TLS; secrets storage; RBAC/ABAC; tenant isolation; маскирование логов; нет утечки ключей; внешние LLM можно отключить; политика хранения данных есть."),
    ("CHECK-QA", "QA", "Есть тест-кейс; тест пройден; дефекты заведены; P0/P1 нет; regression не сломан; evidence сохранен; вердикт приемки указан."),
    ("CHECK-DEVOPS", "DevOps/SRE", "Dev/stage подняты; CI/CD работает; бэкапы; миграции; алерты; логи; retry; rollback; мониторинг стоимости и ошибок."),
    ("CHECK-RELEASE", "Релизный gate", "Все Must закрыты или явно исключены Дмитрием; blockers закрыты; документация готова; аудит пройден; релизная заметка есть."),
    ("CHECK-AUDIT", "Финальный аудит продукта", "Проверены ИБ, ПДн, IP, качество, эксплуатация, юридические риски, поддержка, клиентская документация и границы поставки Runtime."),
    ("CHECK-PROCESS", "MVP-процесс", "Входные данные; этапы; роли; RAG; gates; артефакты; версия; источники; согласование; аудит; повторяемость."),
    ("CHECK-E2E", "Сквозной сценарий", "Пользователь проходит полный путь; сбой не ломает систему; логи и аудит заполнены; результат экспортируется; качество подтверждено gates."),
]
risks = [
    ("R-001", "Scope расползется за пределы MVP", "Высокий", "Заморозить Must-scope 2026-07-02, все Should увести в Beta/After MVP", "Дмитрий + Product Manager", "Открыт"),
    ("R-002", "Quality Gates будут формальными", "Высокий", "Для каждого gate задать условие, действие при провале, evidence и запись в аудит", "AI Architect + QA", "Открыт"),
    ("R-003", "LLM Gateway зависнет на интеграциях", "Высокий", "Первым подключить один реальный провайдер + OpenAI-compatible abstraction + mock provider", "AI Architect", "Открыт"),
    ("R-004", "RAG даст слабое качество источников", "Высокий", "Сделать eval-набор, ручную разметку, порог confidence, строгий режим блокировки", "RAG Engineer", "Открыт"),
    ("R-005", "Нет дисциплины обновления статусов", "Высокий", "Ежедневный PMO checkpoint, статус по КСГ, blocker list, контроль Архитектора", "Диспетчер задач", "Открыт"),
    ("R-006", "Утечка IP через клиентский Runtime", "Критический", "Не отдавать Obsidian vault, внутренние промпты и protected logic; Compiler + Runtime Bundle", "Security + Architect", "Открыт"),
    ("R-007", "ПДн/данные РФ не учтены", "Высокий", "Российский контур хранения, отключение внешних LLM, юридический аудит до промышленного запуска", "Security/Compliance", "Открыт"),
    ("R-008", "Демо есть, продукта нет", "Высокий", "Каждый экран и backend-требование принимать через AC, RTM и e2e, не только через макет", "QA Lead", "Открыт"),
]

wb = Workbook()
ws = wb.active
ws.title = "00_Дашборд"
for sheet in ["01_КСГ", "02_Backlog_требования", "03_Рабочая_группа", "04_Чек_листы", "05_Риски", "06_Релизные_Gates", "07_Метрики", "08_ТЗ_трассировка", "09_14_дневный_спринт"]:
    wb.create_sheet(sheet)

blue = "1F4E78"
lightblue = "D9EAF7"
green = "C6EFCE"
yellow = "FFF2CC"
red = "FFC7CE"
dark = "111827"
header_fill = PatternFill("solid", fgColor=blue)
sub_fill = PatternFill("solid", fgColor=lightblue)
thin = Side(style="thin", color="D9D9D9")
border = Border(left=thin, right=thin, top=thin, bottom=thin)


def style_header(row):
    for cell in row:
        cell.fill = header_fill
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border


def autosize(sheet, max_width=55):
    for column in sheet.columns:
        max_len = 0
        letter = get_column_letter(column[0].column)
        for cell in column:
            if cell.value is not None:
                max_len = max(max_len, min(max_width, len(str(cell.value))))
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = border
        sheet.column_dimensions[letter].width = max(10, min(max_width, max_len + 2))


sheet = wb["01_КСГ"]
headers = list(ksg[0].keys())
sheet.append(headers)
style_header(sheet[1])
for task in ksg:
    sheet.append([task[header] for header in headers])
sheet.freeze_panes = "A2"
sheet.auto_filter.ref = sheet.dimensions
for row in sheet.iter_rows(min_row=2):
    status = row[headers.index("Статус")].value
    row[headers.index("Статус")].fill = PatternFill("solid", fgColor=green if status == "Готово" else yellow if status == "В работе" else "FFFFFF")
    if row[headers.index("Риск")].value in ["Высокий", "Критический"]:
        row[headers.index("Риск")].fill = PatternFill("solid", fgColor=red)
table = Table(displayName="KSGTable", ref=sheet.dimensions)
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
sheet.add_table(table)
autosize(sheet, 45)

sheet = wb["02_Backlog_требования"]
sheet.append(["ID", "Требование", "Приоритет", "Модуль", "Владелец", "Статус", "Релиз", "Связанные задачи", "Критерий приемки"])
style_header(sheet[1])
for req in requirements:
    module, owner = classify(req["id"], req["requirement"])
    related = ", ".join([task["ID"] for task in ksg if task["Requirement_ID"] == req["id"]][:5])
    release = "MVP Gate" if req["id"].startswith("AC-") else ("Beta/After MVP" if req["priority"] == "Should" else "MVP")
    sheet.append([req["id"], req["requirement"], req["priority"], module, owner, "Не начато", release, related, req["requirement"]])
sheet.freeze_panes = "A2"
sheet.auto_filter.ref = sheet.dimensions
table = Table(displayName="ReqBacklogTable", ref=sheet.dimensions)
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium9", showRowStripes=True)
sheet.add_table(table)
autosize(sheet, 50)

sheet = wb["03_Рабочая_группа"]
sheet.append(["Роль", "Функция", "Ответственность", "Режим/контроль"])
style_header(sheet[1])
for role in roles:
    sheet.append(list(role))
sheet.freeze_panes = "A2"
sheet.auto_filter.ref = sheet.dimensions
table = Table(displayName="RolesTable", ref=sheet.dimensions)
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium4", showRowStripes=True)
sheet.add_table(table)
autosize(sheet, 50)

sheet = wb["04_Чек_листы"]
sheet.append(["ID", "Блок", "Контрольные вопросы / критерии"])
style_header(sheet[1])
for item in checklists:
    sheet.append(list(item))
sheet.freeze_panes = "A2"
sheet.auto_filter.ref = sheet.dimensions
table = Table(displayName="ChecklistTable", ref=sheet.dimensions)
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium6", showRowStripes=True)
sheet.add_table(table)
autosize(sheet, 65)

sheet = wb["05_Риски"]
sheet.append(["ID", "Риск", "Уровень", "Мера управления", "Владелец", "Статус"])
style_header(sheet[1])
for risk in risks:
    sheet.append(list(risk))
sheet.freeze_panes = "A2"
sheet.auto_filter.ref = sheet.dimensions
table = Table(displayName="RiskTable", ref=sheet.dimensions)
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium3", showRowStripes=True)
sheet.add_table(table)
for row in sheet.iter_rows(min_row=2):
    if row[2].value in ["Высокий", "Критический"]:
        row[2].fill = PatternFill("solid", fgColor=red)
autosize(sheet, 55)

gates = [
    ("G0", "2026-07-01", "Управленческий старт", "КСГ, чек-листы, RTM, рабочая группа созданы", "Принято с условиями: нужно согласовать scope freeze"),
    ("G1", "2026-07-02", "Scope Freeze", "Must/Should разделены, MVP не расползается", "Не начато"),
    ("G2", "2026-07-05", "UX + Architecture Freeze", "Прототип MVP, ADR, модель данных, API skeleton", "Не начато"),
    ("G3", "2026-07-10", "Core Integration", "Catalog/Wizard/LLM/RAG/Gates/Artifacts связаны сквозным сценарием", "Не начато"),
    ("G4", "2026-07-15", "MVP Demo Release", "AC-001..AC-010, AC-020..AC-025, AC-030..AC-038 проверены", "Не начато"),
    ("G5", "2026-07-22", "Beta / Hardening", "Нет P0/P1, security baseline, docs, monitoring", "Не начато"),
    ("G6", "2026-07-29", "RC / Product Audit", "Финальный аудит продукта; решение о внешнем показе Дмитрия", "Не начато"),
]
sheet = wb["06_Релизные_Gates"]
sheet.append(["Gate", "Дата", "Название", "Критерий прохождения", "Статус"])
style_header(sheet[1])
for gate in gates:
    sheet.append(list(gate))
sheet.freeze_panes = "A2"
sheet.auto_filter.ref = sheet.dimensions
table = Table(displayName="GateTable", ref=sheet.dimensions)
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium5", showRowStripes=True)
sheet.add_table(table)
autosize(sheet, 60)

ready_units = sum(task["Контрольные_единицы"] for task in ksg if task["Статус"] == "Готово")
progress = round(100 * ready_units / total_units, 1)
sheet = wb["07_Метрики"]
sheet.append(["Метрика", "Значение/формула", "Цель", "Комментарий"])
style_header(sheet[1])
metrics = [
    ("Всего требований", len(requirements), "157 из ТЗ", "Извлечено из таблиц DOCX"),
    ("Всего задач КСГ", len(ksg), "Управляемый backlog", "5 задач на требование + управление + релиз"),
    ("Оценочные единицы трудоемкости всего", total_units, "100% объема", "Фактическая сумма оценок задач, без нормировки под красивую цифру"),
    ("Контрольные единицы завершены", ready_units, "Растет ежедневно", "Считается по статусу Готово"),
    ("Готовность по оценочным единицам", f"{progress}%", "100%", "Плановый старт: готово только управление"),
    ("Цель MVP Demo", "2026-07-15", "14 календарных дней", "Только при scope freeze и параллельной разработке"),
    ("Цель Beta", "2026-07-22", "21 календарный день", "После закрытия P0/P1"),
    ("Цель RC", "2026-07-29", "28 календарных дней", "После аудита"),
    ("Ежедневный ритм", "09:30 / 21:30 / ночной статус", "2 human checkpoints + ночной прогон", "24/7 допускается только через жесткую фиксацию статусов"),
]
for metric in metrics:
    sheet.append(list(metric))
autosize(sheet, 55)

sheet = wb["08_ТЗ_трассировка"]
sheet.append(["Источник", "ID", "Требование", "Приоритет", "Модуль", "КСГ задачи", "Чек-лист", "Статус трассировки"])
style_header(sheet[1])
for req in requirements:
    module, owner = classify(req["id"], req["requirement"])
    tasks = [task["ID"] for task in ksg if task["Requirement_ID"] == req["id"]]
    checklist = "CHECK-SEC" if "Безопас" in module or "ПДн" in module else ("CHECK-AI" if module in ["RAG Layer", "LLM Gateway", "Quality Gates"] else "CHECK-FUNC")
    sheet.append([f"ТЗ таблица {req['table']}", req["id"], req["requirement"], req["priority"], module, ", ".join(tasks), checklist, "Связано"])
sheet.freeze_panes = "A2"
sheet.auto_filter.ref = sheet.dimensions
table = Table(displayName="RTMTable", ref=sheet.dimensions)
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium7", showRowStripes=True)
sheet.add_table(table)
autosize(sheet, 60)

sheet = wb["09_14_дневный_спринт"]
dates = [START + timedelta(days=i) for i in range(15)]
sheet.append(["Блок", "Ответственный", "Цель"] + [day.strftime("%d.%m") for day in dates])
style_header(sheet[1])
blocks = sorted(set(task["Блок"] for task in ksg))
for block in blocks:
    relevant = [task for task in ksg if task["Блок"] == block]
    st = min(task["Старт"] for task in relevant)
    fn = max(task["Финиш"] for task in relevant)
    owner = relevant[0]["Ответственный"]
    goal = f"{len(relevant)} задач / {sum(task['Контрольные_единицы'] for task in relevant)} ед."
    row = [block, owner, goal]
    for day in dates:
        row.append("█" if st <= day <= fn else "")
    sheet.append(row)
for row in sheet.iter_rows(min_row=2, min_col=4):
    for cell in row:
        if cell.value == "█":
            cell.fill = PatternFill("solid", fgColor="92D050")
sheet.freeze_panes = "D2"
autosize(sheet, 24)

sheet = wb["00_Дашборд"]
sheet["A1"] = "СИМБИОТ SaaS: панель контроля разработки v0.1"
sheet["A1"].font = Font(size=18, bold=True, color=dark)
sheet.merge_cells("A1:H1")
dashboard_rows = [
    ("Дата старта", START.strftime("%Y-%m-%d")),
    ("Цель MVP Demo", target_mvp.strftime("%Y-%m-%d")),
    ("Цель Beta", target_beta.strftime("%Y-%m-%d")),
    ("Цель RC / аудит", target_rc.strftime("%Y-%m-%d")),
    ("Требований из ТЗ", len(requirements)),
    ("Задач в КСГ", len(ksg)),
    ("Оценочных единиц трудоемкости всего", total_units),
    ("Контрольных единиц готово", ready_units),
    ("Готовность продукта, %", progress),
    ("Blockers P0/P1", "не заведены, требуется запуск разработки"),
    ("Архитектурный статус", "План принят к работе после согласования Дмитрия"),
]
for i, (key, value) in enumerate(dashboard_rows, 3):
    sheet.cell(i, 1, key)
    sheet.cell(i, 2, value)
    sheet.cell(i, 1).fill = sub_fill
    sheet.cell(i, 1).font = Font(bold=True)
    sheet.cell(i, 1).border = border
    sheet.cell(i, 2).border = border
sheet["D3"] = "Свод по блокам"
sheet["D3"].font = Font(bold=True, size=14)
start_row = 4
for idx, value in enumerate(["Блок", "Задач", "Ед. всего", "Ед. готово", "Готовность %"], 4):
    sheet.cell(start_row, idx, value)
style_header(sheet[start_row][3:8])
row_idx = start_row + 1
for block in blocks:
    relevant = [task for task in ksg if task["Блок"] == block]
    total = sum(task["Контрольные_единицы"] for task in relevant)
    done = sum(task["Контрольные_единицы"] for task in relevant if task["Статус"] == "Готово")
    values = [block, len(relevant), total, done, round(100 * done / total, 1) if total else 0]
    for col_idx, value in enumerate(values, 4):
        sheet.cell(row_idx, col_idx, value)
        sheet.cell(row_idx, col_idx).border = border
        sheet.cell(row_idx, col_idx).alignment = Alignment(wrap_text=True, vertical="top")
    row_idx += 1
sheet["A16"] = "Критический принцип"
sheet["A16"].font = Font(bold=True, color="9C0006")
sheet["B16"] = "MVP не считается готовым без Quality Gates, Audit Layer, RAG evidence, LLM Gateway abstraction и RTM-приемки."
sheet["B16"].alignment = Alignment(wrap_text=True)
for col, width in {"A": 30, "B": 55, "D": 35, "E": 12, "F": 12, "G": 12, "H": 14}.items():
    sheet.column_dimensions[col].width = width
for row in sheet.iter_rows():
    for cell in row:
        cell.border = border
        cell.alignment = Alignment(wrap_text=True, vertical="top")

xlsx_path = ROOT / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ" / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА_v0.1.xlsx"
wb.save(xlsx_path)

summary_doc = Document()
summary_doc.styles["Normal"].font.name = "Arial"
summary_doc.styles["Normal"].font.size = Pt(10)
summary_doc.add_heading("СИМБИОТ SaaS: план разработки и рабочая группа v0.1", 0)
summary_doc.add_paragraph(f"Источник: {SRC}")
summary_doc.add_paragraph("Дата: 2026-07-01. Цель: управляемый старт разработки SaaS Runtime Platform по ТЗ, с КСГ, чек-листами, трассировкой требований и релизными gates.")
summary_doc.add_heading("1. Ролевая схема задачи", 1)
for role, func, responsibility, mode in roles:
    paragraph = summary_doc.add_paragraph()
    paragraph.add_run(role + ": ").bold = True
    paragraph.add_run(func + " — " + responsibility + "; контроль: " + mode)
summary_doc.add_heading("2. Релизная гипотеза", 1)
for gate in gates:
    summary_doc.add_paragraph(f"{gate[0]} / {gate[1]} / {gate[2]}: {gate[3]}")
summary_doc.add_heading("3. Главные блоки разработки", 1)
for block in blocks:
    relevant = [task for task in ksg if task["Блок"] == block]
    summary_doc.add_paragraph(f"{block}: {len(relevant)} задач, {sum(task['Контрольные_единицы'] for task in relevant)} контрольных единиц.")
summary_doc.add_heading("4. Стоп-условия", 1)
for stop in [
    "Нет scope freeze по Must/Should",
    "Quality Gates не сохраняют evidence в аудит",
    "RAG не показывает источники",
    "LLM Gateway завязан на одного провайдера без fallback",
    "Нет изоляции клиентов и защиты секретов",
    "Результат существует только как демо без RTM и acceptance",
]:
    summary_doc.add_paragraph(stop)
summary_doc.add_heading("5. Вывод архитектора", 1)
summary_doc.add_paragraph("Рекомендовано запускать разработку только через данный контур контроля. Цель MVP Demo на 2026-07-15 реалистична при заморозке объема 2026-07-02, параллельной работе backend/frontend/AI/RAG/QA и ежедневном обновлении КСГ. Внешний коммерческий показ допустим не по факту демо, а после Beta/RC и продуктового аудита.")
summary_path = ROOT / "00_ТЗ_И_АНАЛИЗ" / "01_Анализ_ТЗ_и_контур_SAAS_Симбиота_v0.1.docx"
summary_doc.save(summary_path)

checklist_doc = Document()
checklist_doc.styles["Normal"].font.name = "Arial"
checklist_doc.styles["Normal"].font.size = Pt(10)
checklist_doc.add_heading("Чек-листы разработки СИМБИОТ SaaS v0.1", 0)
checklist_doc.add_paragraph("Назначение: контроль качества каждого блока работ до передачи на следующий релизный gate.")
for cid, block, text in checklists:
    checklist_doc.add_heading(f"{cid}: {block}", 1)
    for item in [part.strip() for part in text.split(";") if part.strip()]:
        checklist_doc.add_paragraph(item)
cl_path = ROOT / "04_ЧЕК_ЛИСТЫ" / "01_Чек_листы_блоков_SAAS_разработки_v0.1.docx"
checklist_doc.save(cl_path)

block_cards = "".join([
    f"<div class='card'><h3>{html.escape(block)}</h3><p>{len([task for task in ksg if task['Блок'] == block])} задач</p><b>{sum(task['Контрольные_единицы'] for task in ksg if task['Блок'] == block)} ед.</b></div>"
    for block in blocks[:24]
])
risk_rows = "".join([
    f"<tr><td>{risk[0]}</td><td>{html.escape(risk[1])}</td><td class='risk'>{risk[2]}</td><td>{html.escape(risk[3])}</td><td>{html.escape(risk[4])}</td></tr>"
    for risk in risks
])
html_doc = f"""<!doctype html><html lang='ru'><head><meta charset='utf-8'><title>СИМБИОТ SaaS Dashboard</title><style>
body{{font-family:Arial,sans-serif;margin:0;background:#f5f7fb;color:#18212f}}header{{background:#11263f;color:white;padding:24px 32px}}main{{padding:24px 32px}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}}.card{{background:white;border:1px solid #dde3ea;border-radius:8px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}}.metric{{font-size:32px;font-weight:700}}.bar{{height:22px;background:#e5e7eb;border-radius:999px;overflow:hidden}}.fill{{height:100%;background:#2f80ed;width:{progress}%}}table{{width:100%;border-collapse:collapse;background:white;margin-top:16px}}th,td{{border:1px solid #d8dee8;padding:8px;text-align:left;vertical-align:top}}th{{background:#11263f;color:white}}.risk{{background:#ffd7d7;font-weight:bold}}</style></head><body>
<header><h1>СИМБИОТ SaaS: мониторинг разработки v0.1</h1><p>Старт: 2026-07-01 · MVP Demo: 2026-07-15 · Beta: 2026-07-22 · RC/аудит: 2026-07-29</p></header><main>
<section class='grid'><div class='card'><div>Готовность</div><div class='metric'>{progress}%</div><div class='bar'><div class='fill'></div></div><p>{ready_units} / {total_units} оценочных единиц трудоемкости</p></div><div class='card'><div>Задач КСГ</div><div class='metric'>{len(ksg)}</div><p>Детализация по требованиям ТЗ</p></div><div class='card'><div>Требований из ТЗ</div><div class='metric'>{len(requirements)}</div><p>FR/NFR/AC связаны с задачами</p></div><div class='card'><div>Текущий статус</div><div class='metric'>G0</div><p>Планирование создано; нужен scope freeze</p></div></section>
<h2>Блоки работ</h2><section class='grid'>{block_cards}</section>
<h2>Критические риски</h2><table><tr><th>ID</th><th>Риск</th><th>Уровень</th><th>Мера управления</th><th>Владелец</th></tr>{risk_rows}</table>
<h2>Файлы управления</h2><ul><li>КСГ: {html.escape(str(xlsx_path))}</li><li>Чек-листы: {html.escape(str(cl_path))}</li><li>Анализ ТЗ: {html.escape(str(summary_path))}</li></ul>
</main></body></html>"""
html_path = ROOT / "05_МОНИТОРИНГ" / "index.html"
html_path.write_text(html_doc, encoding="utf-8")

obs_note = f"""# КАРТА_SAAS_РАЗРАБОТКИ_СИМБИОТА

Дата создания: 2026-07-01  
Статус: рабочий контур планирования и контроля разработки

## Связи

- Родительский продукт: [[01_Симбиот_что_и_зачем]]
- Масштабирование: [[03_Симбиот_как_система_масштабирования]]
- Правило задачи: [[Правило администрирования задач в Симбиоте]]
- Ролевая коммуникация: [[Правило ролевой коммуникации Симбиота]]
- Помощники: [[Правило стандартной команды помощников Симбиота]]
- Quality Gates: [[ЧЕК_ЛИСТ_МЕТОДОЛОГИЧЕСКОГО_КАЧЕСТВА_v0.1]]
- Лог дня: [[00_ПРОТОКОЛ_ДНЯ]]

## Физическая папка

`{ROOT}`

## Главные артефакты

- Excel КСГ и мониторинг: `{xlsx_path}`
- Анализ ТЗ и рабочая группа: `{summary_path}`
- Чек-листы: `{cl_path}`
- HTML dashboard: `{html_path}`
- Извлечение ТЗ: `{ROOT / '00_ТЗ_И_АНАЛИЗ' / 'ТЗ_на_разработку_SAAS_извлечение.txt'}`
- Реестр требований: `{ROOT / '00_ТЗ_И_АНАЛИЗ' / 'РЕЕСТР_ТРЕБОВАНИЙ_ИЗ_ТЗ.csv'}`

## Релизная рамка

- G0: 2026-07-01 — управленческий старт создан.
- G1: 2026-07-02 — scope freeze MVP.
- G2: 2026-07-05 — UX + Architecture Freeze.
- G3: 2026-07-10 — Core Integration.
- G4: 2026-07-15 — MVP Demo Release.
- G5: 2026-07-22 — Beta / Hardening.
- G6: 2026-07-29 — RC / Product Audit.

## Условие приемки

MVP не считается готовым без связки: [[Quality Gates]], [[Audit Layer]], [[RAG]], [[LLM Gateway]], [[Runtime]], [[Compiler]], [[Матрица прослеживаемости требований]].
"""
obs_path = OBS_SAAS / "00_КАРТА_SAAS_РАЗРАБОТКИ_СИМБИОТА.md"
obs_path.write_text(obs_note, encoding="utf-8")

protocol_path = LOG_DIR / "00_ПРОТОКОЛ_ДНЯ.md"
if not protocol_path.exists():
    protocol_path.write_text("# ОД-011 2026-07-01 SaaS разработка Симбиота\n\n", encoding="utf-8")
log_entry = f"""
## ЗАДАЧА-001. Планирование SaaS-разработки Симбиота

Дата: 2026-07-01

### Наименование задачи

Полноценное планирование разработки SaaS Runtime Platform по ТЗ `ТЗ на разработку SAAS.docx`.

### Рабочая группа

- [[РОЛЬ_AI_Симбиот_архитектор_системы]] — архитектура и финальный вердикт.
- [[РОЛЬ_AI_Диспетчер_задач_Симбиота]] — КСГ, WBS, задачи, статусы.
- Product Manager / бизнес-аналитик — трассировка ТЗ в требования.
- CTO / IT-директор — техническая реализация и релизная стратегия.
- UX/UI Designer — экраны Runtime.
- Backend Lead, Frontend Lead, AI/LLM Architect, RAG Engineer, DevOps, Security, QA.
- [[РОЛЬ_AI_Секретарь_ЛОС]], [[РОЛЬ_AI_Синхронизатор_ролей]], [[РОЛЬ_AI_Архивариус_и_реестратор]], [[РОЛЬ_AI_Контролер_рисков]], [[РОЛЬ_AI_Учитель_Симбиота]].

### Что сделано

- Извлечено ТЗ: 690 содержательных абзацев, 56 таблиц.
- Выделено {len(requirements)} требований FR/NFR/AC.
- Создан КСГ на {len(ksg)} задач и {total_units} оценочных единиц трудоемкости.
- Созданы чек-листы блоков, риски, релизные gates, HTML dashboard.
- Создана Obsidian-карта SaaS-разработки.

### Артефакты

- `{xlsx_path}`
- `{summary_path}`
- `{cl_path}`
- `{html_path}`
- `{obs_path}`

### Архитектурный вывод

Принято с условиями: перед фактической разработкой нужен G1 Scope Freeze на 2026-07-02 и ежедневный контроль КСГ. Внешняя продажа/показ допустимы только после MVP/Beta/RC gates и аудита продукта.
"""
existing = protocol_path.read_text(encoding="utf-8") if protocol_path.exists() else ""
if "ЗАДАЧА-001. Планирование SaaS-разработки Симбиота" not in existing:
    protocol_path.write_text(existing.rstrip() + "\n" + log_entry + "\n", encoding="utf-8")
(LOG_DIR / "ЗАДАЧА-001_Планирование_SAAS_разработки_Симбиота.md").write_text(log_entry, encoding="utf-8")

manifest = {
    "root": str(ROOT),
    "xlsx": str(xlsx_path),
    "html": str(html_path),
    "summary_docx": str(summary_path),
    "checklists_docx": str(cl_path),
    "obsidian_note": str(obs_path),
    "protocol": str(protocol_path),
    "requirements_count": len(requirements),
    "tasks_count": len(ksg),
    "units_total": total_units,
    "units_done": ready_units,
    "progress_percent": progress,
}
(ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(manifest, ensure_ascii=False, indent=2))

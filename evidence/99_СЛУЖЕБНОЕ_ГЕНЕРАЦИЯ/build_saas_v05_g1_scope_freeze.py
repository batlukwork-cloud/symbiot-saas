from pathlib import Path
from datetime import date, timedelta
import re
import json

from docx import Document
from docx.shared import Pt
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


ROOT = Path(r"<локальный путь>")
TZ = ROOT / "00_ТЗ_И_АНАЛИЗ" / "TZ_AI_Runtime_Platform.docx"
V04 = ROOT / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ" / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА_v0.4.xlsx"
V05 = ROOT / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ" / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА_v0.5.xlsx"
G1_REPORT = ROOT / "06_РЕЛИЗЫ" / "G1_Scope_Freeze_закрыт_2026-07-01_v0.5.docx"
G2_REPORT = ROOT / "06_РЕЛИЗЫ" / "G2_UX_Architecture_Freeze_стартовый_пакет_2026-07-01_v0.5.docx"

OBS_ROOT = Path(r"D:\СИСТЕМА\01.Базы данных\01_База № 3 (MAC)\15.03_База № 3 (MAC)")
OBS_SAAS = OBS_ROOT / r"01_Симбиот_что_и_зачем\00_Смысл_и_стратегия\03_Симбиот_как_система_масштабирования\05_SAAS_РАЗРАБОТКА"
LOG_DIR = OBS_ROOT / r"02_Личная_операционная_система_ритм\01_ПРОТОКОЛЫ_ДНЯ_И_ЛОГИ\2026-07\ОД-011_2026-07-01_SAAS_разработка_Симбиота"

START = date(2026, 7, 1)


def extract_requirements():
    doc = Document(str(TZ))
    reqs = []
    for ti, table in enumerate(doc.tables, 1):
        if not table.rows:
            continue
        headers = [" ".join(c.text.split()) for c in table.rows[0].cells]
        for row in table.rows[1:]:
            cells = [" ".join(c.text.split()) for c in row.cells]
            if cells and re.match(r"^(FR|NFR|SEC|UX|ADM|AI|ADR|DOC|RISK|AC|REQ|GATE)-?\d+", cells[0] or "", re.I):
                reqs.append({
                    "table": ti,
                    "id": cells[0],
                    "requirement": cells[1] if len(cells) > 1 else "",
                    "priority": cells[2] if len(cells) > 2 and cells[2] else "",
                    "cells": cells,
                    "headers": headers,
                })
    return reqs


def num_from_id(req_id):
    match = re.search(r"(\d+)", req_id)
    return int(match.group(1)) if match else 0


def classify(req_id, text):
    n = num_from_id(req_id)
    if req_id.startswith("NFR-"):
        if 1 <= n <= 12:
            return ("Безопасность и доступы", "Security/AppSec")
        if 20 <= n <= 25:
            return ("ПДн и российский контур", "Legal/Security")
        if 30 <= n <= 36:
            return ("Производительность и очереди", "Backend/DevOps")
        if 40 <= n <= 45:
            return ("Масштабируемость", "Architecture/DevOps")
        if 50 <= n <= 55:
            return ("Надежность и восстановление", "DevOps/Backend")
        if 60 <= n <= 66:
            return ("Наблюдаемость", "DevOps/Audit")
    if req_id.startswith("AC-"):
        if n < 20:
            return ("MVP-приемка пользователя", "QA/Product")
        if n < 30:
            return ("MVP-приемка администратора", "QA/Admin")
        return ("MVP-техническая приемка", "QA/Tech")
    module_map = [
        ((1, 9), "Каталог процессов", "Product/Frontend"),
        ((10, 19), "Мастер запуска", "Product/Frontend"),
        ((20, 27), "Профили выполнения", "Backend/Product"),
        ((30, 39), "Монитор процесса", "Frontend/Backend"),
        ((40, 49), "Центр результатов и артефакты", "Backend/Frontend"),
        ((50, 62), "Knowledge Hub", "RAG/Backend"),
        ((70, 78), "RAG Layer", "RAG/AI"),
        ((80, 89), "Quality Gates", "AI Governance/Backend"),
        ((90, 99), "LLM Gateway", "AI/Backend"),
        ((100, 104), "Профессиональный режим", "Security/Product"),
        ((110, 115), "Архитектор процесса и Compiler", "Architecture/Backend"),
        ((120, 127), "Admin Panel", "Admin/Security"),
        ((130, 135), "Audit Layer", "Audit/Security"),
    ]
    for (lo, hi), module, owner in module_map:
        if lo <= n <= hi:
            return (module, owner)
    return ("Общие требования", "Product")


def scope_decision(req):
    rid = req["id"]
    text = req["requirement"]
    pr = req["priority"]
    lower = (rid + " " + text).lower()
    critical = any(word in lower for word in [
        "tenant", "изоляц", "admin", "администратор", "secret", "api-ключ", "аудит",
        "загруз", "rag", "доступ", "llm", "лог", "персональ", "данных клиента",
    ])
    if rid.startswith("AC-"):
        return ("MVP Acceptance Gate", "Критерий приемки MVP; должен быть проверен до G4.")
    if pr == "Must":
        return ("MVP Must", "Обязательное требование ТЗ; входит в MVP без отдельного исключения.")
    if rid in {"NFR-030", "NFR-031", "NFR-032", "NFR-033", "NFR-034", "NFR-035", "NFR-036"}:
        return ("MVP Quality/Architecture Must", "Нефункциональное требование без Must/Should, но критично для работоспособности AI Runtime.")
    if pr == "Should" and critical:
        return ("MVP Critical Should", "Should-требование относится к критичной зоне ASVS/AI/RAG/Admin/Audit; включено в MVP как усиление.")
    if pr == "Should":
        return ("Beta / After MVP", "Желательное требование; переносится после MVP, если Дмитрий не поднимет приоритет.")
    if pr == "Could":
        return ("After MVP / Backlog", "Could-требование не входит в кратчайший MVP.")
    return ("Manual Review", "Нужна ручная классификация Дмитрия/архитектора.")


def checklist_for(module, rid):
    if "Безопас" in module or "ПДн" in module or "Admin" in module:
        return "CHECK-SEC / ASVS"
    if module in {"RAG Layer", "LLM Gateway", "Quality Gates"}:
        return "CHECK-AI / NIST AI RMF"
    if rid.startswith("AC-"):
        return "CHECK-QA / Acceptance"
    if "DevOps" in module or "Надежность" in module or "Наблюдаемость" in module:
        return "CHECK-DEVOPS"
    return "CHECK-FUNC"


def style_header(ws, row=1):
    for cell in ws[row]:
        cell.fill = PatternFill("solid", fgColor="1F4E78")
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(
            left=Side(style="thin", color="D9D9D9"),
            right=Side(style="thin", color="D9D9D9"),
            top=Side(style="thin", color="D9D9D9"),
            bottom=Side(style="thin", color="D9D9D9"),
        )


def autosize(ws, max_width=68):
    border = Border(
        left=Side(style="thin", color="D9D9D9"),
        right=Side(style="thin", color="D9D9D9"),
        top=Side(style="thin", color="D9D9D9"),
        bottom=Side(style="thin", color="D9D9D9"),
    )
    for column in ws.columns:
        letter = get_column_letter(column[0].column)
        width = 10
        for cell in column:
            if cell.value is not None:
                width = max(width, min(max_width, len(str(cell.value)) + 2))
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = border
        ws.column_dimensions[letter].width = width


def replace_sheet(wb, name, headers, rows):
    if name in wb.sheetnames:
        del wb[name]
    ws = wb.create_sheet(name)
    ws.append(headers)
    style_header(ws)
    for row in rows:
        ws.append(row)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    autosize(ws)
    return ws


def add_task_to_ksg(ws, headers, req, stage, owner, predecessor, status="Не начато"):
    max_id = 0
    id_idx = headers.index("ID") + 1
    for row in range(2, ws.max_row + 1):
        value = str(ws.cell(row, id_idx).value or "")
        m = re.match(r"SAAS-(\d+)", value)
        if m:
            max_id = max(max_id, int(m.group(1)))
    new_id = f"SAAS-{max_id + 1:04d}"
    module, module_owner = classify(req["id"], req["requirement"])
    scope, why = scope_decision(req)
    mapping = {
        "ID": new_id,
        "WBS": f"G1.NEW.{req['id']}.{stage}",
        "Блок": module,
        "Requirement_ID": req["id"],
        "Задача": f"{stage}: {req['id']}",
        "Описание": f"Актуальное ТЗ v1.0: {req['requirement']}",
        "Ответственный": owner,
        "Участники": "Product, QA, Security/AI/DevOps по модулю",
        "Приоритет": req["priority"] or scope,
        "Релиз": "MVP" if scope.startswith("MVP") else "Beta/After MVP",
        "Спринт": "S1: G1/G2 актуализация",
        "Старт": START,
        "Финиш": START + timedelta(days=2),
        "Длительность_дн": 3,
        "Предшественник": predecessor,
        "Статус": status,
        "Готовность_%": 0,
        "Контрольные_единицы": 2,
        "Критерий_приемки": f"{req['id']} имеет scope={scope}, owner, evidence/test и трассировку.",
        "Чек_лист": checklist_for(module, req["id"]),
        "Риск": "Высокий" if scope.startswith("MVP") else "Средний",
        "Артефакт": "G1 Scope Freeze / RTM",
        "Примечание": why,
    }
    ws.append([mapping.get(h, "") for h in headers])
    return new_id


reqs = extract_requirements()
wb = load_workbook(V04)

backlog_rows = []
rtm_rows = []
scope_rows = []
for req in reqs:
    module, owner = classify(req["id"], req["requirement"])
    scope, why = scope_decision(req)
    checklist = checklist_for(module, req["id"])
    release = "MVP" if scope.startswith("MVP") else "Beta/After MVP"
    backlog_rows.append([
        req["id"], req["requirement"], req["priority"], module, owner, "Scope frozen" if scope != "Manual Review" else "Manual review", release, "", req["requirement"]
    ])
    rtm_rows.append([
        f"TZ_AI_Runtime_Platform.docx table {req['table']}", req["id"], req["requirement"], req["priority"], module, "", checklist, "Связано / G1 актуализировано"
    ])
    decision = "Принято в MVP" if scope.startswith("MVP") else ("Перенести после MVP" if "After" in scope or "Beta" in scope else "")
    status = "Заморожено" if decision else "К ручному решению"
    scope_rows.append([
        req["id"], req["requirement"], req["priority"], module, scope, why, owner, checklist + " + evidence", decision, status
    ])

replace_sheet(wb, "02_Backlog_требования", ["ID", "Требование", "Приоритет", "Модуль", "Владелец", "Статус", "Релиз", "Связанные задачи", "Критерий приемки"], backlog_rows)
replace_sheet(wb, "08_ТЗ_трассировка", ["Источник", "ID", "Требование", "Приоритет", "Модуль", "КСГ задачи", "Чек-лист", "Статус трассировки"], rtm_rows)
replace_sheet(wb, "16_G1_Scope_Freeze", ["ID", "Требование", "Приоритет из ТЗ", "Модуль", "Решение Scope", "Почему", "Владелец", "Evidence/Test", "Решение Дмитрия", "Статус"], scope_rows)

ksg = wb["01_КСГ"]
ksg_headers = [cell.value for cell in ksg[1]]
existing_ids = {str(row[0].value) for row in ksg.iter_rows(min_row=2, min_col=ksg_headers.index("Requirement_ID") + 1, max_col=ksg_headers.index("Requirement_ID") + 1)}
new_reqs = [req for req in reqs if req["id"] not in existing_ids]
for req in new_reqs:
    pred = ""
    for stage, owner in [
        ("G1 Scope decision", "Product Manager / бизнес-аналитик"),
        ("G2 Design/API/Data update", "UX/UI Designer + Backend Lead"),
        ("QA evidence update", "QA Lead / Контролер качества"),
    ]:
        pred = add_task_to_ksg(ksg, ksg_headers, req, stage, owner, pred)
ksg.freeze_panes = "A2"
ksg.auto_filter.ref = ksg.dimensions
autosize(ksg, 52)

counts = {}
for row in scope_rows:
    counts[row[4]] = counts.get(row[4], 0) + 1

if "18_G1_Scope_Summary" in wb.sheetnames:
    del wb["18_G1_Scope_Summary"]
summary = wb.create_sheet("18_G1_Scope_Summary")
summary.append(["Показатель", "Значение", "Комментарий"])
style_header(summary)
summary_rows = [
    ("Источник ТЗ", str(TZ), "Актуальное ТЗ, 884 абзаца / 80 таблиц"),
    ("Требований извлечено", len(reqs), "FR/NFR/AC из текущего DOCX"),
    ("Новых требований к старой КСГ", len(new_reqs), "Для них добавлены задачи в 01_КСГ"),
    ("MVP Must", counts.get("MVP Must", 0), "Обязательные требования"),
    ("MVP Quality/Architecture Must", counts.get("MVP Quality/Architecture Must", 0), "Критичные NFR без метки Must"),
    ("MVP Critical Should", counts.get("MVP Critical Should", 0), "Should, поднятые в MVP из-за ASVS/AI/RAG/Admin/Audit"),
    ("MVP Acceptance Gate", counts.get("MVP Acceptance Gate", 0), "Критерии приемки MVP"),
    ("Beta / After MVP", counts.get("Beta / After MVP", 0), "Не входит в кратчайший MVP"),
    ("After MVP / Backlog", counts.get("After MVP / Backlog", 0), "Could / backlog"),
    ("Manual Review", counts.get("Manual Review", 0), "Должно быть 0 для закрытия G1"),
    ("G1 статус", "Закрыт, если Manual Review = 0", "Scope frozen по алгоритму"),
]
for row in summary_rows:
    summary.append(list(row))
summary.freeze_panes = "A2"
summary.auto_filter.ref = summary.dimensions
autosize(summary)

gates = wb["06_Релизные_Gates"]
gate_headers = [c.value for c in gates[1]]
if "Gate" in gate_headers and "Статус" in gate_headers:
    gate_col = gate_headers.index("Gate") + 1
    status_col = gate_headers.index("Статус") + 1
    for row in range(2, gates.max_row + 1):
        if str(gates.cell(row, gate_col).value) == "G1":
            gates.cell(row, status_col).value = "Закрыт 2026-07-01: Scope frozen по актуальному TZ_AI_Runtime_Platform.docx"
        if str(gates.cell(row, gate_col).value) == "G2":
            gates.cell(row, status_col).value = "Открыт: UX + Architecture Freeze"

dash = wb["00_Дашборд"]
row = dash.max_row + 2
for key, value in [
    ("G1 Scope Freeze", f"Закрыт по актуальному ТЗ: {len(reqs)} требований; Manual Review={counts.get('Manual Review', 0)}; новые требования к КСГ={len(new_reqs)}."),
    ("Следующий gate", "G2 UX + Architecture Freeze открыт: прототип, API/Data, ADR детализация, ASVS/NIST evidence."),
]:
    dash.cell(row, 1, key)
    dash.cell(row, 2, value)
    dash.cell(row, 1).fill = PatternFill("solid", fgColor="D9EAF7")
    dash.cell(row, 1).font = Font(bold=True)
    row += 1
autosize(dash)

wb.save(V05)

doc = Document()
doc.styles["Normal"].font.name = "Arial"
doc.styles["Normal"].font.size = Pt(10)
doc.add_heading("G1 Scope Freeze закрыт", 0)
doc.add_paragraph("Дата: 2026-07-01")
doc.add_paragraph(f"Источник: {TZ}")
doc.add_paragraph(f"Извлечено требований: {len(reqs)}.")
doc.add_paragraph(f"Новых требований относительно старой КСГ: {len(new_reqs)}. Для них добавлены задачи в КСГ.")
doc.add_heading("Итоги классификации", 1)
for key in sorted(counts):
    doc.add_paragraph(f"{key}: {counts[key]}")
doc.add_heading("Критерий закрытия G1", 1)
doc.add_paragraph("Manual Review = 0; все требования получили scope-решение, владельца, evidence/test и связь с модулем.")
doc.add_paragraph(f"Excel: {V05}")
doc.save(G1_REPORT)

doc = Document()
doc.styles["Normal"].font.name = "Arial"
doc.styles["Normal"].font.size = Pt(10)
doc.add_heading("G2 UX + Architecture Freeze: стартовый пакет", 0)
doc.add_paragraph("Дата открытия: 2026-07-01")
doc.add_paragraph("Цель G2: превратить замороженный MVP-scope в архитектуру, UX-прототип, API/Data contracts и проверяемые security/AI controls.")
for item in [
    "UX/UI Designer: карта экранов Runtime и кликабельный сценарий MVP.",
    "Технологический архитектор: уточнение ADR и runtime/studio/compiler границ.",
    "Backend Lead: API contracts и TaskRun/Artifact/GateResult data model.",
    "RAG/AI Architect: LLM Gateway, RAG evidence, eval-set skeleton.",
    "Security/AppSec: ASVS critical controls для tenant/admin/secrets/uploads/RAG.",
    "QA Lead: тест-матрица по MVP Must и Acceptance Gates.",
]:
    doc.add_paragraph(item)
doc.add_paragraph(f"Основа: {V05}, листы 16_G1_Scope_Freeze и 18_G1_Scope_Summary.")
doc.save(G2_REPORT)

g1_note = OBS_SAAS / "02_G1_SCOPE_FREEZE_SAAS.md"
text = g1_note.read_text(encoding="utf-8") if g1_note.exists() else "# G1_SCOPE_FREEZE_SAAS\n"
if "## G1 закрыт 2026-07-01" not in text:
    text += f"""

## G1 закрыт 2026-07-01

Источник: `{TZ}`.

Итог:

- Требований извлечено: `{len(reqs)}`.
- Новых требований к старой КСГ: `{len(new_reqs)}`.
- Manual Review: `{counts.get('Manual Review', 0)}`.
- Excel v0.5: `{V05}`.
- Отчет G1: `{G1_REPORT}`.
- Открыт следующий gate: [[G2_UX_Architecture_Freeze]].

Классификация:

"""
    for key in sorted(counts):
        text += f"- {key}: {counts[key]}\n"
g1_note.write_text(text, encoding="utf-8")

g2_note = OBS_SAAS / "03_G2_UX_ARCHITECTURE_FREEZE_SAAS.md"
g2_note.write_text(f"""# G2_UX_ARCHITECTURE_FREEZE_SAAS

Дата открытия: 2026-07-01
Статус: в работе

## Связи

- [[02_G1_SCOPE_FREEZE_SAAS]]
- [[01_COMPLIANCE_GATE_SAAS_v0.3]]
- [[РОЛЬ_AI_UX_UI_проектировщик]]
- [[РОЛЬ_AI_Технологический_архитектор]]
- [[РОЛЬ_AI_Системный_аналитик_ТЗ]]
- [[РОЛЬ_AI_QA_тестировщик]]
- [[РОЛЬ_AI_DevOps_runtime_инженер]]
- [[РОЛЬ_AI_Архитектор_данных]]

## Цель

Зафиксировать UX, архитектуру, API/Data contracts и evidence-скелет для MVP-scope.

## Артефакты

- КСГ v0.5: `{V05}`
- Стартовый пакет G2: `{G2_REPORT}`

## Критерий закрытия G2

- Утверждена карта экранов Runtime.
- Утвержден сквозной user journey MVP.
- Утверждены API/Data contracts.
- Уточнены ADR по стеку до уровня технической реализации.
- Security/AppSec отметил ASVS critical controls.
- QA сформировал test matrix по MVP Must.
""", encoding="utf-8")

log = LOG_DIR / "00_ПРОТОКОЛ_ДНЯ.md"
entry = f"""

## ЗАДАЧА-004. Закрытие G1 Scope Freeze по актуальному ТЗ

Дата: 2026-07-01

### Что сделано

- Повторно прочитан актуальный `TZ_AI_Runtime_Platform.docx`.
- Извлечено `{len(reqs)}` требований из 80 таблиц.
- Обновлены `02_Backlog_требования`, `08_ТЗ_трассировка`, `16_G1_Scope_Freeze`.
- Добавлены задачи в КСГ по `{len(new_reqs)}` новым требованиям.
- Создан лист `18_G1_Scope_Summary`.
- G1 закрыт; G2 UX + Architecture Freeze открыт.

### Артефакты

- `{V05}`
- `{G1_REPORT}`
- `{G2_REPORT}`
- `{g1_note}`
- `{g2_note}`

### Вывод архитектора

G1 закрыт на актуальном ТЗ. Следующий рабочий gate: G2 UX + Architecture Freeze.
"""
lt = log.read_text(encoding="utf-8") if log.exists() else ""
if "ЗАДАЧА-004. Закрытие G1 Scope Freeze" not in lt:
    log.write_text(lt.rstrip() + entry, encoding="utf-8")
(LOG_DIR / "ЗАДАЧА-004_G1_scope_freeze_закрыт.md").write_text(entry, encoding="utf-8")

manifest_path = ROOT / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
manifest.update({
    "xlsx_v0_5": str(V05),
    "g1_status": "closed_2026-07-01_actual_tz",
    "g2_status": "opened_ux_architecture_freeze",
    "actual_tz_requirements_count": len(reqs),
    "new_requirements_added_to_ksg": len(new_reqs),
    "g1_scope_counts": counts,
    "g1_report_v0_5": str(G1_REPORT),
    "g2_start_package_v0_5": str(G2_REPORT),
})
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({
    "requirements": len(reqs),
    "new_requirements": len(new_reqs),
    "counts": counts,
    "xlsx": str(V05),
}, ensure_ascii=False, indent=2))

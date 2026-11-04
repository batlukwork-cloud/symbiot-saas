from pathlib import Path
from datetime import date
import json
from collections import Counter

from docx import Document
from docx.shared import Pt
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


ROOT = Path(r"<локальный путь>")
V05 = ROOT / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ" / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА_v0.5.xlsx"
V06 = ROOT / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ" / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА_v0.6.xlsx"
REL = ROOT / "06_РЕЛИЗЫ"
ARCH = ROOT / "02_АРХИТЕКТУРА"
REL.mkdir(parents=True, exist_ok=True)
ARCH.mkdir(parents=True, exist_ok=True)
G2_DOC = REL / "G2_UX_Architecture_Freeze_пакет_согласования_2026-07-01_v0.6.docx"
API_DOC = ARCH / "API_Data_Contracts_MVP_SaaS_Runtime_v0.6.docx"
QA_DOC = REL / "QA_Test_Matrix_MVP_SaaS_Runtime_v0.6.docx"

OBS_ROOT = Path(r"D:\СИСТЕМА\01.Базы данных\01_База № 3 (MAC)\15.03_База № 3 (MAC)")
OBS_SAAS = OBS_ROOT / r"01_Симбиот_что_и_зачем\00_Смысл_и_стратегия\03_Симбиот_как_система_масштабирования\05_SAAS_РАЗРАБОТКА"
LOG_DIR = OBS_ROOT / r"02_Личная_операционная_система_ритм\01_ПРОТОКОЛЫ_ДНЯ_И_ЛОГИ\2026-07\ОД-011_2026-07-01_SAAS_разработка_Симбиота"


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


def autosize(ws, max_width=70):
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


wb = load_workbook(V05)
scope_ws = wb["16_G1_Scope_Freeze"]
headers = [c.value for c in scope_ws[1]]
scope_rows = [dict(zip(headers, row)) for row in scope_ws.iter_rows(min_row=2, values_only=True)]
mvp_rows = [r for r in scope_rows if str(r["Решение Scope"]).startswith("MVP")]
module_counts = Counter(r["Модуль"] for r in mvp_rows)

screen_rows = [
    ("SCR-001", "Login / Auth", "Пользователь входит в систему", "AC-001, NFR-001..012", "ASVS auth/session", "MVP Must", "UX/UI + Security", "Макет + auth flow"),
    ("SCR-002", "Главная панель Runtime", "Показывает доступные действия, активные задачи, последние результаты", "FR-030..039, AC-006", "ASVS access + audit", "MVP Must", "UX/UI + Frontend", "Dashboard wireframe"),
    ("SCR-003", "Каталог процессов", "Поиск, группы, карточки процессов, доступы", "FR-001..009, AC-002", "RBAC/tenant", "MVP Must", "Product + Frontend", "Catalog wireframe"),
    ("SCR-004", "Карточка процесса", "Бизнес-описание, входные данные, ожидаемый результат, профиль выполнения", "FR-002, FR-008, FR-014..019", "No prompt leakage", "MVP Must", "Product + UX", "Process card"),
    ("SCR-005", "Мастер запуска", "Форма запуска процесса, документы, проверки полноты", "FR-010..019, AC-003, AC-004", "ASVS input/file upload", "MVP Must", "UX + Backend", "Wizard flow"),
    ("SCR-006", "Профили выполнения", "Черновик/рабочий/экспертный/публикация, стоимость и контроль", "FR-020..027", "AI RMF Govern", "MVP Must", "AI Architect + Product", "Profile matrix"),
    ("SCR-007", "Монитор процесса", "Этапы, статусы, фоновые задачи, ошибки, gate stops", "FR-030..039, NFR-031..036", "Audit + reliability", "MVP Must", "Frontend + Backend", "Run monitor"),
    ("SCR-008", "Quality Gate detail", "Показывает какой gate остановил процесс и что делать", "FR-080..089, AC-009, AC-034", "NIST Measure/Manage", "MVP Must", "AI/QA", "Gate evidence view"),
    ("SCR-009", "Результат / Artifact", "Версия результата, источники, проверки, экспорт", "FR-040..049, AC-007..010", "Audit + source evidence", "MVP Must", "Frontend + Backend", "Result screen"),
    ("SCR-010", "Knowledge Hub", "Загрузка документов, статус индексации, метаданные, права", "FR-050..062, AC-004, AC-005", "ASVS file upload + RAG access", "MVP Must", "RAG + Backend", "Knowledge screen"),
    ("SCR-011", "Admin: пользователи и роли", "Создание пользователей, роли, ограничения доступа", "FR-120..127, AC-020..025", "ASVS L2/L3 access control", "MVP Must", "Admin + Security", "Admin RBAC screen"),
    ("SCR-012", "Admin: LLM providers", "Подключение провайдера, ключи, fallback, лимиты", "FR-090..099, AC-022, AC-031..032", "Secrets + LLM gateway", "MVP Must", "AI + Security + DevOps", "Provider setup screen"),
    ("SCR-013", "Audit Log", "Фильтрация событий, результаты gates, действия админов", "FR-130..135, NFR-011, AC-024", "Immutable audit/redaction", "MVP Must", "Audit + Security", "Audit screen"),
    ("SCR-014", "System Health", "Ошибки, очереди, AI-cost, здоровье системы", "NFR-060..066", "Observability", "MVP Quality", "DevOps/SRE", "Ops dashboard"),
]

journey_rows = [
    ("JRN-001", "Бизнес-пользователь запускает процесс", "Login -> Catalog -> Process Card -> Wizard -> Profile -> Run -> Monitor -> Gate/Result -> Export", "AC-001..010", "Основной MVP value path", "E2E test + UX clickthrough"),
    ("JRN-002", "Администратор готовит пространство клиента", "Login -> Admin Users -> Roles -> LLM Provider -> Knowledge Hub -> Enable Process -> Audit", "AC-020..025, AC-031", "Нужен для демонстрации SaaS как управляемой платформы", "Admin E2E"),
    ("JRN-003", "Knowledge/RAG контур", "Upload -> Extract -> Chunk -> Embed -> Index -> Search -> Citations -> Result", "FR-050..078, AC-005, AC-008, AC-033", "Критично для доверия к ответам", "RAG eval"),
    ("JRN-004", "Gate failure / human approval", "Run -> Gate fails -> Explanation -> User action / human approval -> retry/stop -> audit", "FR-080..089, AC-009, AC-034", "Ключевое отличие от обычного чата", "Gate behavior test"),
    ("JRN-005", "LLM provider fallback", "Run -> provider error -> retry/fallback -> audit -> user-safe message", "FR-090..099, AC-031..036", "Не ломать процесс при сбое модели", "LLM failure test"),
]

api_rows = [
    ("AUTH-001", "POST /auth/login", "email,password", "session/token", "SCR-001", "ASVS auth/session", "MVP"),
    ("TENANT-001", "GET/POST /tenants", "tenant settings", "tenant record", "Admin", "tenant isolation", "MVP internal/admin"),
    ("USER-001", "GET/POST /users", "user, role, tenant", "user record", "SCR-011", "RBAC", "MVP"),
    ("PROCESS-001", "GET /processes", "filters, role, tenant", "process list", "SCR-003", "access control", "MVP"),
    ("PROCESS-002", "GET /processes/{id}", "process id/version", "process card", "SCR-004", "protected logic boundary", "MVP"),
    ("RUN-001", "POST /task-runs", "process_id, form_data, files, profile", "task_run_id", "SCR-005", "validation/audit", "MVP"),
    ("RUN-002", "GET /task-runs/{id}", "task_run_id", "status, stages, gates", "SCR-007", "state recovery", "MVP"),
    ("RUN-003", "POST /task-runs/{id}/cancel", "task_run_id", "cancel result", "SCR-007", "audit", "MVP"),
    ("DOC-001", "POST /documents", "file, metadata, permissions", "document_id/status", "SCR-010", "ASVS file upload", "MVP"),
    ("DOC-002", "GET /documents/{id}/index-status", "document_id", "index status", "SCR-010", "RAG evidence", "MVP"),
    ("RAG-001", "POST /rag/search", "query, scope, tenant, process", "chunks, scores, citations", "SCR-010", "access-filtered RAG", "MVP internal"),
    ("LLM-001", "POST /llm/generate", "messages, profile, provider_policy", "generation result", "Core", "provider abstraction", "MVP internal"),
    ("GATE-001", "POST /task-runs/{id}/gates/{gate}/evaluate", "artifact/state", "gate result", "SCR-008", "AI RMF Measure", "MVP internal"),
    ("ART-001", "GET /artifacts/{id}", "artifact_id", "artifact + version + sources", "SCR-009", "result evidence", "MVP"),
    ("ART-002", "POST /artifacts/{id}/export", "format docx/pdf", "file", "SCR-009", "audit/export", "MVP"),
    ("AUDIT-001", "GET /audit-events", "filters, tenant, actor", "events", "SCR-013", "redaction/immutability", "MVP"),
    ("ADMIN-LLM-001", "POST /admin/llm-providers", "provider config, secret ref", "provider status", "SCR-012", "secrets storage", "MVP"),
    ("HEALTH-001", "GET /system/health", "none", "queues/errors/providers", "SCR-014", "observability", "MVP internal"),
]

data_rows = [
    ("Tenant", "id,name,region,data_residency_policy,status", "User,Document,Process,TaskRun", "tenant isolation", "MVP"),
    ("User", "id,tenant_id,email,role_ids,status,mfa_flag", "Tenant,Role,AuditEvent", "RBAC/MFA", "MVP"),
    ("Role", "id,tenant_id,name,permissions", "User,ProcessPermission", "access control", "MVP"),
    ("Process", "id,version,name,description,inputs,expected_output,category,status", "ProcessVersion,TaskRun", "protected process metadata", "MVP"),
    ("ExecutionProfile", "id,name,rag_depth,gate_level,human_approval,cost_limit", "TaskRun", "AI governance", "MVP"),
    ("TaskRun", "id,tenant_id,process_id,user_id,profile_id,status,current_stage,cost,timestamps", "GateResult,Artifact,AuditEvent", "state recovery", "MVP"),
    ("Document", "id,tenant_id,name,type,metadata,owner,permissions,index_status,version", "SourceChunk", "file/RAG access", "MVP"),
    ("SourceChunk", "id,document_id,text_hash,embedding_ref,metadata,access_scope", "RAGSearchResult", "RAG evidence", "MVP"),
    ("GateResult", "id,task_run_id,gate_type,status,score,reason,action,evidence", "TaskRun,Artifact", "Quality Gates", "MVP"),
    ("Artifact", "id,task_run_id,type,version,content_ref,sources,checks,status", "AuditEvent", "result as artifact", "MVP"),
    ("LLMProvider", "id,tenant_id,type,secret_ref,limits,status,external_allowed", "TaskRun", "secrets/provider governance", "MVP"),
    ("AuditEvent", "id,tenant_id,actor,action,target,timestamp,redacted_payload,hash", "All", "immutability/redaction", "MVP"),
]

evidence_rows = [
    ("SEC-001", "Tenant isolation", "ASVS L2/L3", "NFR-006, AC-038", "Access-control tests, tenant boundary tests", "Security Architect", "G3/G4"),
    ("SEC-002", "Admin panel access", "ASVS L2/L3", "FR-120..127, AC-020..025", "RBAC tests, admin action audit", "AppSec + QA", "G4"),
    ("SEC-003", "Secrets and LLM API keys", "ASVS L2/L3", "FR-099, NFR-003", "Secrets storage evidence, no secrets in logs", "DevOps + Security", "G3/G4"),
    ("SEC-004", "Audit logs redaction/immutability", "ASVS L2/L3", "FR-130..135, NFR-007, NFR-024", "Audit event tests, redaction tests", "Backend + Security", "G4"),
    ("SEC-005", "File upload safety", "ASVS L2/L3", "FR-050..062", "File type/size validation, parsing sandbox policy", "RAG + AppSec", "G3"),
    ("SEC-006", "RAG access filtering", "ASVS L2/L3 + NIST Map", "FR-058, FR-071, FR-078", "Source access tests, forbidden chunk tests", "RAG Engineer + QA", "G3/G4"),
    ("AI-001", "Eval sets", "NIST Measure", "RAG/LLM/Gates", "Factuality, source coverage, format, gate behavior evals", "AI Architect + QA", "G3"),
    ("AI-002", "Fallback and provider failure", "NIST Manage", "FR-092, AC-036", "Provider failure test, fallback audit", "AI Architect + SRE", "G3/G4"),
    ("AI-003", "Human approval policy", "NIST Govern/Manage", "FR-086, FR-027", "Approval matrix and gate behavior evidence", "Product + Risk", "G4"),
    ("OBS-001", "Health and cost monitoring", "12207 operation + NIST Manage", "NFR-060..066", "Dashboard metrics, alert rules", "DevOps/SRE", "G5"),
]

qa_rows = []
for row in mvp_rows:
    qa_rows.append((
        "TC-" + str(row["ID"]),
        row["ID"],
        row["Модуль"],
        row["Решение Scope"],
        row["Evidence/Test"],
        "P0" if row["Решение Scope"] in {"MVP Must", "MVP Acceptance Gate"} else "P1",
        "Не начато",
        "QA Lead / Контролер качества",
    ))

replace_sheet(wb, "19_G2_Screen_Map", ["ID", "Экран", "Назначение", "Связанные требования", "Security/AI контроль", "Scope", "Владелец", "Артефакт G2"], screen_rows)
replace_sheet(wb, "20_G2_User_Journeys", ["ID", "Сценарий", "Шаги", "Связанные требования", "Почему важно", "Evidence/Test"], journey_rows)
replace_sheet(wb, "21_G2_API_Contracts", ["ID", "Endpoint", "Input", "Output", "Экран/модуль", "Контроль", "Scope"], api_rows)
replace_sheet(wb, "22_G2_Data_Model", ["Entity", "Ключевые поля", "Связи", "Контроль", "Scope"], data_rows)
replace_sheet(wb, "23_G2_ASVS_NIST_Evidence", ["ID", "Контроль", "Стандарт", "Связанные требования", "Evidence", "Владелец", "Gate"], evidence_rows)
replace_sheet(wb, "24_G2_QA_Test_Matrix", ["Test ID", "Requirement ID", "Модуль", "Scope", "Evidence/Test", "Priority", "Статус", "Владелец"], qa_rows)

if "25_G2_Architecture_Backlog" in wb.sheetnames:
    del wb["25_G2_Architecture_Backlog"]
arch_rows = [
    ("G2-ARCH-001", "Утвердить Runtime/Studio/Compiler границы", "ADR/API/Data", "Технологический архитектор", "Открыто"),
    ("G2-ARCH-002", "Подготовить ERD MVP", "Data model", "Архитектор данных", "Открыто"),
    ("G2-ARCH-003", "Подготовить OpenAPI skeleton", "API contracts", "Backend Lead", "Открыто"),
    ("G2-ARCH-004", "Подготовить UX wireframes", "Screen map", "UX/UI проектировщик", "Открыто"),
    ("G2-ARCH-005", "Подготовить ASVS critical controls test plan", "ASVS evidence", "Security Architect", "Открыто"),
    ("G2-ARCH-006", "Подготовить NIST AI RMF eval-set skeleton", "AI evidence", "AI Architect + QA", "Открыто"),
]
replace_sheet(wb, "25_G2_Architecture_Backlog", ["ID", "Задача", "Основание", "Владелец", "Статус"], arch_rows)

gates = wb["06_Релизные_Gates"]
gate_headers = [c.value for c in gates[1]]
gate_col = gate_headers.index("Gate") + 1
status_col = gate_headers.index("Статус") + 1
for r in range(2, gates.max_row + 1):
    if str(gates.cell(r, gate_col).value) == "G2":
        gates.cell(r, status_col).value = "Готов к согласованию: UX/API/Data/ASVS/NIST/QA пакет v0.6"

dash = wb["00_Дашборд"]
row = dash.max_row + 2
for key, value in [
    ("G2 UX + Architecture Freeze", "Пакет подготовлен к согласованию: screen map, journeys, API contracts, data model, ASVS/NIST evidence, QA matrix."),
    ("MVP scope для проектирования", f"{len(mvp_rows)} MVP-scope требований; top modules: " + ", ".join(f"{k}={v}" for k, v in module_counts.most_common(5))),
]:
    dash.cell(row, 1, key)
    dash.cell(row, 2, value)
    dash.cell(row, 1).fill = PatternFill("solid", fgColor="D9EAF7")
    dash.cell(row, 1).font = Font(bold=True)
    row += 1
autosize(dash)

wb.save(V06)


def save_doc(path, title, sections):
    doc = Document()
    doc.styles["Normal"].font.name = "Arial"
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_heading(title, 0)
    doc.add_paragraph("Дата: 2026-07-01")
    for heading, lines in sections:
        doc.add_heading(heading, 1)
        for line in lines:
            doc.add_paragraph(str(line))
    doc.save(path)


save_doc(G2_DOC, "G2 UX + Architecture Freeze: пакет согласования v0.6", [
    ("Статус", ["Готов к согласованию Дмитрием. G2 не закрыт до утверждения UX/API/Data/Architecture package."]),
    ("Карта экранов", [f"{row[0]}: {row[1]} — {row[2]}" for row in screen_rows]),
    ("Сквозные сценарии", [f"{row[0]}: {row[1]} — {row[2]}" for row in journey_rows]),
    ("Критерии закрытия G2", [
        "Утверждена карта экранов Runtime.",
        "Утвержден сквозной user journey MVP.",
        "Утверждены API/Data contracts.",
        "Уточнены ADR по стеку до уровня технической реализации.",
        "Security/AppSec отметил ASVS critical controls.",
        "QA сформировал test matrix по MVP Must.",
    ]),
    ("Файл управления", [str(V06)]),
])

save_doc(API_DOC, "API/Data Contracts MVP SaaS Runtime v0.6", [
    ("API Contracts", [f"{row[0]} {row[1]}: input={row[2]}; output={row[3]}; control={row[5]}" for row in api_rows]),
    ("Data Model", [f"{row[0]}: fields={row[1]}; relations={row[2]}; control={row[3]}" for row in data_rows]),
])

save_doc(QA_DOC, "QA Test Matrix MVP SaaS Runtime v0.6", [
    ("Coverage", [f"MVP-scope требований в матрице: {len(qa_rows)}"]),
    ("Critical Evidence", [f"{row[0]}: {row[1]} — {row[4]}" for row in evidence_rows]),
    ("Acceptance", ["G2 готов к закрытию после утверждения Дмитрием и назначения владельцев по открытым задачам G2-ARCH-001..006."]),
])

g2_note = OBS_SAAS / "03_G2_UX_ARCHITECTURE_FREEZE_SAAS.md"
text = g2_note.read_text(encoding="utf-8") if g2_note.exists() else "# G2_UX_ARCHITECTURE_FREEZE_SAAS\n"
if "## Пакет v0.6 готов к согласованию" not in text:
    text += f"""

## Пакет v0.6 готов к согласованию

Дата: 2026-07-01

Созданы артефакты:

- КСГ v0.6: `{V06}`
- G2 пакет: `{G2_DOC}`
- API/Data contracts: `{API_DOC}`
- QA matrix: `{QA_DOC}`

Новые листы Excel:

- `19_G2_Screen_Map`
- `20_G2_User_Journeys`
- `21_G2_API_Contracts`
- `22_G2_Data_Model`
- `23_G2_ASVS_NIST_Evidence`
- `24_G2_QA_Test_Matrix`
- `25_G2_Architecture_Backlog`

Статус: `готов к согласованию`, не закрыт до утверждения Дмитрием.
"""
g2_note.write_text(text, encoding="utf-8")

log = LOG_DIR / "00_ПРОТОКОЛ_ДНЯ.md"
entry = f"""

## ЗАДАЧА-005. Подготовка G2 UX + Architecture Freeze v0.6

Дата: 2026-07-01

### Что сделано

- Создан G2-пакет: карта экранов, user journeys, API contracts, data model, ASVS/NIST evidence, QA matrix.
- Excel обновлен до v0.6.
- G2 переведен в статус `готов к согласованию`, но не закрыт без утверждения Дмитрия.

### Артефакты

- `{V06}`
- `{G2_DOC}`
- `{API_DOC}`
- `{QA_DOC}`
- `{g2_note}`

### Вывод архитектора

G2 подготовлен к приемке. Следующее действие: Дмитрий утверждает или корректирует screen map, user journeys и API/Data contracts.
"""
lt = log.read_text(encoding="utf-8") if log.exists() else ""
if "ЗАДАЧА-005. Подготовка G2 UX + Architecture Freeze v0.6" not in lt:
    log.write_text(lt.rstrip() + entry, encoding="utf-8")
(LOG_DIR / "ЗАДАЧА-005_G2_UX_Architecture_Freeze_v0.6.md").write_text(entry, encoding="utf-8")

manifest_path = ROOT / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
manifest.update({
    "xlsx_v0_6": str(V06),
    "g2_status": "ready_for_user_approval_v0_6",
    "g2_doc_v0_6": str(G2_DOC),
    "api_data_contracts_v0_6": str(API_DOC),
    "qa_matrix_v0_6": str(QA_DOC),
    "g2_screen_count": len(screen_rows),
    "g2_journey_count": len(journey_rows),
    "g2_api_contract_count": len(api_rows),
    "g2_data_entity_count": len(data_rows),
    "g2_mvp_test_count": len(qa_rows),
})
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

print(json.dumps({
    "xlsx": str(V06),
    "screens": len(screen_rows),
    "journeys": len(journey_rows),
    "api_contracts": len(api_rows),
    "data_entities": len(data_rows),
    "qa_tests": len(qa_rows),
    "status": "ready_for_approval",
}, ensure_ascii=False, indent=2))

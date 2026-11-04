from pathlib import Path
from datetime import date, datetime
from copy import copy
import json

from docx import Document
from docx.shared import Pt
from openpyxl import load_workbook, Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


ROOT = Path(r"<локальный путь>")
SRC_REQUESTED = Path(r"<локальный путь>")
FALLBACK_EXTRACT = ROOT / "00_ТЗ_И_АНАЛИЗ" / "ТЗ_на_разработку_SAAS_извлечение.txt"
OLD_XLSX = ROOT / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ" / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА_v0.2.xlsx"
NEW_XLSX = ROOT / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ" / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА_v0.3.xlsx"
REPORT_DOCX = ROOT / "00_ТЗ_И_АНАЛИЗ" / "02_Standards_Compliance_и_ADR_стека_v0.3.docx"
ADR_DOCX = ROOT / "02_АРХИТЕКТУРА" / "ADR-001_Выбор_технологического_стека_SaaS_Runtime_v0.3.docx"
ROLE_REPORT_DOCX = ROOT / "00_ТЗ_И_АНАЛИЗ" / "03_Обучение_ролей_стандартам_SaaS_v0.3.docx"
HTML_PATH = ROOT / "05_МОНИТОРИНГ" / "index_v0.3.html"
ROOT.joinpath("02_АРХИТЕКТУРА").mkdir(parents=True, exist_ok=True)

OBS_ROOT = Path(r"D:\СИСТЕМА\01.Базы данных\01_База № 3 (MAC)\15.03_База № 3 (MAC)")
OBS_SAAS = OBS_ROOT / r"01_Симбиот_что_и_зачем\00_Смысл_и_стратегия\03_Симбиот_как_система_масштабирования\05_SAAS_РАЗРАБОТКА"
OBS_ROLES = OBS_ROOT / r"01_Симбиот_что_и_зачем\03_Уровень_3_Компания_проектов"
LOG_DIR = OBS_ROOT / r"02_Личная_операционная_система_ритм\01_ПРОТОКОЛЫ_ДНЯ_И_ЛОГИ\2026-07\ОД-011_2026-07-01_SAAS_разработка_Симбиота"


standards = [
    ("ISO/IEC/IEEE 29148:2018", "Requirements Engineering", "Requirements Engineer / Product Analyst", "https://www.iso.org/standard/72089.html"),
    ("ISO/IEC/IEEE 12207:2026", "Software Life Cycle Processes", "CTO + PMO + QA Lead", "https://standards.ieee.org/ieee/12207/11416/"),
    ("NIST AI RMF 1.0", "AI Risk Management", "AI Governance Lead + Контролер рисков", "https://www.nist.gov/itl/ai-risk-management-framework"),
    ("OWASP ASVS 5.0.0", "Application Security Verification", "Security Architect / AppSec", "https://owasp.org/www-project-application-security-verification-standard/"),
    ("ADR practice", "Technology stack decision record", "CTO Council", "internal ADR"),
]

compliance_rows = [
    ("ISO29148-01", "ISO/IEC/IEEE 29148:2018", "Stakeholder needs source", "Every requirement has a source, stakeholder, rationale, and priority.", "FR/NFR/AC all", "Product Analyst", "RTM row with source and stakeholder", "G1 Scope Freeze", "Open"),
    ("ISO29148-02", "ISO/IEC/IEEE 29148:2018", "Good requirement quality", "Requirement is necessary, implementation-free, unambiguous, complete, singular, feasible, verifiable.", "FR/NFR all Must", "Requirements Engineer", "Requirements quality checklist", "G1 Scope Freeze", "Open"),
    ("ISO29148-03", "ISO/IEC/IEEE 29148:2018", "Traceability", "Requirement traces to task, acceptance, test, evidence, release gate.", "RTM all", "Product Analyst + QA", "RTM in workbook", "G1/G4", "Partially ready"),
    ("ISO29148-04", "ISO/IEC/IEEE 29148:2018", "Definition of Ready", "No implementation without DoR and acceptance criterion.", "All development tasks", "PMO", "DoR field in KSG", "G1", "Open"),
    ("ISO29148-05", "ISO/IEC/IEEE 29148:2018", "Validation with user/business", "MVP scenarios validate user goals, not only code completion.", "AC-001..AC-010", "Product Manager", "User acceptance evidence", "G4", "Open"),
    ("ISO12207-01", "ISO/IEC/IEEE 12207:2026", "Life-cycle governance", "Lifecycle stages and decision gates are defined from concept to retirement.", "All project", "CTO + PMO", "Gate list G0-G6", "G0/G1", "Partially ready"),
    ("ISO12207-02", "ISO/IEC/IEEE 12207:2026", "Architecture definition", "Architecture decisions are recorded as ADR and traced to NFR.", "NFR/ADR", "CTO", "ADR-001 and architecture docs", "G2", "Open"),
    ("ISO12207-03", "ISO/IEC/IEEE 12207:2026", "Implementation and integration", "Implementation tasks include integration evidence and CI/CD path.", "FR/NFR", "Backend/Frontend/DevOps", "CI/CD evidence", "G3", "Open"),
    ("ISO12207-04", "ISO/IEC/IEEE 12207:2026", "Verification and validation", "Every Must has verification test and validation acceptance.", "Must + AC", "QA Lead", "Test matrix", "G4", "Open"),
    ("ISO12207-05", "ISO/IEC/IEEE 12207:2026", "Operation and maintenance", "Monitoring, backup, restore, incident and support are designed before external release.", "NFR-050..065", "DevOps/SRE", "Runbook + monitoring evidence", "G5/G6", "Open"),
    ("NIST-AI-01", "NIST AI RMF 1.0", "Govern", "AI accountability, policies, role owners, acceptable-use boundaries, approval rules.", "AI governance all", "AI Governance Lead", "AI governance policy", "G1/G2", "Open"),
    ("NIST-AI-02", "NIST AI RMF 1.0", "Map", "AI system context, user impact, data sources, model/provider risks are mapped.", "LLM/RAG/Gates", "AI Architect + Risk Controller", "AI risk map", "G2", "Open"),
    ("NIST-AI-03", "NIST AI RMF 1.0", "Measure", "Eval sets, quality metrics, hallucination/factuality checks, RAG relevance checks.", "RAG/LLM/Gates", "QA + AI Architect", "Eval report", "G3/G4", "Open"),
    ("NIST-AI-04", "NIST AI RMF 1.0", "Manage", "Residual risk, fallback, human approval, incident response, provider shutdown path.", "LLM Gateway/Gates", "Risk Controller", "Risk treatment register", "G5", "Open"),
    ("NIST-AI-05", "NIST AI RMF 1.0", "Trustworthiness evidence", "Validity, reliability, safety, security, resilience, accountability, transparency and privacy are evidenced.", "All AI functions", "AI Governance Lead", "Trust evidence package", "G6", "Open"),
    ("ASVS-01", "OWASP ASVS 5.0.0", "Authentication and session", "Auth, session management, password/secrets protections meet SaaS baseline.", "NFR-001..010", "AppSec", "ASVS checklist evidence", "G3/G4", "Open"),
    ("ASVS-02", "OWASP ASVS 5.0.0", "Access control and tenant isolation", "RBAC/ABAC and tenant isolation are tested.", "NFR-004..006, FR-005", "Security Architect", "Access-control tests", "G4", "Open"),
    ("ASVS-03", "OWASP ASVS 5.0.0", "Input validation and file upload", "Document uploads, parsing and AI prompts are controlled.", "FR-050..060, NFR-008", "AppSec + RAG Engineer", "File-upload security tests", "G3/G4", "Open"),
    ("ASVS-04", "OWASP ASVS 5.0.0", "API and secrets", "API keys, LLM provider credentials and API boundaries are protected.", "FR-090..098, NFR-003", "Security + DevOps", "Secrets scan + API tests", "G3/G4", "Open"),
    ("ASVS-05", "OWASP ASVS 5.0.0", "Logging and privacy", "Logs do not leak secrets or sensitive data; audit is immutable for normal users.", "FR-130..134, NFR-007/024", "Security + Audit", "Log redaction evidence", "G4/G5", "Open"),
    ("ADR-STACK-01", "ADR practice", "Frontend stack", "Choose frontend stack based on speed, maintainability, UI complexity, hiring, security.", "GUI all", "CTO Council", "ADR-001 section", "G2", "Open"),
    ("ADR-STACK-02", "ADR practice", "Backend stack", "Choose API/core stack based on async jobs, integrations, safety, speed.", "Core all", "CTO Council", "ADR-001 section", "G2", "Open"),
    ("ADR-STACK-03", "ADR practice", "Data/vector stack", "Choose DB, object storage, vector store and search stack.", "RAG/Knowledge", "CTO Council", "ADR-001 section", "G2", "Open"),
    ("ADR-STACK-04", "ADR practice", "LLM providers", "Provider abstraction, Russian/local/external mode, fallback, cost controls.", "LLM Gateway", "AI Architect", "ADR + provider matrix", "G2/G3", "Open"),
]

asvs_rows = [
    ("ASVS-V1", "Architecture, Design and Threat Modeling", "Threat model includes LLM, RAG, documents, tenants, admin, integrations.", "Security Architect", "Threat model document", "G2", "Open"),
    ("ASVS-V2", "Authentication", "User login, password/session controls, MFA path for admin.", "Backend + AppSec", "Auth tests", "G4", "Open"),
    ("ASVS-V3", "Session Management", "Session lifetime, cookies, logout, token handling.", "Backend + AppSec", "Session test evidence", "G4", "Open"),
    ("ASVS-V4", "Access Control", "RBAC/ABAC, process permissions, document permissions, tenant isolation.", "Security Architect", "Access matrix + tests", "G4", "Open"),
    ("ASVS-V5", "Validation, Sanitization and Encoding", "Input validation for forms, files, prompts, metadata.", "Frontend/Backend/AppSec", "Validation tests", "G3", "Open"),
    ("ASVS-V6", "Stored Cryptography", "Secrets, provider keys, encryption policy.", "DevOps/Security", "Secrets storage evidence", "G3", "Open"),
    ("ASVS-V7", "Error Handling and Logging", "No secrets in logs; audit events structured and immutable for normal users.", "Backend/Audit", "Log redaction test", "G4", "Open"),
    ("ASVS-V8", "Data Protection", "Tenant separation, backups, deletion, retention, Russian data mode.", "Security/DevOps", "Data protection checklist", "G5", "Open"),
    ("ASVS-V10", "Malicious Code", "Supply chain and dependency controls.", "DevOps/Security", "Dependency scan", "G5", "Open"),
    ("ASVS-V11", "Business Logic", "Quality Gates cannot be bypassed; paid/limited flows cannot be abused.", "QA/Product", "Business logic tests", "G4", "Open"),
    ("ASVS-V12", "File and Resources", "PDF/DOCX/XLSX/MD uploads handled safely, file type and size controlled.", "RAG/AppSec", "Upload tests", "G3", "Open"),
    ("ASVS-V13", "API and Web Service", "API auth, rate limits, schema validation, tenant scope.", "Backend/AppSec", "API tests", "G4", "Open"),
    ("ASVS-V14", "Configuration", "TLS, headers, CSP, environment configs.", "DevOps/Security", "Config scan", "G5", "Open"),
]

ai_rmf_rows = [
    ("GOV-1", "Govern", "AI policy and accountability", "Define owner for LLM Gateway, RAG, Quality Gates, evals.", "AI Governance Lead", "Policy + RACI", "Open"),
    ("GOV-2", "Govern", "Human oversight", "Define when human approval is mandatory.", "Product + Risk", "Approval matrix", "Open"),
    ("GOV-3", "Govern", "Provider governance", "External, Russian, local and disabled-provider modes.", "AI Architect", "Provider policy", "Open"),
    ("MAP-1", "Map", "AI context", "Map users, tasks, documents, risks and impact classes.", "AI Governance Lead", "AI system context", "Open"),
    ("MAP-2", "Map", "Data/RAG sources", "Map source trust, access, freshness, retention.", "RAG Engineer", "Knowledge source registry", "Open"),
    ("MAP-3", "Map", "Prompt injection and leakage", "Map prompt injection, system prompt leakage, data extraction risks.", "Security + AI", "Threat model", "Open"),
    ("MEASURE-1", "Measure", "Eval sets", "Create evaluation datasets for factuality, source coverage, format, gate behavior.", "QA + AI", "Eval report", "Open"),
    ("MEASURE-2", "Measure", "Quality metrics", "Measure acceptance rate, hallucination, RAG relevance, cost, latency.", "QA + DevOps", "Metrics dashboard", "Open"),
    ("MEASURE-3", "Measure", "Security tests", "LLM-specific tests for prompt injection and sensitive info disclosure.", "AppSec + QA", "AI security test report", "Open"),
    ("MANAGE-1", "Manage", "Risk treatment", "Assign mitigation, residual risk, stop conditions.", "Risk Controller", "Risk register", "Open"),
    ("MANAGE-2", "Manage", "Fallback and incident response", "Fallback model, retry, disable external LLM, incident handling.", "AI Architect + SRE", "Runbook", "Open"),
    ("MANAGE-3", "Manage", "Monitoring after release", "Monitor quality, cost, errors, provider drift.", "DevOps + AI Governance", "Monitoring evidence", "Open"),
]

adr_rows = [
    ("ADR-001-A", "Frontend", "Next.js/React + TypeScript", "Vue/Nuxt, plain React/Vite", "Recommended", "Fast SaaS UI, strong ecosystem, good admin/dashboard support.", "Need disciplined design system and SSR security review.", "UX/UI + Frontend Lead"),
    ("ADR-001-B", "Backend API", "Python FastAPI", "Node/NestJS, Go", "Recommended for MVP", "Fast AI/RAG integration, Python ecosystem for documents and LLM tooling.", "Async/job architecture must be strict; performance needs queue workers.", "Backend Lead + AI Architect"),
    ("ADR-001-C", "Core jobs", "Celery/RQ or Dramatiq + Redis", "Temporal, BullMQ", "Recommended MVP: RQ/Dramatiq; Enterprise: Temporal", "Quick worker model for long AI tasks.", "Temporal may be better later for durable workflows.", "CTO + DevOps"),
    ("ADR-001-D", "Database", "PostgreSQL", "MySQL, managed DB", "Recommended", "Reliable relational model, JSONB, audit, multi-tenant patterns.", "Needs migration discipline.", "Backend Lead"),
    ("ADR-001-E", "Vector store", "pgvector for MVP", "Qdrant, Weaviate, Milvus", "Recommended MVP: pgvector; scale option: Qdrant", "Simpler operations and fewer moving parts.", "May need Qdrant for scale/rerank performance.", "RAG Engineer"),
    ("ADR-001-F", "Object storage", "S3-compatible storage / MinIO", "Local FS", "Recommended", "Portable SaaS/private cloud storage.", "Needs secure signed URL and retention policy.", "DevOps + Security"),
    ("ADR-001-G", "LLM Gateway", "Provider abstraction with OpenAI-compatible, GigaChat/YandexGPT, local vLLM-ready", "Single provider", "Required", "Prevents provider lock-in and supports Russian/local modes.", "Higher testing burden.", "AI Architect"),
    ("ADR-001-H", "Auth/RBAC", "OIDC-ready auth + app RBAC/ABAC", "Custom auth only", "Recommended", "Supports enterprise path and tenant isolation.", "Need ASVS-focused implementation.", "Security Architect"),
    ("ADR-001-I", "Deployment", "Docker Compose for MVP, Kubernetes later", "Bare VM only", "Recommended", "Fast start, reproducible, can evolve to k8s.", "Operational discipline needed.", "DevOps/SRE"),
    ("ADR-001-J", "Observability", "Structured logs + OpenTelemetry-ready + error monitoring", "Logs only", "Recommended", "Required for audit, AI cost, incident response.", "Must avoid secret leakage.", "DevOps + Security"),
]

role_training = [
    ("[[РОЛЬ_AI_Системный_аналитик_ТЗ]]", "Requirements Engineer / Product Analyst", "ISO/IEC/IEEE 29148", "Требования, RTM, DoR, acceptance, stakeholder/source/verification.", "Must"),
    ("[[РОЛЬ_AI_IT_директор_цифрового_каркаса]]", "CTO", "ISO/IEC/IEEE 12207 + ADR", "Жизненный цикл, архитектура, стек, релизные gates, техдолг.", "Must"),
    ("[[РОЛЬ_AI_QA_тестировщик]]", "QA Lead", "ISO/IEC/IEEE 12207 + ASVS evidence", "Verification/validation, тест-план, evidence, gate-acceptance.", "Must"),
    ("[[РОЛЬ_AI_Контролер_рисков]]", "AI Governance/Risk", "NIST AI RMF", "Govern/Map/Measure/Manage, AI-риск-классы, residual risk.", "Must"),
    ("[[РОЛЬ_AI_Контролер_качества_и_приемки]]", "Quality Controller", "29148/12207/NIST/ASVS", "Не принимает задачу без evidence, RTM, checklist и владельца.", "Must"),
    ("[[РОЛЬ_AI_Технологический_архитектор]]", "Architecture Lead", "12207 + ADR + ASVS", "Architecture definition, stack decision, protected IP, Runtime/Studio split.", "Must"),
    ("[[РОЛЬ_AI_DevOps_runtime_инженер]]", "DevOps/SRE", "12207 + ASVS", "CI/CD, secrets, backups, monitoring, runbooks, recovery.", "Must"),
    ("[[РОЛЬ_AI_Архитектор_данных]]", "Data/RAG Architect", "NIST AI RMF + ASVS", "Data lineage, vector store, source trust, access rights, privacy.", "Must"),
    ("[[РОЛЬ_AI_Ведущий_разработчик]]", "Backend/Frontend Lead", "12207 + ASVS", "Implementation, integration, code review, secure coding, API evidence.", "Must"),
    ("[[РОЛЬ_AI_Технический_писатель]]", "Documentation Lead", "12207 information management", "Runbooks, API docs, client guides, release evidence.", "Should"),
    ("[[РОЛЬ_AI_Симбиот_архитектор_системы]]", "Chief Architect", "All standards", "Final gate verdict: start / stop / start with conditions.", "Must"),
    ("[[РОЛЬ_AI_Учитель_Симбиота]]", "Training owner", "All standards", "Обучает роли и обновляет уроки/правила при нарушениях.", "Must"),
]


def style_header(row):
    for cell in row:
        cell.fill = PatternFill("solid", fgColor="1F4E78")
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(
            left=Side(style="thin", color="D9D9D9"),
            right=Side(style="thin", color="D9D9D9"),
            top=Side(style="thin", color="D9D9D9"),
            bottom=Side(style="thin", color="D9D9D9"),
        )


def autosize(ws, max_width=58):
    thin = Side(style="thin", color="D9D9D9")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for column in ws.columns:
        letter = get_column_letter(column[0].column)
        max_len = 0
        for cell in column:
            if cell.value is not None:
                max_len = max(max_len, min(max_width, len(str(cell.value))))
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = border
        ws.column_dimensions[letter].width = max(10, min(max_width, max_len + 2))


def copy_sheet_values(source_ws, target_ws):
    for row in source_ws.iter_rows():
        target_ws.append([cell.value for cell in row])
    for row in target_ws.iter_rows():
        for cell in row:
            if cell.row == 1:
                style_header(row)
                break
    target_ws.freeze_panes = "A2"
    target_ws.auto_filter.ref = target_ws.dimensions
    autosize(target_ws)


def append_rows(ws, headers, rows):
    ws.append(headers)
    style_header(ws[1])
    for row in rows:
        ws.append(list(row))
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    autosize(ws)


old = load_workbook(OLD_XLSX, data_only=True)
new = Workbook()
new.remove(new.active)
for name in old.sheetnames:
    ws = new.create_sheet(name)
    copy_sheet_values(old[name], ws)

append_rows(
    new.create_sheet("10_Standards_Compliance"),
    ["ID", "Стандарт", "Контроль/процесс", "Что проверяем", "Связанные требования", "Ответственный", "Evidence", "Gate", "Статус"],
    compliance_rows,
)
append_rows(
    new.create_sheet("11_ASVS_Checklist"),
    ["ASVS блок", "Область", "Контроль в проекте", "Ответственный", "Evidence", "Gate", "Статус"],
    asvs_rows,
)
append_rows(
    new.create_sheet("12_AI_RMF_Risk_Register"),
    ["ID", "Функция", "Риск/контроль", "Что должно быть сделано", "Ответственный", "Evidence", "Статус"],
    ai_rmf_rows,
)
append_rows(
    new.create_sheet("13_ADR_Tech_Stack"),
    ["ID", "Решение", "Рекомендуемый стек", "Альтернатива", "Вердикт", "Почему", "Риски", "Владелец"],
    adr_rows,
)
append_rows(
    new.create_sheet("14_Role_Training"),
    ["Роль Симбиота", "Проектная функция", "Стандарт/рамка", "Что роль теперь обязана контролировать", "Обязательность"],
    role_training,
)

dash = new["00_Дашборд"]
next_row = dash.max_row + 2
dash.cell(next_row, 1, "v0.3 Compliance Gate")
dash.cell(next_row, 1).font = Font(bold=True, color="9C0006")
dash.cell(next_row, 2, "Добавлены 10_Standards_Compliance, 11_ASVS_Checklist, 12_AI_RMF_Risk_Register, 13_ADR_Tech_Stack, 14_Role_Training. Excel пересобран без структурированных Table-объектов для снижения риска ошибок открытия.")
dash.cell(next_row + 1, 1, "Источник ТЗ")
dash.cell(next_row + 1, 2, "Запрошенный TZ_AI_Runtime_Platform.docx не найден; использовано сохраненное извлечение ТЗ из папки продукта.")
autosize(dash)
new.save(NEW_XLSX)


def make_report():
    doc = Document()
    doc.styles["Normal"].font.name = "Arial"
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_heading("СИМБИОТ SaaS: Compliance Gate v0.3", 0)
    doc.add_paragraph(f"Дата: 2026-07-01")
    doc.add_paragraph(f"Запрошенный источник: {SRC_REQUESTED}")
    doc.add_paragraph(f"Статус источника: {'найден' if SRC_REQUESTED.exists() else 'не найден; использовано сохраненное извлечение ТЗ'}")
    doc.add_paragraph(f"Fallback: {FALLBACK_EXTRACT}")
    doc.add_heading("1. Стандарты и владельцы", 1)
    for std, meaning, owner, url in standards:
        p = doc.add_paragraph()
        p.add_run(std + ": ").bold = True
        p.add_run(f"{meaning}; владелец: {owner}; источник: {url}")
    doc.add_heading("2. Решение по готовности к старту", 1)
    doc.add_paragraph("Старт разработки рекомендован только с условиями: G1 Scope Freeze, назначение владельцев стандартов, заполнение evidence по Must-требованиям, утверждение ADR-001 по стеку.")
    doc.add_heading("3. Что добавлено в КСГ v0.3", 1)
    for item in ["10_Standards_Compliance", "11_ASVS_Checklist", "12_AI_RMF_Risk_Register", "13_ADR_Tech_Stack", "14_Role_Training"]:
        doc.add_paragraph(item)
    doc.add_heading("4. Главные блокеры до отмашки", 1)
    for item in [
        "Новый DOCX TZ_AI_Runtime_Platform.docx отсутствует по указанному пути.",
        "Нужно подтвердить baseline: 12207:2026 или 12207:2017.",
        "Нужно подтвердить ASVS Level 2 baseline + Level 3 для tenant/admin/secrets.",
        "Нужно подтвердить стек ADR-001 или отправить на альтернативный расчет.",
        "Нужно назначить реальных владельцев ролей, если разработку ведут внешние исполнители.",
    ]:
        doc.add_paragraph(item)
    doc.add_heading("5. Вывод архитектора", 1)
    doc.add_paragraph("Пакет v0.3 доведен до состояния управляемого старта, но не до состояния безусловной отмашки. Без G1 и ADR-001 разработка может начаться только как подготовительный спринт, а не как полный production sprint.")
    doc.save(REPORT_DOCX)


def make_adr():
    doc = Document()
    doc.styles["Normal"].font.name = "Arial"
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_heading("ADR-001. Выбор технологического стека SaaS Runtime Platform", 0)
    doc.add_paragraph("Статус: предложено к утверждению на G2 Architecture Freeze.")
    doc.add_heading("Контекст", 1)
    doc.add_paragraph("Система строится как SaaS Runtime, где Obsidian/Studio остается внутренним ядром владельца, а клиент получает GUI, каталог процессов, свои документы, настройки, результаты и аудит. Требуются LLM Gateway, RAG, Quality Gates, Audit Layer, Admin Panel, tenant isolation и защищенное хранение секретов.")
    doc.add_heading("Решения", 1)
    for row in adr_rows:
        p = doc.add_paragraph()
        p.add_run(f"{row[0]} / {row[1]}: ").bold = True
        p.add_run(f"{row[2]}. Вердикт: {row[4]}. Причина: {row[5]} Риски: {row[6]}")
    doc.add_heading("Условия утверждения", 1)
    for item in [
        "Провести security review стека по OWASP ASVS.",
        "Подтвердить российский/локальный режим LLM и хранения данных.",
        "Определить первый реальный LLM provider и mock provider для тестов.",
        "Принять pgvector как MVP-решение или заменить на Qdrant до начала RAG-разработки.",
        "Зафиксировать deployment baseline: Docker Compose MVP, Kubernetes после beta.",
    ]:
        doc.add_paragraph(item)
    doc.save(ADR_DOCX)


def make_role_report():
    doc = Document()
    doc.styles["Normal"].font.name = "Arial"
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_heading("Обучение ролей стандартам SaaS v0.3", 0)
    doc.add_paragraph("Назначение: закрепить, какая роль Симбиота отвечает за стандарт, evidence и gate-приемку.")
    for row in role_training:
        p = doc.add_paragraph()
        p.add_run(row[0] + " / " + row[1] + ": ").bold = True
        p.add_run(f"{row[2]} — {row[3]} Обязательность: {row[4]}.")
    doc.save(ROLE_REPORT_DOCX)


make_report()
make_adr()
make_role_report()

skill_ref = r"<локальный путь>"
obs_note = OBS_SAAS / "01_COMPLIANCE_GATE_SAAS_v0.3.md"
obs_note.write_text(f"""# COMPLIANCE_GATE_SAAS_v0.3

Дата: 2026-07-01
Статус: подготовлено к согласованию G0.1 / G1

## Связи

- Родительская карта: [[00_КАРТА_SAAS_РАЗРАБОТКИ_СИМБИОТА]]
- Навык Codex: `saas-compliance-gate`
- [[РОЛЬ_AI_Системный_аналитик_ТЗ]]
- [[РОЛЬ_AI_IT_директор_цифрового_каркаса]]
- [[РОЛЬ_AI_QA_тестировщик]]
- [[РОЛЬ_AI_Контролер_рисков]]
- [[РОЛЬ_AI_Контролер_качества_и_приемки]]
- [[РОЛЬ_AI_Технологический_архитектор]]
- [[РОЛЬ_AI_DevOps_runtime_инженер]]
- [[РОЛЬ_AI_Архитектор_данных]]
- [[РОЛЬ_AI_Учитель_Симбиота]]

## Источник

Запрошенный файл <локальный путь> не найден.  
Использовано сохраненное извлечение ТЗ: `{FALLBACK_EXTRACT}`.

## Файлы v0.3

- Excel КСГ v0.3: `{NEW_XLSX}`
- Compliance отчет: `{REPORT_DOCX}`
- ADR по стеку: `{ADR_DOCX}`
- Обучение ролей: `{ROLE_REPORT_DOCX}`
- Skill: `{skill_ref}`

## Baseline

- ISO/IEC/IEEE 29148:2018 — требования и трассировка.
- ISO/IEC/IEEE 12207:2026 — жизненный цикл ПО; требуется подтверждение Дмитрия, если использовать 2017 как более распространенный baseline.
- NIST AI RMF 1.0 — Govern / Map / Measure / Manage.
- OWASP ASVS 5.0.0 — baseline Level 2 + критические элементы Level 3 для tenant/admin/secrets.

## Gate status

Статус: `старт с условиями`, не безусловная отмашка.

Условия:

- подтвердить источник ТЗ или положить новый DOCX в доступный путь;
- согласовать baseline 12207;
- согласовать ASVS level;
- принять или скорректировать ADR-001;
- назначить владельцев evidence по каждому стандарту.
""", encoding="utf-8")

role_section = f"""

## Обучение SaaS Compliance v0.3

Дата: 2026-07-01

Роль обучена применять [[COMPLIANCE_GATE_SAAS_v0.3]] и навык `saas-compliance-gate` при задачах SaaS Runtime Platform.

Обязательные проверки:

- требования и трассировка по ISO/IEC/IEEE 29148;
- жизненный цикл и gate-приемка по ISO/IEC/IEEE 12207;
- AI-риски по NIST AI RMF;
- web security evidence по OWASP ASVS;
- архитектурные решения через ADR.

Связанные артефакты:

- `{NEW_XLSX}`
- `{REPORT_DOCX}`
- `{ADR_DOCX}`
- `{ROLE_REPORT_DOCX}`
"""

role_files = [
    OBS_ROLES / r"07_IT_БЛОК\РОЛЬ_AI_Системный_аналитик_ТЗ.md",
    OBS_ROLES / r"07_IT_БЛОК\РОЛЬ_AI_IT_директор_цифрового_каркаса.md",
    OBS_ROLES / r"07_IT_БЛОК\РОЛЬ_AI_QA_тестировщик.md",
    OBS_ROLES / r"01_СИМБИОТ_И_ПОМОЩНИКИ\РОЛЬ_AI_Контролер_рисков.md",
    OBS_ROLES / r"01_СИМБИОТ_И_ПОМОЩНИКИ\РОЛЬ_AI_Контролер_качества_и_приемки.md",
    OBS_ROLES / r"07_IT_БЛОК\РОЛЬ_AI_Технологический_архитектор.md",
    OBS_ROLES / r"07_IT_БЛОК\РОЛЬ_AI_DevOps_runtime_инженер.md",
    OBS_ROLES / r"07_IT_БЛОК\РОЛЬ_AI_Архитектор_данных.md",
    OBS_ROLES / r"01_СИМБИОТ_И_ПОМОЩНИКИ\РОЛЬ_AI_Симбиот_архитектор_системы.md",
    OBS_ROLES / r"01_СИМБИОТ_И_ПОМОЩНИКИ\РОЛЬ_AI_Учитель_Симбиота.md",
]
updated_roles = []
for path in role_files:
    if path.exists():
        text = path.read_text(encoding="utf-8")
        if "## Обучение SaaS Compliance v0.3" not in text:
            path.write_text(text.rstrip() + "\n" + role_section + "\n", encoding="utf-8")
        updated_roles.append(str(path))

protocol = LOG_DIR / "00_ПРОТОКОЛ_ДНЯ.md"
entry = f"""

## ЗАДАЧА-002. Compliance Gate SaaS v0.3 и обучение ролей

Дата: 2026-07-01

### Что сделано

- Создан навык Codex `saas-compliance-gate` и проверен валидатором skill-creator.
- Пересобран Excel КСГ v0.3 без структурированных Table-объектов.
- Добавлены листы compliance: Standards, ASVS, AI RMF, ADR Tech Stack, Role Training.
- Созданы Word-отчеты: compliance, ADR-001, обучение ролей.
- Обновлены Obsidian-карта SaaS и релевантные роли.

### Ограничение источника

Файл <локальный путь> не найден. Использовано сохраненное извлечение ТЗ из папки продукта.

### Вывод архитектора

Пакет готов к G0.1/G1 с условиями. До полной отмашки нужно подтвердить источник ТЗ, baseline 12207, ASVS level и ADR-001.
"""
existing = protocol.read_text(encoding="utf-8") if protocol.exists() else ""
if "ЗАДАЧА-002. Compliance Gate SaaS v0.3" not in existing:
    protocol.write_text(existing.rstrip() + "\n" + entry, encoding="utf-8")
(LOG_DIR / "ЗАДАЧА-002_Compliance_Gate_SaaS_v0.3.md").write_text(entry, encoding="utf-8")

manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8")) if (ROOT / "manifest.json").exists() else {}
manifest.update({
    "xlsx_v0_3": str(NEW_XLSX),
    "compliance_report_v0_3": str(REPORT_DOCX),
    "adr_stack_v0_3": str(ADR_DOCX),
    "role_training_v0_3": str(ROLE_REPORT_DOCX),
    "obsidian_compliance_note": str(obs_note),
    "skill_saas_compliance_gate": skill_ref,
    "source_requested": str(SRC_REQUESTED),
    "source_found": SRC_REQUESTED.exists(),
    "source_used": str(SRC_REQUESTED if SRC_REQUESTED.exists() else FALLBACK_EXTRACT),
    "roles_updated_count": len(updated_roles),
    "updated_roles": updated_roles,
})
(ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(manifest, ensure_ascii=False, indent=2))

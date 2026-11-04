from __future__ import annotations

import json
from pathlib import Path

from app.schemas import OcrJobRecord
from app.services.sqlite_store import OCR_DISPATCH_DIR, insert_ocr_job, next_ocr_job_id


OCR_PIPELINE_PATH = Path(
    r"D:\03_ПРОЕКТЫ_И_КОНТУРЫ_ДОХОДА\01_REA Центр\00_ОПЕРАЦИОННЫЙ_ШТАБ\04_ИНСТРУМЕНТЫ_ОБСЛУЖИВАНИЯ\01_OCR_КОНВЕЙЕР"
)
OCR_DISPATCHER = "ocr-ukr-dispatcher-mvp-v0.1"


def dispatch_ocr_job(file_id: str, source_file: Path, created_at: str, required: bool) -> OcrJobRecord | None:
    if not required:
        return None

    OCR_DISPATCH_DIR.mkdir(parents=True, exist_ok=True)
    job_id = next_ocr_job_id()
    dispatch_path = OCR_DISPATCH_DIR / f"{job_id}_{source_file.name}.json"
    command_hint = (
        f'powershell -NoProfile -ExecutionPolicy Bypass -File "{OCR_PIPELINE_PATH}\\Запуск_OCR_конвейера.ps1" '
        f'-InputPath "{source_file}"'
    )
    dispatch_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "file_id": file_id,
                "source_file": str(source_file),
                "ocr_pipeline_path": str(OCR_PIPELINE_PATH),
                "command_hint": command_hint,
                "status": "queued",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    values = {
        "id": job_id,
        "file_id": file_id,
        "status": "queued",
        "engine": "ocr_pipeline_auto",
        "dispatch_path": str(dispatch_path),
        "command_hint": command_hint,
        "created_at": created_at,
    }
    insert_ocr_job(values)
    return OcrJobRecord(**values)

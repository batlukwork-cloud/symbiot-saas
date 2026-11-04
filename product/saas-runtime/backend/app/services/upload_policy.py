from app.schemas import FilePolicyCheckRequest, FilePolicyEvidence, GateResult


ALLOWED_TYPES = {"txt", "md", "pdf", "png", "jpg", "jpeg", "docx", "xlsx"}
OCR_TYPES = {"pdf", "png", "jpg", "jpeg"}
MAX_SIZE_BYTES = 25 * 1024 * 1024


def check_upload_policy(payload: FilePolicyCheckRequest) -> FilePolicyEvidence:
    file_type = payload.type.lower().strip(".")
    allowed_type = file_type in ALLOWED_TYPES
    size_ok = 0 < payload.size_bytes <= MAX_SIZE_BYTES
    tenant_ok = payload.access_scope.startswith("tenant:")
    ocr_required = file_type in OCR_TYPES
    scan_required = True
    allowed = allowed_type and size_ok and tenant_ok

    checks = [
        GateResult(
            id="upload-type-allowlist",
            title="Allowed File Type",
            status="passed" if allowed_type else "failed",
            reason=f"Type `{file_type}` is {'allowed' if allowed_type else 'not allowed'} by MVP policy.",
        ),
        GateResult(
            id="upload-size-limit",
            title="File Size Limit",
            status="passed" if size_ok else "failed",
            reason=f"Size {payload.size_bytes} bytes checked against {MAX_SIZE_BYTES} bytes limit.",
        ),
        GateResult(
            id="upload-tenant-scope",
            title="Tenant Scope Declared",
            status="passed" if tenant_ok else "failed",
            reason=f"Access scope `{payload.access_scope}` must start with `tenant:`.",
        ),
        GateResult(
            id="upload-ocr-policy",
            title="OCR Extraction Policy",
            status="warning" if ocr_required else "passed",
            reason="PDF/image file requires OCR extraction before RAG indexing." if ocr_required else "Text-office file can use direct extraction path.",
            action="Route to OCR/UKR pipeline before production indexing." if ocr_required else None,
        ),
        GateResult(
            id="upload-scan-policy",
            title="Malware/Content Scan Policy",
            status="passed",
            reason="Scan requirement is explicit; actual binary upload calls the scanner adapter before runtime acceptance.",
        ),
    ]

    failed = any(check.status == "failed" for check in checks)
    warning = any(check.status == "warning" for check in checks)
    status = "failed" if failed else "warning" if warning else "passed"
    return FilePolicyEvidence(
        status=status,
        allowed=allowed,
        ocr_required=ocr_required,
        scan_required=scan_required,
        max_size_bytes=MAX_SIZE_BYTES,
        checks=checks,
        asvs_controls=["OWASP ASVS V5 input validation", "OWASP ASVS V12 file upload", "OWASP ASVS V4 access control"],
        nist_controls=["NIST AI RMF Map", "NIST AI RMF Measure", "NIST AI RMF Manage"],
    )

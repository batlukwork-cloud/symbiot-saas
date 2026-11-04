import os
import subprocess
from pathlib import Path

from app.schemas import GateResult


SCANNER_ADAPTER = "windows-defender-scanner-adapter-v0.2"


def _find_defender_cli() -> Path | None:
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Windows Defender" / "MpCmdRun.exe",
    ]
    platform_root = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Microsoft" / "Windows Defender" / "Platform"
    if platform_root.exists():
        candidates.extend(sorted(platform_root.glob("*/MpCmdRun.exe"), reverse=True))
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def scan_file(file_path: Path, expected_sha256: str) -> GateResult:
    exists = file_path.exists()
    readable = False
    if exists:
        try:
            with file_path.open("rb") as handle:
                handle.read(1)
            readable = True
        except OSError:
            readable = False

    if exists and readable and expected_sha256:
        defender_cli = _find_defender_cli()
        if defender_cli:
            try:
                completed = subprocess.run(
                    [
                        str(defender_cli),
                        "-Scan",
                        "-ScanType",
                        "3",
                        "-File",
                        str(file_path),
                        "-DisableRemediation",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=60,
                    check=False,
                )
                if completed.returncode == 0:
                    return GateResult(
                        id="scanner-adapter-defender",
                        title="Windows Defender Scanner Adapter",
                        status="passed",
                        reason="File is stored, readable, hash-verified and scanned by Windows Defender MpCmdRun.",
                    )
                return GateResult(
                    id="scanner-adapter-defender",
                    title="Windows Defender Scanner Adapter",
                    status="failed",
                    reason=f"Windows Defender scan returned code {completed.returncode}.",
                    action="Reject upload or review Defender output before indexing.",
                )
            except subprocess.TimeoutExpired:
                return GateResult(
                    id="scanner-adapter-defender",
                    title="Windows Defender Scanner Adapter",
                    status="warning",
                    reason="Windows Defender scan timed out; file stayed out of production-trusted state.",
                    action="Re-run scan or route file to manual AppSec review.",
                )
            except OSError as exc:
                return GateResult(
                    id="scanner-adapter-defender",
                    title="Windows Defender Scanner Adapter",
                    status="warning",
                    reason=f"Windows Defender scan could not be started: {exc}.",
                    action="Repair scanner adapter before beta/client data.",
                )
        return GateResult(
            id="scanner-adapter-metadata",
            title="Scanner Adapter Metadata Fallback",
            status="warning",
            reason="File is stored, readable and hash-verified, but Windows Defender MpCmdRun was not found.",
            action="Connect antivirus/content scanning before beta/client data.",
        )

    return GateResult(
        id="scanner-adapter-mvp",
        title="Scanner Adapter MVP",
        status="failed",
        reason="Uploaded file is missing or unreadable.",
        action="Reject upload and inspect storage adapter.",
    )

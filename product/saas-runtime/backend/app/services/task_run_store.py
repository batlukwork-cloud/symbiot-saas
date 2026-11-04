from __future__ import annotations

import json
import hashlib
from difflib import SequenceMatcher
from datetime import UTC, datetime
from uuid import uuid4

from app.schemas import Artifact, ArtifactCompareActionRecord, ArtifactContentDiffLine, ArtifactDiffJobRecord, ArtifactEvidencePackage, ArtifactExportDraft, ArtifactRollbackResult, ArtifactVersionCompareResult, ArtifactVersionDiff, ArtifactVersionRecord, AuditEvent, GateResult, ResultActionRecord, TaskRun
from app.services.mock_store import ARTIFACTS, AUDIT_EVENTS, TASK_RUNS
from app.services.sqlite_store import DB_PATH, get_connection, init_store


def init_task_run_store() -> None:
    init_store()
    with get_connection() as connection:
        connection.execute(
            """
            create table if not exists task_runs (
                id text primary key,
                process_id text not null,
                profile_id text not null,
                status text not null,
                stages_json text not null,
                gates_json text not null,
                artifact_id text,
                form_data_json text,
                created_at text not null,
                updated_at text not null
            )
            """
        )
        task_run_columns = {
            row["name"]
            for row in connection.execute("pragma table_info(task_runs)").fetchall()
        }
        if "form_data_json" not in task_run_columns:
            connection.execute("alter table task_runs add column form_data_json text")
        connection.execute(
            """
            create table if not exists artifacts (
                id text primary key,
                task_run_id text not null,
                version text not null,
                title text not null,
                content text not null,
                sources_json text not null,
                checks_json text not null,
                created_at text not null,
                updated_at text not null,
                foreign key(task_run_id) references task_runs(id)
            )
            """
        )
        connection.execute(
            """
            create table if not exists audit_events (
                id text primary key,
                actor text not null,
                action text not null,
                target text not null,
                redacted_payload_json text not null,
                created_at text not null,
                previous_hash text,
                event_hash text
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_result_actions (
                id text primary key,
                task_run_id text not null,
                action_id text not null,
                actor text not null,
                status text not null,
                comment text,
                related_task_run_id text,
                created_at text not null,
                foreign key(task_run_id) references task_runs(id)
            )
            """
        )
        connection.execute(
            """
            create table if not exists artifact_versions (
                id text primary key,
                artifact_id text not null,
                task_run_id text not null,
                version text not null,
                title text not null,
                content_hash text not null,
                content text,
                sources_json text,
                checks_json text,
                source text not null,
                created_at text not null,
                unique(artifact_id, version)
            )
            """
        )
        connection.execute(
            """
            create table if not exists artifact_diff_jobs (
                id text primary key,
                artifact_id text not null,
                version_id text not null,
                status text not null,
                requested_by text not null,
                max_diff_lines integer not null,
                compare_result_json text,
                error text,
                created_at text not null,
                completed_at text
            )
            """
        )
        connection.execute(
            """
            create table if not exists artifact_compare_actions (
                id text primary key,
                job_id text not null,
                artifact_id text not null,
                version_id text not null,
                action_id text not null,
                actor text not null,
                status text not null,
                comment text not null,
                created_at text not null,
                foreign key(job_id) references artifact_diff_jobs(id)
            )
            """
        )
        columns = {
            row["name"]
            for row in connection.execute("pragma table_info(task_run_result_actions)").fetchall()
        }
        if "related_task_run_id" not in columns:
            connection.execute("alter table task_run_result_actions add column related_task_run_id text")
        artifact_diff_job_columns = {
            row["name"]
            for row in connection.execute("pragma table_info(artifact_diff_jobs)").fetchall()
        }
        if "diff_offset" not in artifact_diff_job_columns:
            connection.execute("alter table artifact_diff_jobs add column diff_offset integer not null default 0")
        artifact_version_columns = {
            row["name"]
            for row in connection.execute("pragma table_info(artifact_versions)").fetchall()
        }
        for column_name, column_sql in {
            "content": "alter table artifact_versions add column content text",
            "sources_json": "alter table artifact_versions add column sources_json text",
            "checks_json": "alter table artifact_versions add column checks_json text",
        }.items():
            if column_name not in artifact_version_columns:
                connection.execute(column_sql)
        connection.execute(
            """
            update artifact_versions
            set
                content = (select content from artifacts where artifacts.id = artifact_versions.artifact_id),
                sources_json = (select sources_json from artifacts where artifacts.id = artifact_versions.artifact_id),
                checks_json = (select checks_json from artifacts where artifacts.id = artifact_versions.artifact_id)
            where content is null
              and exists (
                select 1 from artifacts
                where artifacts.id = artifact_versions.artifact_id
                  and artifacts.version = artifact_versions.version
              )
            """
        )
        _seed_runtime_records(connection)


def _seed_runtime_records(connection) -> None:
    now = "2026-07-01T00:00:00+00:00"
    for task_run in TASK_RUNS.values():
        connection.execute(
            """
            insert or ignore into task_runs(
                id, process_id, profile_id, status, stages_json, gates_json,
                artifact_id, form_data_json, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_run.id,
                task_run.process_id,
                task_run.profile_id,
                task_run.status,
                json.dumps([stage.model_dump() for stage in task_run.stages], ensure_ascii=False, sort_keys=True),
                json.dumps([gate.model_dump() for gate in task_run.gates], ensure_ascii=False, sort_keys=True),
                task_run.artifact_id,
                json.dumps(task_run.form_data, ensure_ascii=False, sort_keys=True),
                now,
                now,
            ),
        )
    for artifact in ARTIFACTS.values():
        connection.execute(
            """
            insert or ignore into artifacts(
                id, task_run_id, version, title, content, sources_json, checks_json,
                created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact.id,
                artifact.task_run_id,
                artifact.version,
                artifact.title,
                artifact.content,
                json.dumps(artifact.sources, ensure_ascii=False, sort_keys=True),
                json.dumps([check.model_dump() for check in artifact.checks], ensure_ascii=False, sort_keys=True),
                now,
                now,
            ),
        )
        _insert_artifact_version(connection, artifact, now, "seed")
    for event in AUDIT_EVENTS:
        connection.execute(
            """
            insert or ignore into audit_events(
                id, actor, action, target, redacted_payload_json, created_at
            )
            values (?, ?, ?, ?, ?, ?)
            """,
            (
                event.id,
                event.actor,
                event.action,
                event.target,
                json.dumps(event.redacted_payload, ensure_ascii=False, sort_keys=True),
                now,
            ),
        )


def save_task_run_bundle(task_run: TaskRun, artifact: Artifact, audit_event: AuditEvent) -> None:
    init_task_run_store()
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        connection.execute(
            """
            insert or replace into task_runs(
                id, process_id, profile_id, status, stages_json, gates_json,
                artifact_id, form_data_json, created_at, updated_at
            )
            values (
                ?, ?, ?, ?, ?, ?, ?, ?,
                coalesce((select created_at from task_runs where id = ?), ?),
                ?
            )
            """,
            (
                task_run.id,
                task_run.process_id,
                task_run.profile_id,
                task_run.status,
                json.dumps([stage.model_dump() for stage in task_run.stages], ensure_ascii=False, sort_keys=True),
                json.dumps([gate.model_dump() for gate in task_run.gates], ensure_ascii=False, sort_keys=True),
                task_run.artifact_id,
                json.dumps(task_run.form_data, ensure_ascii=False, sort_keys=True),
                task_run.id,
                now,
                now,
            ),
        )
        connection.execute(
            """
            insert or replace into artifacts(
                id, task_run_id, version, title, content, sources_json, checks_json,
                created_at, updated_at
            )
            values (
                ?, ?, ?, ?, ?, ?, ?,
                coalesce((select created_at from artifacts where id = ?), ?),
                ?
            )
            """,
            (
                artifact.id,
                artifact.task_run_id,
                artifact.version,
                artifact.title,
                artifact.content,
                json.dumps(artifact.sources, ensure_ascii=False, sort_keys=True),
                json.dumps([check.model_dump() for check in artifact.checks], ensure_ascii=False, sort_keys=True),
                artifact.id,
                now,
                now,
            ),
        )
        _insert_artifact_version(connection, artifact, now, "task_run_bundle")
        connection.execute(
            """
            insert or ignore into audit_events(
                id, actor, action, target, redacted_payload_json, created_at
            )
            values (?, ?, ?, ?, ?, ?)
            """,
            (
                audit_event.id,
                audit_event.actor,
                audit_event.action,
                audit_event.target,
                json.dumps(audit_event.redacted_payload, ensure_ascii=False, sort_keys=True),
                now,
            ),
        )


def _artifact_content_hash(artifact: Artifact) -> str:
    payload = {
        "artifact_id": artifact.id,
        "version": artifact.version,
        "title": artifact.title,
        "content": artifact.content,
        "sources": artifact.sources,
        "checks": [check.model_dump() for check in artifact.checks],
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest().upper()


def _insert_artifact_version(connection, artifact: Artifact, created_at: str, source: str) -> None:
    connection.execute(
        """
        insert or ignore into artifact_versions(
            id, artifact_id, task_run_id, version, title, content_hash,
            content, sources_json, checks_json, source, created_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"artifact-version-{uuid4().hex[:12]}",
            artifact.id,
            artifact.task_run_id,
            artifact.version,
            artifact.title,
            _artifact_content_hash(artifact),
            artifact.content,
            json.dumps(artifact.sources, ensure_ascii=False, sort_keys=True),
            json.dumps([check.model_dump() for check in artifact.checks], ensure_ascii=False, sort_keys=True),
            source,
            created_at,
        ),
    )


def _task_run_from_row(row) -> TaskRun:
    return TaskRun(
        id=row["id"],
        process_id=row["process_id"],
        profile_id=row["profile_id"],
        status=row["status"],
        stages=json.loads(row["stages_json"]),
        gates=json.loads(row["gates_json"]),
        artifact_id=row["artifact_id"],
        form_data=json.loads(row["form_data_json"]) if "form_data_json" in row.keys() and row["form_data_json"] else {},
    )


def _artifact_from_row(row) -> Artifact:
    return Artifact(
        id=row["id"],
        task_run_id=row["task_run_id"],
        version=row["version"],
        title=row["title"],
        content=row["content"],
        sources=json.loads(row["sources_json"]),
        checks=json.loads(row["checks_json"]),
    )


def _artifact_version_from_row(row) -> ArtifactVersionRecord:
    return ArtifactVersionRecord(
        id=row["id"],
        artifact_id=row["artifact_id"],
        task_run_id=row["task_run_id"],
        version=row["version"],
        title=row["title"],
        content_hash=row["content_hash"],
        source=row["source"],
        created_at=row["created_at"],
    )


def _audit_event_from_row(row) -> AuditEvent:
    return AuditEvent(
        id=row["id"],
        actor=row["actor"],
        action=row["action"],
        target=row["target"],
        redacted_payload=json.loads(row["redacted_payload_json"]),
    )


def _result_action_from_row(row) -> ResultActionRecord:
    return ResultActionRecord(
        id=row["id"],
        task_run_id=row["task_run_id"],
        action_id=row["action_id"],
        actor=row["actor"],
        status=row["status"],
        comment=row["comment"],
        related_task_run_id=row["related_task_run_id"] if "related_task_run_id" in row.keys() else None,
        created_at=row["created_at"],
    )


def _artifact_compare_action_from_row(row) -> ArtifactCompareActionRecord:
    return ArtifactCompareActionRecord(
        id=row["id"],
        job_id=row["job_id"],
        artifact_id=row["artifact_id"],
        version_id=row["version_id"],
        action_id=row["action_id"],
        actor=row["actor"],
        status=row["status"],
        comment=row["comment"],
        created_at=row["created_at"],
        gates=[
            GateResult(
                id="artifact-compare-action-recorded",
                title="Artifact compare action recorded",
                status="passed",
                reason="User decision on version comparison is stored without mutating artifact history.",
            )
        ],
    )


def get_task_run(task_run_id: str) -> TaskRun | None:
    task_run = TASK_RUNS.get(task_run_id)
    if task_run is not None:
        return task_run
    init_task_run_store()
    with get_connection() as connection:
        row = connection.execute("select * from task_runs where id = ?", (task_run_id,)).fetchone()
    return _task_run_from_row(row) if row else None


def get_artifact(artifact_id: str) -> Artifact | None:
    artifact = ARTIFACTS.get(artifact_id)
    if artifact is not None:
        return artifact
    init_task_run_store()
    with get_connection() as connection:
        row = connection.execute("select * from artifacts where id = ?", (artifact_id,)).fetchone()
    return _artifact_from_row(row) if row else None


def list_artifact_versions(artifact_id: str) -> list[ArtifactVersionRecord]:
    init_task_run_store()
    with get_connection() as connection:
        rows = connection.execute(
            """
            select * from artifact_versions
            where artifact_id = ?
            order by created_at, version, id
            """,
            (artifact_id,),
        ).fetchall()
    return [_artifact_version_from_row(row) for row in rows]


def list_audit_events_for_target(target: str) -> list[AuditEvent]:
    init_task_run_store()
    with get_connection() as connection:
        rows = connection.execute(
            "select * from audit_events where target = ? order by created_at, id",
            (target,),
        ).fetchall()
    return [_audit_event_from_row(row) for row in rows]


def list_result_action_records(task_run_id: str) -> list[ResultActionRecord]:
    init_task_run_store()
    with get_connection() as connection:
        rows = connection.execute(
            """
            select * from task_run_result_actions
            where task_run_id = ?
            order by created_at, id
            """,
            (task_run_id,),
        ).fetchall()
    return [_result_action_from_row(row) for row in rows]


def get_result_action_by_related_task_run_id(related_task_run_id: str) -> ResultActionRecord | None:
    init_task_run_store()
    with get_connection() as connection:
        row = connection.execute(
            """
            select * from task_run_result_actions
            where related_task_run_id = ?
            order by created_at desc, id desc
            limit 1
            """,
            (related_task_run_id,),
        ).fetchone()
    return _result_action_from_row(row) if row else None


def record_result_action(
    task_run_id: str,
    action_id: str,
    actor: str,
    comment: str | None = None,
    related_task_run_id: str | None = None,
) -> ResultActionRecord:
    init_task_run_store()
    now = datetime.now(UTC).isoformat()
    action_record = ResultActionRecord(
        id=f"result-action-{uuid4().hex[:12]}",
        task_run_id=task_run_id,
        action_id=action_id,
        actor=actor,
        status="completed",
        comment=comment,
        related_task_run_id=related_task_run_id,
        created_at=now,
    )
    audit_event = AuditEvent(
        id=f"audit-{uuid4().hex[:12]}",
        actor=actor,
        action=f"task_run.result_action.{action_id}",
        target=task_run_id,
        redacted_payload={
            "task_run_id": task_run_id,
            "action_id": action_id,
            "comment_present": bool(comment),
            "related_task_run_id": related_task_run_id,
            "secrets": "[redacted]",
        },
    )
    with get_connection() as connection:
        existing = connection.execute("select id from task_runs where id = ?", (task_run_id,)).fetchone()
        if existing is None:
            raise KeyError(task_run_id)
        connection.execute(
            """
            insert into task_run_result_actions(
                id, task_run_id, action_id, actor, status, comment, related_task_run_id, created_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                action_record.id,
                action_record.task_run_id,
                action_record.action_id,
                action_record.actor,
                action_record.status,
                action_record.comment,
                action_record.related_task_run_id,
                action_record.created_at,
            ),
        )
        connection.execute(
            """
            insert into audit_events(
                id, actor, action, target, redacted_payload_json, created_at
            )
            values (?, ?, ?, ?, ?, ?)
            """,
            (
                audit_event.id,
                audit_event.actor,
                audit_event.action,
                audit_event.target,
                json.dumps(audit_event.redacted_payload, ensure_ascii=False, sort_keys=True),
                now,
            ),
        )
    AUDIT_EVENTS.append(audit_event)
    return action_record


def _version_record_from_artifact(artifact: Artifact, created_at: str, source: str = "current_artifact") -> ArtifactVersionRecord:
    return ArtifactVersionRecord(
        id=f"current-{artifact.id}-{artifact.version}",
        artifact_id=artifact.id,
        task_run_id=artifact.task_run_id,
        version=artifact.version,
        title=artifact.title,
        content_hash=_artifact_content_hash(artifact),
        source=source,
        created_at=created_at,
    )


def _diff_value(field: str, before: str, after: str, summary: str) -> ArtifactVersionDiff:
    return ArtifactVersionDiff(
        field=field,
        status="same" if before == after else "changed",
        before=before,
        after=after,
        summary=summary,
    )


def _word_count(text: str) -> int:
    return len([part for part in text.replace("\n", " ").split(" ") if part.strip()])

def _content_diff_lines(base_text: str, target_text: str) -> list[ArtifactContentDiffLine]:
    base_lines = base_text.splitlines() or ([base_text] if base_text else [])
    target_lines = target_text.splitlines() or ([target_text] if target_text else [])
    matcher = SequenceMatcher(a=base_lines, b=target_lines, autojunk=False)
    diff_lines: list[ArtifactContentDiffLine] = []
    for tag, base_start, base_end, target_start, target_end in matcher.get_opcodes():
        if tag == "equal":
            for offset, line in enumerate(base_lines[base_start:base_end]):
                diff_lines.append(
                    ArtifactContentDiffLine(
                        type="unchanged",
                        text=line,
                        base_line=base_start + offset + 1,
                        target_line=target_start + offset + 1,
                    )
                )
        elif tag == "delete":
            for offset, line in enumerate(base_lines[base_start:base_end]):
                diff_lines.append(
                    ArtifactContentDiffLine(
                        type="removed",
                        text=line,
                        base_line=base_start + offset + 1,
                    )
                )
        elif tag == "insert":
            for offset, line in enumerate(target_lines[target_start:target_end]):
                diff_lines.append(
                    ArtifactContentDiffLine(
                        type="added",
                        text=line,
                        target_line=target_start + offset + 1,
                    )
                )
        elif tag == "replace":
            for offset, line in enumerate(base_lines[base_start:base_end]):
                diff_lines.append(
                    ArtifactContentDiffLine(
                        type="removed",
                        text=line,
                        base_line=base_start + offset + 1,
                    )
                )
            for offset, line in enumerate(target_lines[target_start:target_end]):
                diff_lines.append(
                    ArtifactContentDiffLine(
                        type="added",
                        text=line,
                        target_line=target_start + offset + 1,
                    )
                )
    return diff_lines


def compare_artifact_version_with_current(artifact_id: str, version_id: str, max_diff_lines: int = 120, diff_offset: int = 0) -> ArtifactVersionCompareResult:
    init_task_run_store()
    with get_connection() as connection:
        current_row = connection.execute("select * from artifacts where id = ?", (artifact_id,)).fetchone()
        if current_row is None:
            raise KeyError(artifact_id)
        base_row = connection.execute(
            """
            select * from artifact_versions
            where artifact_id = ? and id = ?
            """,
            (artifact_id, version_id),
        ).fetchone()
        if base_row is None:
            raise KeyError(version_id)
        if not base_row["content"] or not base_row["sources_json"] or not base_row["checks_json"]:
            raise ValueError("Base version has no stored snapshot and cannot be compared safely.")
        current_artifact = _artifact_from_row(current_row)
        target_record = _version_record_from_artifact(current_artifact, current_row["updated_at"])

    base_sources = json.loads(base_row["sources_json"])
    base_checks = json.loads(base_row["checks_json"])
    target_sources = current_artifact.sources
    target_checks = [check.model_dump() for check in current_artifact.checks]
    base_checks_compact = json.dumps(base_checks, ensure_ascii=False, sort_keys=True)
    target_checks_compact = json.dumps(target_checks, ensure_ascii=False, sort_keys=True)
    base_sources_compact = ", ".join(base_sources)
    target_sources_compact = ", ".join(target_sources)
    current_hash = _artifact_content_hash(current_artifact)

    diffs = [
        _diff_value("title", base_row["title"], current_artifact.title, "Название результата."),
        _diff_value("content", base_row["content"], current_artifact.content, "Текст бизнес-результата."),
        _diff_value("sources", base_sources_compact, target_sources_compact, "Источники и evidence-ссылки."),
        _diff_value("checks", base_checks_compact, target_checks_compact, "Проверки качества результата."),
        _diff_value("content_hash", base_row["content_hash"], current_hash, "Технический контрольный отпечаток версии."),
    ]
    semantic_change = any(diff.status == "changed" for diff in diffs if diff.field != "content_hash")
    content_delta_chars = len(current_artifact.content) - len(base_row["content"])
    content_delta_words = _word_count(current_artifact.content) - _word_count(base_row["content"])
    safe_diff_limit = max(20, min(max_diff_lines, 500))
    full_content_diff = _content_diff_lines(base_row["content"], current_artifact.content)
    content_diff_total = len(full_content_diff)
    safe_diff_offset = max(0, min(diff_offset, content_diff_total))
    content_diff = full_content_diff[safe_diff_offset:safe_diff_offset + safe_diff_limit]
    next_offset = safe_diff_offset + safe_diff_limit if content_diff_total > safe_diff_offset + safe_diff_limit else None
    content_diff_truncated = next_offset is not None
    added_lines = len([line for line in full_content_diff if line.type == "added"])
    removed_lines = len([line for line in full_content_diff if line.type == "removed"])
    unchanged_lines = len([line for line in full_content_diff if line.type == "unchanged"])
    changed_fields = [diff.field for diff in diffs if diff.status == "changed"]
    summary = (
        "Смысловых изменений нет; отличается только техническая версия/hash."
        if not semantic_change and "content_hash" in changed_fields
        else "Изменены поля: " + ", ".join(changed_fields)
        if changed_fields
        else "Версии совпадают."
    )

    return ArtifactVersionCompareResult(
        artifact_id=artifact_id,
        base_version=_artifact_version_from_row(base_row),
        target_version=target_record,
        semantic_change=semantic_change,
        content_delta_chars=content_delta_chars,
        content_delta_words=content_delta_words,
        added_lines=added_lines,
        removed_lines=removed_lines,
        unchanged_lines=unchanged_lines,
        content_diff_total=content_diff_total,
        content_diff_offset=safe_diff_offset,
        content_diff_limit=safe_diff_limit,
        content_diff_truncated=content_diff_truncated,
        content_diff_next_offset=next_offset,
        diffs=diffs,
        content_diff=content_diff,
        summary=summary,
        gates=[
            GateResult(
                id="artifact-compare-snapshot",
                title="Comparable version snapshot",
                status="passed",
                reason="Base version has stored content, sources and checks snapshot.",
            ),
            GateResult(
                id="artifact-compare-current",
                title="Current artifact loaded",
                status="passed",
                reason="Current artifact state is available for user-visible comparison.",
            ),
        ],
    )

def _artifact_diff_job_from_row(row) -> ArtifactDiffJobRecord:
    compare_result = None
    if row["compare_result_json"]:
        compare_result = ArtifactVersionCompareResult.model_validate(json.loads(row["compare_result_json"]))
    status = row["status"]
    gates = [
        GateResult(
            id="artifact-diff-job-recorded",
            title="Diff job recorded",
            status="passed",
            reason="Version compare request is stored as a managed job with a stable job id.",
        ),
        GateResult(
            id="artifact-diff-job-execution",
            title="Diff job execution",
            status="passed" if status == "completed" else "failed" if status == "failed" else "warning",
            reason="Diff job completed and stored compare evidence."
            if status == "completed"
            else row["error"] or "Diff job is not completed yet.",
        ),
    ]
    return ArtifactDiffJobRecord(
        id=row["id"],
        artifact_id=row["artifact_id"],
        version_id=row["version_id"],
        status=status,
        requested_by=row["requested_by"],
        max_diff_lines=row["max_diff_lines"],
        diff_offset=row["diff_offset"] if "diff_offset" in row.keys() else 0,
        compare_result=compare_result,
        error=row["error"],
        created_at=row["created_at"],
        completed_at=row["completed_at"],
        gates=gates,
    )


def create_artifact_diff_job(
    artifact_id: str,
    version_id: str,
    actor: str = "demo-user",
    max_diff_lines: int = 120,
    diff_offset: int = 0,
) -> ArtifactDiffJobRecord:
    init_task_run_store()
    now = datetime.now(UTC).isoformat()
    job_id = f"artifact-diff-job-{uuid4().hex[:12]}"
    safe_limit = max(20, min(max_diff_lines, 500))
    safe_offset = max(0, diff_offset)
    with get_connection() as connection:
        connection.execute(
            """
            insert into artifact_diff_jobs(
                id, artifact_id, version_id, status, requested_by, max_diff_lines, diff_offset,
                compare_result_json, error, created_at, completed_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (job_id, artifact_id, version_id, "running", actor, safe_limit, safe_offset, None, None, now, None),
        )
    try:
        compare_result = compare_artifact_version_with_current(artifact_id, version_id, safe_limit, safe_offset)
    except Exception as error:
        completed_at = datetime.now(UTC).isoformat()
        with get_connection() as connection:
            connection.execute(
                """
                update artifact_diff_jobs
                set status = ?, error = ?, completed_at = ?
                where id = ?
                """,
                ("failed", str(error), completed_at, job_id),
            )
            row = connection.execute("select * from artifact_diff_jobs where id = ?", (job_id,)).fetchone()
        return _artifact_diff_job_from_row(row)

    completed_at = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        connection.execute(
            """
            update artifact_diff_jobs
            set status = ?, compare_result_json = ?, completed_at = ?
            where id = ?
            """,
            (
                "completed",
                json.dumps(compare_result.model_dump(), ensure_ascii=False, sort_keys=True),
                completed_at,
                job_id,
            ),
        )
        row = connection.execute("select * from artifact_diff_jobs where id = ?", (job_id,)).fetchone()
    return _artifact_diff_job_from_row(row)


def get_artifact_diff_job(job_id: str) -> ArtifactDiffJobRecord | None:
    init_task_run_store()
    with get_connection() as connection:
        row = connection.execute("select * from artifact_diff_jobs where id = ?", (job_id,)).fetchone()
    if row is None:
        return None
    return _artifact_diff_job_from_row(row)


def record_artifact_compare_action(
    job_id: str,
    action_id: str,
    actor: str = "demo-user",
    comment: str = "",
) -> ArtifactCompareActionRecord:
    allowed_actions = {"accept-comparison", "send-to-revision", "prepare-restore"}
    if action_id not in allowed_actions:
        raise ValueError(f"Unsupported artifact compare action: {action_id}")
    init_task_run_store()
    now = datetime.now(UTC).isoformat()
    action_record_id = f"artifact-compare-action-{uuid4().hex[:12]}"
    with get_connection() as connection:
        job_row = connection.execute("select * from artifact_diff_jobs where id = ?", (job_id,)).fetchone()
        if job_row is None:
            raise KeyError(job_id)
        if job_row["status"] != "completed":
            raise ValueError("Artifact compare action requires a completed diff job.")
        connection.execute(
            """
            insert into artifact_compare_actions(
                id, job_id, artifact_id, version_id, action_id, actor, status, comment, created_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                action_record_id,
                job_id,
                job_row["artifact_id"],
                job_row["version_id"],
                action_id,
                actor,
                "recorded",
                comment,
                now,
            ),
        )
        row = connection.execute("select * from artifact_compare_actions where id = ?", (action_record_id,)).fetchone()
    return _artifact_compare_action_from_row(row)


def list_artifact_compare_actions(artifact_id: str) -> list[ArtifactCompareActionRecord]:
    init_task_run_store()
    with get_connection() as connection:
        rows = connection.execute(
            """
            select * from artifact_compare_actions
            where artifact_id = ?
            order by created_at desc
            """,
            (artifact_id,),
        ).fetchall()
    return [_artifact_compare_action_from_row(row) for row in rows]


def get_artifact_export_draft(artifact_id: str) -> ArtifactExportDraft:
    artifact = get_artifact(artifact_id)
    if artifact is None:
        raise KeyError(artifact_id)
    versions = list_artifact_versions(artifact_id)
    latest_version = versions[0] if versions else None
    content = {
        "artifact": artifact.model_dump(),
        "latest_version": latest_version.model_dump() if latest_version else None,
        "export_note": "MVP draft export for internal review. External export requires evidence policy approval.",
    }
    content_hash = hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    return ArtifactExportDraft(
        artifact_id=artifact_id,
        filename=f"{artifact_id}_{artifact.version}_draft.json",
        content_type="application/json",
        content=content,
        content_hash=content_hash,
        gates=[
            GateResult(
                id="artifact-export-internal-draft",
                title="Internal draft export only",
                status="passed",
                reason="Export package is a JSON draft for controlled MVP review, not an external client package.",
            )
        ],
    )


def get_artifact_evidence_package(artifact_id: str) -> ArtifactEvidencePackage:
    artifact = get_artifact(artifact_id)
    if artifact is None:
        raise KeyError(artifact_id)
    init_task_run_store()
    generated_at = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        version_rows = connection.execute(
            "select * from artifact_versions where artifact_id = ? order by created_at desc",
            (artifact_id,),
        ).fetchall()
        diff_job_rows = connection.execute(
            "select * from artifact_diff_jobs where artifact_id = ? order by created_at desc",
            (artifact_id,),
        ).fetchall()
        compare_action_rows = connection.execute(
            "select * from artifact_compare_actions where artifact_id = ? order by created_at desc",
            (artifact_id,),
        ).fetchall()
        audit_rows = connection.execute(
            """
            select * from audit_events
            where target = ?
            order by created_at desc
            """,
            (artifact_id,),
        ).fetchall()
    versions = [_artifact_version_from_row(row) for row in version_rows]
    diff_jobs = [_artifact_diff_job_from_row(row) for row in diff_job_rows]
    compare_actions = [_artifact_compare_action_from_row(row) for row in compare_action_rows]
    audit_events = [_audit_event_from_row(row) for row in audit_rows]
    package_payload = {
        "artifact": artifact.model_dump(),
        "versions": [version.model_dump() for version in versions],
        "diff_jobs": [job.model_dump() for job in diff_jobs],
        "compare_actions": [action.model_dump() for action in compare_actions],
        "audit_events": [event.model_dump() for event in audit_events],
        "generated_at": generated_at,
    }
    package_hash = hashlib.sha256(json.dumps(package_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    return ArtifactEvidencePackage(
        artifact_id=artifact_id,
        generated_at=generated_at,
        artifact=artifact,
        versions=versions,
        diff_jobs=diff_jobs,
        compare_actions=compare_actions,
        audit_events=audit_events,
        package_hash=package_hash,
        gates=[
            GateResult(
                id="artifact-evidence-package-linked",
                title="Artifact evidence package linked",
                status="passed",
                reason="Artifact, versions, compare jobs, compare decisions and audit records are returned as one evidence package.",
            )
        ],
    )


def _next_artifact_version(connection, artifact_id: str) -> str:
    rows = connection.execute(
        "select version from artifact_versions where artifact_id = ?",
        (artifact_id,),
    ).fetchall()
    max_index = 0
    for row in rows:
        version = str(row["version"])
        if version.startswith("v") and version[1:].isdigit():
            max_index = max(max_index, int(version[1:]))
    candidate_index = max_index + 1
    while connection.execute(
        "select 1 from artifact_versions where artifact_id = ? and version = ?",
        (artifact_id, f"v{candidate_index}"),
    ).fetchone():
        candidate_index += 1
    return f"v{candidate_index}"


def rollback_artifact_version(
    artifact_id: str,
    version_id: str,
    actor: str = "demo-user",
    reason: str = "Rollback requested from Result Center.",
) -> ArtifactRollbackResult:
    init_task_run_store()
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        current_row = connection.execute("select * from artifacts where id = ?", (artifact_id,)).fetchone()
        if current_row is None:
            raise KeyError(artifact_id)
        target_row = connection.execute(
            """
            select * from artifact_versions
            where artifact_id = ? and id = ?
            """,
            (artifact_id, version_id),
        ).fetchone()
        if target_row is None:
            raise KeyError(version_id)
        if not target_row["content"] or not target_row["sources_json"] or not target_row["checks_json"]:
            raise ValueError("Target version has no stored snapshot and cannot be restored safely.")

        next_version = _next_artifact_version(connection, artifact_id)
        restored_artifact = Artifact(
            id=artifact_id,
            task_run_id=current_row["task_run_id"],
            version=next_version,
            title=target_row["title"],
            content=target_row["content"],
            sources=json.loads(target_row["sources_json"]),
            checks=json.loads(target_row["checks_json"]),
        )
        connection.execute(
            """
            update artifacts
            set version = ?, title = ?, content = ?, sources_json = ?, checks_json = ?, updated_at = ?
            where id = ?
            """,
            (
                restored_artifact.version,
                restored_artifact.title,
                restored_artifact.content,
                json.dumps(restored_artifact.sources, ensure_ascii=False, sort_keys=True),
                json.dumps([check.model_dump() for check in restored_artifact.checks], ensure_ascii=False, sort_keys=True),
                now,
                artifact_id,
            ),
        )
        _insert_artifact_version(connection, restored_artifact, now, f"rollback:{target_row['version']}")
        created_row = connection.execute(
            """
            select * from artifact_versions
            where artifact_id = ? and version = ?
            """,
            (artifact_id, restored_artifact.version),
        ).fetchone()
        audit_event = AuditEvent(
            id=f"audit-{uuid4().hex[:12]}",
            actor=actor,
            action="artifact.version.rollback",
            target=artifact_id,
            redacted_payload={
                "artifact_id": artifact_id,
                "restored_from_version_id": version_id,
                "restored_from_version": target_row["version"],
                "created_version": restored_artifact.version,
                "reason_present": bool(reason),
                "secrets": "[redacted]",
            },
        )
        connection.execute(
            """
            insert into audit_events(
                id, actor, action, target, redacted_payload_json, created_at
            )
            values (?, ?, ?, ?, ?, ?)
            """,
            (
                audit_event.id,
                audit_event.actor,
                audit_event.action,
                audit_event.target,
                json.dumps(audit_event.redacted_payload, ensure_ascii=False, sort_keys=True),
                now,
            ),
        )

    ARTIFACTS[artifact_id] = restored_artifact
    AUDIT_EVENTS.append(audit_event)
    return ArtifactRollbackResult(
        artifact=restored_artifact,
        restored_from=_artifact_version_from_row(target_row),
        created_version=_artifact_version_from_row(created_row),
        audit_event=audit_event,
        gates=[
            GateResult(
                id="artifact-rollback-snapshot",
                title="Version snapshot restored",
                status="passed",
                reason="Target artifact version had stored content, sources and checks snapshot.",
            ),
            GateResult(
                id="artifact-rollback-audit",
                title="Rollback audit captured",
                status="passed",
                reason="Rollback created a new current version and audit event without deleting history.",
            ),
        ],
    )

def task_run_storage_status() -> dict[str, str | int | bool]:
    init_task_run_store()
    with get_connection() as connection:
        task_runs_total = connection.execute("select count(*) from task_runs").fetchone()[0]
        artifacts_total = connection.execute("select count(*) from artifacts").fetchone()[0]
        audit_events_total = connection.execute("select count(*) from audit_events").fetchone()[0]
        result_actions_total = connection.execute("select count(*) from task_run_result_actions").fetchone()[0]
    return {
        "storage": "sqlite",
        "db_path": str(DB_PATH),
        "persistent": True,
        "task_runs_total": task_runs_total,
        "artifacts_total": artifacts_total,
        "audit_events_total": audit_events_total,
        "result_actions_total": result_actions_total,
    }

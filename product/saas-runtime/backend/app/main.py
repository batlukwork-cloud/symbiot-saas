from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.routers import admin, artifacts, audit, data_protection, documents, health, llm_gateway, processes, quality, rag, runtime, security, task_runs
from app.services.security_context import is_public_path, require_runtime_session
from app.services.task_run_queue import resume_worker_scheduler_if_enabled, stop_worker_scheduler

app = FastAPI(
    title="Symbiot Runtime MVP",
    version="0.1.0-g3",
    description="G3 Core Integration scaffold for managed LLM business-process runtime.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3020",
        "http://127.0.0.1:3020",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def resume_persistent_worker_scheduler() -> None:
    resume_worker_scheduler_if_enabled()


@app.on_event("shutdown")
def stop_persistent_worker_scheduler() -> None:
    stop_worker_scheduler(actor="runtime-shutdown", reason="FastAPI shutdown.")


@app.middleware("http")
async def enforce_session_and_tenant(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    if request.url.path.startswith("/api") and not is_public_path(request.url.path):
        try:
            require_runtime_session(request)
        except Exception as exc:
            status_code = getattr(exc, "status_code", 401)
            detail = getattr(exc, "detail", "Unauthorized")
            return JSONResponse(status_code=status_code, content={"detail": detail})
    return await call_next(request)

app.include_router(health.router)
app.include_router(processes.router, prefix="/api")
app.include_router(task_runs.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(artifacts.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(rag.router, prefix="/api")
app.include_router(llm_gateway.router, prefix="/api")
app.include_router(quality.router, prefix="/api")
app.include_router(runtime.router, prefix="/api")
app.include_router(data_protection.router, prefix="/api")
app.include_router(security.router, prefix="/api")

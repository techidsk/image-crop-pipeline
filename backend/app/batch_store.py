import json
from pathlib import Path

from pydantic import ValidationError

from .preset_store import DATA_DIR
from .schemas import BatchJob


BATCH_JOBS_PATH = DATA_DIR / "batch_jobs.json"


def load_batch_jobs() -> list[BatchJob]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not BATCH_JOBS_PATH.exists():
        return []
    try:
        raw = json.loads(BATCH_JOBS_PATH.read_text(encoding="utf-8"))
        return [BatchJob.model_validate(item) for item in raw]
    except (json.JSONDecodeError, OSError, ValidationError):
        return []


def save_batch_jobs(jobs: list[BatchJob]) -> list[BatchJob]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BATCH_JOBS_PATH.write_text(
        json.dumps([job.model_dump(mode="json") for job in jobs], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return jobs


def append_batch_job(job: BatchJob) -> BatchJob:
    jobs = load_batch_jobs()
    save_batch_jobs([job, *jobs])
    return job

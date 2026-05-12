import json
import sqlite3
from pathlib import Path

from .preset_store import DATA_DIR
from .schemas import BatchJob, BatchJobImage, ReviewStatus


DB_PATH = DATA_DIR / "app.db"
LEGACY_BATCH_JOBS_PATH = DATA_DIR / "batch_jobs.json"


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_store() -> None:
    with connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS batch_jobs (
                id TEXT PRIMARY KEY,
                scene_id TEXT NOT NULL,
                scene_name TEXT NOT NULL,
                pose_provider TEXT NOT NULL,
                output_dir TEXT NOT NULL,
                image_count INTEGER NOT NULL,
                output_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                review_status TEXT NOT NULL DEFAULT 'pending_review',
                images_json TEXT NOT NULL
            )
            """
        )
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(batch_jobs)").fetchall()
        }
        if "review_status" not in columns:
            connection.execute(
                "ALTER TABLE batch_jobs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending_review'"
            )
        connection.commit()
    migrate_legacy_json()


def migrate_legacy_json() -> None:
    if not LEGACY_BATCH_JOBS_PATH.exists():
        return
    try:
        raw_jobs = json.loads(LEGACY_BATCH_JOBS_PATH.read_text(encoding="utf-8"))
        jobs = [BatchJob.model_validate(item) for item in raw_jobs]
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        return
    with connect() as connection:
        for job in jobs:
            insert_job(connection, job)
        connection.commit()


def row_to_job(row: sqlite3.Row) -> BatchJob:
    images = [BatchJobImage.model_validate(item) for item in json.loads(row["images_json"])]
    return BatchJob(
        id=row["id"],
        sceneId=row["scene_id"],
        sceneName=row["scene_name"],
        poseProvider=row["pose_provider"],
        outputDir=row["output_dir"],
        imageCount=row["image_count"],
        outputCount=row["output_count"],
        status=row["status"],
        createdAt=row["created_at"],
        reviewStatus=row["review_status"] or "pending_review",
        images=images,
    )


def insert_job(connection: sqlite3.Connection, job: BatchJob) -> None:
    connection.execute(
        """
        INSERT OR REPLACE INTO batch_jobs (
            id,
            scene_id,
            scene_name,
            pose_provider,
            output_dir,
            image_count,
            output_count,
            status,
            created_at,
            review_status,
            images_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job.id,
            job.sceneId,
            job.sceneName,
            job.poseProvider,
            job.outputDir,
            job.imageCount,
            job.outputCount,
            job.status,
            job.createdAt,
            job.reviewStatus,
            json.dumps([image.model_dump(mode="json") for image in job.images], ensure_ascii=False),
        ),
    )


def load_batch_jobs() -> list[BatchJob]:
    ensure_store()
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM batch_jobs ORDER BY created_at DESC, id DESC"
        ).fetchall()
    return [row_to_job(row) for row in rows]


def append_batch_job(job: BatchJob) -> BatchJob:
    ensure_store()
    with connect() as connection:
        insert_job(connection, job)
        connection.commit()
    return job


def get_batch_job(job_id: str) -> BatchJob | None:
    ensure_store()
    with connect() as connection:
        row = connection.execute("SELECT * FROM batch_jobs WHERE id = ?", (job_id,)).fetchone()
    return row_to_job(row) if row is not None else None


def update_batch_job_review_status(job_id: str, review_status: ReviewStatus) -> BatchJob | None:
    ensure_store()
    with connect() as connection:
        row = connection.execute("SELECT * FROM batch_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            return None
        job = row_to_job(row).model_copy(update={"reviewStatus": review_status})
        insert_job(connection, job)
        connection.commit()
    return job


def update_batch_job_image_review_status(
    job_id: str,
    filename: str,
    review_status: ReviewStatus,
) -> BatchJob | None:
    ensure_store()
    with connect() as connection:
        row = connection.execute("SELECT * FROM batch_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            return None
        job = row_to_job(row)
        matched = False
        images = []
        for image in job.images:
            if image.filename == filename:
                matched = True
                images.append(image.model_copy(update={"reviewStatus": review_status}))
            else:
                images.append(image)
        if not matched:
            raise ValueError("Batch job image not found")
        job = job.model_copy(update={"images": images})
        insert_job(connection, job)
        connection.commit()
    return job

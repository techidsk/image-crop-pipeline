import json
import sqlite3

import pytest

from backend.app import batch_store
from backend.app.schemas import BatchJob, BatchJobImage


@pytest.fixture()
def isolated_batch_store(tmp_path, monkeypatch):
    monkeypatch.setattr(batch_store, "DB_PATH", tmp_path / "app.db")
    monkeypatch.setattr(batch_store, "LEGACY_BATCH_JOBS_PATH", tmp_path / "batch_jobs.json")
    return tmp_path


def make_job(job_id: str = "job-1") -> BatchJob:
    return BatchJob(
        id=job_id,
        sceneId="scene-1",
        sceneName="Scene",
        poseProvider="heuristic",
        outputDir="outputs/job-1",
        imageCount=1,
        outputCount=1,
        status="completed",
        createdAt="2026-05-12T10:00:00",
        images=[BatchJobImage(filename="a.jpg", outputs=1)],
    )


def test_batch_store_migrates_old_sqlite_rows_with_default_review_status(isolated_batch_store):
    with sqlite3.connect(batch_store.DB_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE batch_jobs (
                id TEXT PRIMARY KEY,
                scene_id TEXT NOT NULL,
                scene_name TEXT NOT NULL,
                pose_provider TEXT NOT NULL,
                output_dir TEXT NOT NULL,
                image_count INTEGER NOT NULL,
                output_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                images_json TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO batch_jobs (
                id,
                scene_id,
                scene_name,
                pose_provider,
                output_dir,
                image_count,
                output_count,
                status,
                created_at,
                images_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "legacy",
                "scene-1",
                "Scene",
                "heuristic",
                "outputs/legacy",
                1,
                1,
                "completed",
                "2026-05-12T10:00:00",
                json.dumps([{"filename": "a.jpg", "outputs": 1, "error": ""}]),
            ),
        )
        connection.commit()

    jobs = batch_store.load_batch_jobs()

    assert jobs[0].reviewStatus == "pending_review"
    assert jobs[0].images[0].reviewStatus == "pending_review"


def test_update_batch_job_review_status(isolated_batch_store):
    batch_store.append_batch_job(make_job())

    job = batch_store.update_batch_job_review_status("job-1", "approved")

    assert job is not None
    assert job.reviewStatus == "approved"
    assert batch_store.load_batch_jobs()[0].reviewStatus == "approved"


def test_update_batch_job_image_review_status(isolated_batch_store):
    batch_store.append_batch_job(make_job())

    job = batch_store.update_batch_job_image_review_status("job-1", "a.jpg", "rejected")

    assert job is not None
    assert job.images[0].reviewStatus == "rejected"


def test_update_batch_job_image_review_status_rejects_unknown_image(isolated_batch_store):
    batch_store.append_batch_job(make_job())

    with pytest.raises(ValueError):
        batch_store.update_batch_job_image_review_status("job-1", "missing.jpg", "rejected")

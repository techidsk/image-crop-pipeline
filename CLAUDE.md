# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Batch image-cropping workbench. Upload images → detect human pose keypoints → use pose nodes as anchors → output multiple cropped sizes per preset. Frontend: Vite + React 19 + antd v6 (Bun). Backend: FastAPI + Pillow + ONNX Runtime.

## Commands

Local development (PowerShell, paths assume Windows):

```powershell
bun install
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt pytest
.\.venv\Scripts\python -m uvicorn backend.app.main:app --reload --port 8000
bun run dev                       # frontend dev server on :7171
```

Verify / build:

```powershell
.\.venv\Scripts\python -m pytest backend\tests          # all backend tests
.\.venv\Scripts\python -m pytest backend\tests\test_cropping.py::test_name   # single test
bun run build                     # tsc -b && vite build
```

Docker Compose (frontend on `:8080`, Nginx proxies `/api` to backend on `:8000`):

```powershell
docker compose up -d --build
docker compose logs -f backend
```

Deploy to test server: `.\scripts\deploy.ps1` (patch mode, no Docker Hub pull) or `.\scripts\deploy.ps1 -Mode full` (full rebuild). Targets the SSH alias `image-crop-server`.

## Architecture

### Request pipeline
Every image flows through the same steps in `backend/app/main.py`:
1. `detect_pose` — runs the pose provider; downscales images larger than `POSE_DETECT_MAX_SIDE` (1280px) before detection, then rescales keypoints back to original coordinates.
2. `classify_view` (`view_classifier.py`) — classifies the image as `front` / `side` / `back`.
3. `presets_for_view` — filters presets whose `viewAngles` include the detected angle.
4. `make_crop` (`cropping.py`) — produces one cropped PNG per matched preset.

### Pose providers (`pose.py`)
`make_pose_provider(name)` builds one of:
- `heuristic` — deterministic placeholder returning fixed keypoint ratios; always available, used as fallback.
- `rtmw` / `rtmw_onnx` — `RTMWOnnxPoseProvider`, COCO-WholeBody 133-point ONNX model. Requires `backend/requirements-onnx.txt`.
- `rtmw_transformers` — Hugging Face port; requires `backend/requirements-rtmw.txt` (heavy: torch).

On startup `main.py` always loads `heuristic` and *attempts* `rtmw`; if the ONNX model is missing, `rtmw` is silently skipped and requests asking for it fall back to `heuristic` (`resolve_pose_provider_name`). The `POSE_PROVIDER` env var only affects which provider is the default. All providers return a `Pose` (list of `PoseKeypoint`); `Pose.point()` synthesizes virtual `neck` / `mid_hip` points from shoulders/hips.

### Cropping strategies (`cropping.py`)
`make_crop` branches on `preset.strategy`:
- `anchor_center` (default) / `anchor_top` — box centered or top-aligned on the named anchor keypoint.
- `full_height` — full image height, width derived from aspect ratio.
- `pose_semantic_composition` — uses `semantic_frame()` named anchors (`head_top`, `shoulder`, `hip`, `thigh_30`, `knee`, `ankle`, ...) plus the preset's `composition` dict.
- `learned_composition` — box expressed as fractions of the detected person bounds.

After strategy, `apply_crop_guards` optionally expands the box to keep head/hands in frame (`protectHead` / `protectHands`), then `constrain_box_to_image` clamps it. Crops are returned base64-encoded in the JSON response; `process_upload_to_output_dir` also writes them to disk for batch jobs.

### Persistence (`backend/data/`)
- Presets, scenes, training samples → JSON files (`preset_store.py`, `scene_store.py`, `training_store.py`) — kept as JSON deliberately so they are diff-able / version-controllable.
- Batch job history → SQLite (`backend/data/app.db`, `batch_store.py`). `ensure_store()` runs lazily on every access, creates the table, runs lightweight `ALTER TABLE` migrations, and migrates a legacy `batch_jobs.json` if present.

### Training flow
"Preset management" lets users upload ≥5 sample images with manual crop boxes. The backend detects pose on each, the frontend (`utils/cropTraining.ts`) analyzes semantic composition, filters outliers, and produces a `pose_semantic_composition` preset from the median. The `HeuristicPoseProvider` is an explicit placeholder — wiring a real provider means adding a class in `pose.py` that returns the same `PoseKeypoint` list.

### Frontend (`src/`)
Single-page app, no router library — `App.tsx` does manual `pathname` ↔ view routing via `history.pushState` / `popstate`. Views: `batch`, `batchJobs`, `sceneList`, `presetList`, `presetEditor`, `viewTest`. Server state (presets, scenes, jobs) lives in `App.tsx` and is persisted through `src/api/presets.ts`. The `@` import alias maps to `src/`. The streaming batch endpoint (`/api/batch-jobs/run-stream`) emits NDJSON progress events.

## Conventions

- API field names use camelCase on both sides — Pydantic models in `schemas.py` declare fields like `viewAngle`, `presetId`, `outputDir` directly (no alias generator), so the JSON contract matches the TypeScript types in `src/types.ts`.
- Pose keypoint names follow COCO-WholeBody (`left_shoulder`, `right_hip`, `face_*`, `left_hand_*`, ...). `cropping.py` deliberately restricts bounding-box computation to body-trunk points (`BODY_BOUND_KEYPOINTS`) to avoid finger/face detail points skewing the box.
- The pose provider input is the whole image as a single subject — no person detector. Multi-person images are not supported.
- Frontend uses **Bun** as the package manager. Use `bun add` / `bun remove` (not `npm install` / `npm uninstall`) so `bun.lock` stays authoritative. `package-lock.json` is kept only because the deploy workflow uses `npm install` as fallback (see commit `c538dfe`).
- Frontend styling is **antd-only** — Tailwind was removed. Use antd `<Flex>` / `<Space>` for layout, inline `style` for one-off rules, and `src/styles.css` for the few class-based states that need `:hover` / `:last-child` etc. (`list-row-button`, `row-highlight`, `row-faded`).

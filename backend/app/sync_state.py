"""云端同步状态：记录预设/场景集合是否已同步到 OSS。

sync_state.json 仅保存在本地——它是关于「同步」的元数据，存到 OSS 会自相矛盾。
按集合粒度跟踪（presets.json / scenes.json 各一条）。
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SYNC_STATE_PATH = DATA_DIR / "sync_state.json"


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_sync_state() -> dict:
    if not SYNC_STATE_PATH.exists():
        return {}
    try:
        return json.loads(SYNC_STATE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_sync_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SYNC_STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def record_sync_result(
    key: str, local_hash: str, success: bool, error: str | None = None
) -> None:
    """记录一次同步尝试的结果。成功时更新 syncedHash，失败时只记录错误。"""
    state = load_sync_state()
    entry = state.get(key, {})
    entry["localHash"] = local_hash
    if success:
        entry["syncedHash"] = local_hash
        entry["lastSyncedAt"] = _now_iso()
        entry["lastError"] = None
    else:
        entry["lastError"] = error
        entry["lastAttemptAt"] = _now_iso()
    state[key] = entry
    _save_sync_state(state)


def get_entry_status(key: str) -> dict:
    """返回某集合的同步状态：synced（已同步）/ pending（待同步）/ unknown（未知）。"""
    entry = load_sync_state().get(key)
    if not entry:
        return {"status": "unknown", "lastSyncedAt": None, "lastError": None}
    local = entry.get("localHash")
    synced = entry.get("syncedHash")
    status = "synced" if local and synced and local == synced else "pending"
    return {
        "status": status,
        "lastSyncedAt": entry.get("lastSyncedAt"),
        # 已同步时 lastError 是上一次冗余尝试的残留，与当前状态无关
        "lastError": entry.get("lastError") if status == "pending" else None,
    }

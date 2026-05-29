"""存储抽象层：支持本地文件与阿里云 OSS。

复用代码库已有的 provider 模式（参考 pose.py 的 PoseProvider）。存储层只需读写按
key 命名的 JSON 文本 blob，因此接口保持极简。

OSS 模式采用「OSS 为主 + 本地缓存」+「尽力而为同步」：写入时本地必成功，OSS 失败
不报错而是记为待同步，由启动重试 / 手动触发补同步。版本管理依赖 OSS 桶版本控制。
"""

import os
from abc import ABC, abstractmethod
from pathlib import Path

from .sync_state import content_hash, get_entry_status, record_sync_result

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

# 纳入云端同步状态跟踪的集合
TRACKED_KEYS = ("presets.json", "scenes.json", "export_settings.json")


class StorageProvider(ABC):
    @abstractmethod
    def read(self, key: str) -> str | None:
        """读取 key 对应的文本内容，不存在时返回 None。"""
        raise NotImplementedError

    @abstractmethod
    def write(self, key: str, content: str) -> None:
        """写入 key 对应的文本内容。"""
        raise NotImplementedError


class FileStorageProvider(StorageProvider):
    """本地文件存储，对应 backend/data 下的 JSON 文件。"""

    def __init__(self, base_dir: Path = DATA_DIR) -> None:
        self.base_dir = base_dir

    def read(self, key: str) -> str | None:
        path = self.base_dir / key
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    def write(self, key: str, content: str) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        (self.base_dir / key).write_text(content, encoding="utf-8")


class OSSStorageProvider(StorageProvider):
    """阿里云 OSS 存储，OSS 为主 + 本地缓存 + 尽力而为同步。"""

    def __init__(
        self,
        bucket: "oss2.Bucket",  # noqa: F821 - 运行期才导入 oss2
        prefix: str,
        cache_dir: Path = DATA_DIR,
    ) -> None:
        self.bucket = bucket
        self.prefix = prefix
        self.cache_dir = cache_dir

    def _object_key(self, key: str) -> str:
        return f"{self.prefix}{key}"

    def _read_oss(self, key: str) -> str | None:
        """只从 OSS 读取，不回退本地。对象不存在返回 None，其它异常向上抛。"""
        import oss2

        try:
            return self.bucket.get_object(self._object_key(key)).read().decode("utf-8")
        except oss2.exceptions.NoSuchKey:
            return None

    def read(self, key: str) -> str | None:
        try:
            return self._read_oss(key)
        except Exception as exc:  # OSS 故障 / 网络异常
            print(f"[storage] OSS 读取 {key} 失败，回退本地缓存: {exc}", flush=True)
        cache_path = self.cache_dir / key
        if cache_path.exists():
            return cache_path.read_text(encoding="utf-8")
        return None

    def write(self, key: str, content: str) -> None:
        # 本地先写：本地是数据来源，写失败必须报错
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        (self.cache_dir / key).write_text(content, encoding="utf-8")
        # OSS 尽力而为：失败不报错，记为待同步
        self._push(key, content)

    def _push(self, key: str, content: str) -> bool:
        local_hash = content_hash(content)
        try:
            self.bucket.put_object(self._object_key(key), content.encode("utf-8"))
        except Exception as exc:
            record_sync_result(key, local_hash, success=False, error=str(exc))
            print(f"[storage] OSS 同步 {key} 失败，已保存本地，待重试: {exc}", flush=True)
            return False
        record_sync_result(key, local_hash, success=True)
        return True

    def reconcile(self, key: str) -> bool:
        """对账补同步：本地与 OSS 一致则只更新状态，不一致则推送本地内容。"""
        path = self.cache_dir / key
        if not path.exists():
            return False
        content = path.read_text(encoding="utf-8")
        local_hash = content_hash(content)
        try:
            remote = self._read_oss(key)
        except Exception as exc:
            record_sync_result(key, local_hash, success=False, error=str(exc))
            print(f"[storage] OSS 对账 {key} 失败: {exc}", flush=True)
            return False
        if remote is not None and content_hash(remote) == local_hash:
            record_sync_result(key, local_hash, success=True)
            return True
        return self._push(key, content)

    def ensure_versioning(self) -> None:
        """尽力为 OSS 桶启用版本控制；无权限时打印提示，由用户在控制台手动开启。"""
        try:
            import oss2

            result = self.bucket.get_bucket_versioning()
            if getattr(result, "status", None) == "Enabled":
                print("[storage] OSS 桶版本控制已启用。", flush=True)
                return
            self.bucket.put_bucket_versioning(
                oss2.models.BucketVersioningConfig("Enabled")
            )
            print("[storage] 已为 OSS 桶启用版本控制。", flush=True)
        except Exception as exc:
            print(
                f"[storage] 无法自动启用 OSS 桶版本控制（可在阿里云控制台手动开启）: {exc}",
                flush=True,
            )


def _make_oss_provider() -> StorageProvider:
    """根据环境变量构建 OSS provider，凭证缺失或 oss2 未安装时回退到 file。"""
    access_key_id = os.getenv("OSS_ACCESS_KEY_ID", "").strip()
    access_key_secret = os.getenv("OSS_ACCESS_KEY_SECRET", "").strip()
    endpoint = os.getenv("OSS_ENDPOINT", "").strip()
    bucket_name = os.getenv("OSS_BUCKET", "").strip()
    prefix = os.getenv("OSS_PREFIX", "image-crop-pipeline/")

    if not all([access_key_id, access_key_secret, endpoint, bucket_name]):
        print(
            "[storage] STORAGE_PROVIDER=oss 但 OSS 凭证不完整，降级为本地文件存储。",
            flush=True,
        )
        return FileStorageProvider()

    try:
        import oss2
    except ImportError:
        print(
            "[storage] STORAGE_PROVIDER=oss 但未安装 oss2，降级为本地文件存储。",
            flush=True,
        )
        return FileStorageProvider()

    auth = oss2.Auth(access_key_id, access_key_secret)
    bucket = oss2.Bucket(auth, endpoint, bucket_name)
    print(f"[storage] 使用阿里云 OSS 存储：bucket={bucket_name} prefix={prefix}", flush=True)
    provider = OSSStorageProvider(bucket, prefix)
    provider.ensure_versioning()
    return provider


def make_storage_provider() -> StorageProvider:
    provider_name = os.getenv("STORAGE_PROVIDER", "file").strip().lower()
    if provider_name == "oss":
        return _make_oss_provider()
    return FileStorageProvider()


_provider: StorageProvider | None = None


def get_storage_provider() -> StorageProvider:
    global _provider
    if _provider is None:
        _provider = make_storage_provider()
    return _provider


def get_storage_status() -> dict:
    """返回存储与云端同步状态，供 /api/storage/status 使用。"""
    provider = get_storage_provider()
    if not isinstance(provider, OSSStorageProvider):
        return {"provider": "file", "cloudSync": False, "collections": {}}
    return {
        "provider": "oss",
        "cloudSync": True,
        "bucket": getattr(provider.bucket, "bucket_name", None),
        "collections": {
            name: get_entry_status(key)
            for name, key in (
                ("presets", "presets.json"),
                ("scenes", "scenes.json"),
                ("exportSettings", "export_settings.json"),
            )
        },
    }


def sync_now(force: bool = False) -> dict:
    """补同步：force=True 时对账所有集合，否则只处理非 synced 的集合。"""
    provider = get_storage_provider()
    if isinstance(provider, OSSStorageProvider):
        for key in TRACKED_KEYS:
            if force or get_entry_status(key)["status"] != "synced":
                provider.reconcile(key)
    return get_storage_status()

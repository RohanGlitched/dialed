"""Storage: one interface, two backends.

Records are JSON documents addressed by (kind, partition, id):
  gauge   / -          / PI-104
  reading / PI-104     / 2026-10-12T09:14:03Z-ab12
  order   / -          / WO-1042
  round   / -          / pump-house
  run     / pump-house / 2026-10-12-0900
  trace   / -          / <id>
Blobs (photos, straightened dials, inspect bundles) are bytes under a key.

LocalStore writes files under .data/ for development and tests.
AwsStore uses one DynamoDB table (pk = kind or kind#partition, sk = id) and one S3 bucket.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path


class LocalStore:
    def __init__(self, root: str | Path = ".data"):
        self.root = Path(root)
        self._lock = threading.Lock()

    def _path(self, kind: str, id: str, partition: str | None) -> Path:
        base = self.root / kind / (partition or "_")
        return base / f"{_safe(id)}.json"

    def put(self, kind: str, id: str, obj: dict, partition: str | None = None) -> dict:
        p = self._path(kind, id, partition)
        p.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(obj, indent=1, default=str), encoding="utf-8")
            os.replace(tmp, p)
        return obj

    def get(self, kind: str, id: str, partition: str | None = None) -> dict | None:
        p = self._path(kind, id, partition)
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def list(self, kind: str, partition: str | None = None, limit: int | None = None, newest_first: bool = False) -> list[dict]:
        base = self.root / kind / (partition or "_")
        if not base.exists():
            return []
        files = sorted(base.glob("*.json"), key=lambda f: f.stem, reverse=newest_first)
        if limit:
            files = files[:limit]
        return [json.loads(f.read_text(encoding="utf-8")) for f in files]

    def delete(self, kind: str, id: str, partition: str | None = None) -> None:
        p = self._path(kind, id, partition)
        if p.exists():
            p.unlink()

    def put_blob(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        p = self.root / "blobs" / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return key

    def get_blob(self, key: str) -> bytes | None:
        p = self.root / "blobs" / key
        return p.read_bytes() if p.exists() else None

    def blob_url(self, key: str) -> str:
        return f"/api/blob/{key}"


class AwsStore:
    def __init__(self, table: str, bucket: str, region: str | None = None):
        import boto3

        self.table = boto3.resource("dynamodb", region_name=region).Table(table)
        self.s3 = boto3.client("s3", region_name=region)
        self.bucket = bucket

    @staticmethod
    def _pk(kind: str, partition: str | None) -> str:
        return f"{kind}#{partition}" if partition else kind

    def put(self, kind: str, id: str, obj: dict, partition: str | None = None) -> dict:
        item = {"pk": self._pk(kind, partition), "sk": id, "doc": json.dumps(obj, default=str)}
        self.table.put_item(Item=item)
        return obj

    def get(self, kind: str, id: str, partition: str | None = None) -> dict | None:
        r = self.table.get_item(Key={"pk": self._pk(kind, partition), "sk": id})
        it = r.get("Item")
        return json.loads(it["doc"]) if it else None

    def list(self, kind: str, partition: str | None = None, limit: int | None = None, newest_first: bool = False) -> list[dict]:
        from boto3.dynamodb.conditions import Key

        kw = {"KeyConditionExpression": Key("pk").eq(self._pk(kind, partition)), "ScanIndexForward": not newest_first}
        out: list[dict] = []
        while True:
            if limit:
                kw["Limit"] = limit - len(out)
            r = self.table.query(**kw)
            out += [json.loads(i["doc"]) for i in r.get("Items", [])]
            if (limit and len(out) >= limit) or "LastEvaluatedKey" not in r:
                return out
            kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]

    def delete(self, kind: str, id: str, partition: str | None = None) -> None:
        self.table.delete_item(Key={"pk": self._pk(kind, partition), "sk": id})

    def put_blob(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type, CacheControl="public, max-age=31536000, immutable")
        return key

    def get_blob(self, key: str) -> bytes | None:
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.s3.exceptions.NoSuchKey:
            return None

    def blob_url(self, key: str) -> str:
        # blobs are served through the site's CDN (CloudFront /media/* -> bucket), see infra/template.yaml
        return f"/media/{key}"


def _safe(id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_.:" else "_" for c in id).replace(":", "-")


def from_env():
    if os.environ.get("DIALED_TABLE"):
        return AwsStore(os.environ["DIALED_TABLE"], os.environ["DIALED_BUCKET"], os.environ.get("AWS_REGION"))
    return LocalStore(os.environ.get("DIALED_DATA", Path(__file__).resolve().parent.parent / ".data"))


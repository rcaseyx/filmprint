"""Redis-backed cache for per-user pipeline state.

Moves _user_states, _user_profile_states, _profile_response_cache, and
_examples_response_cache out of the Python heap and into Redis. Falls back
to a plain dict if REDIS_URL is unset or Redis is unreachable.

Serialization handles numpy arrays and sets, which appear throughout the
user state dicts. Plain JSON types pass through unchanged.
"""

import json
import logging
import os

import numpy as np

logger = logging.getLogger(__name__)

# ── serialization ────────────────────────────────────────────────────────────

def _encode(obj):
    if isinstance(obj, np.ndarray):
        return {"__ndarray__": obj.tolist(), "__dtype__": str(obj.dtype)}
    if isinstance(obj, (set, frozenset)):
        return {"__set__": list(obj)}
    if isinstance(obj, dict):
        return {k: _encode(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_encode(i) for i in obj]
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    return obj


def _decode(obj):
    if isinstance(obj, dict):
        if "__ndarray__" in obj:
            return np.array(obj["__ndarray__"], dtype=obj.get("__dtype__", "float32"))
        if "__set__" in obj:
            return set(obj["__set__"])
        return {k: _decode(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_decode(i) for i in obj]
    return obj


def _serialize(value: dict) -> bytes:
    return json.dumps(_encode(value)).encode()


def _deserialize(data: bytes) -> dict:
    return _decode(json.loads(data))


# ── Redis client ─────────────────────────────────────────────────────────────

def _connect():
    url = os.environ.get("REDIS_URL")
    if not url:
        return None
    try:
        import redis
        client = redis.from_url(url, decode_responses=False, socket_connect_timeout=3)
        client.ping()
        logger.info("[cache] Redis connected: %s", url.split("@")[-1])
        return client
    except Exception as exc:
        logger.warning("[cache] Redis unavailable, falling back to in-memory: %s", exc)
        return None


# ── cache wrapper ─────────────────────────────────────────────────────────────

_TTL = 60 * 60 * 48  # 48 hours


class StateCache:
    """Dict-like interface backed by Redis. Falls back to a plain dict on error."""

    def __init__(self, client, prefix: str) -> None:
        self._r = client
        self._prefix = prefix
        self._fallback: dict = {}

    def _key(self, user_id: int) -> str:
        return f"{self._prefix}:{user_id}"

    def __setitem__(self, user_id: int, value: dict) -> None:
        if self._r is None:
            self._fallback[user_id] = value
            return
        try:
            self._r.setex(self._key(user_id), _TTL, _serialize(value))
        except Exception as exc:
            logger.warning("[cache] Redis set failed (%s), using fallback", exc)
            self._fallback[user_id] = value

    def __getitem__(self, user_id: int) -> dict:
        value = self.get(user_id)
        if value is None:
            raise KeyError(user_id)
        return value

    def get(self, user_id: int, default=None):
        if self._r is None:
            return self._fallback.get(user_id, default)
        try:
            data = self._r.get(self._key(user_id))
        except Exception as exc:
            logger.warning("[cache] Redis get failed (%s), using fallback", exc)
            return self._fallback.get(user_id, default)
        if data is None:
            return self._fallback.get(user_id, default)
        return _deserialize(data)

    def pop(self, user_id: int, default=None):
        self._fallback.pop(user_id, None)
        if self._r is None:
            return default
        try:
            pipe = self._r.pipeline()
            pipe.get(self._key(user_id))
            pipe.delete(self._key(user_id))
            data, _ = pipe.execute()
        except Exception as exc:
            logger.warning("[cache] Redis pop failed (%s)", exc)
            return default
        if data is None:
            return default
        return _deserialize(data)

    def __contains__(self, user_id: int) -> bool:
        if self._r is None:
            return user_id in self._fallback
        try:
            return bool(self._r.exists(self._key(user_id)))
        except Exception:
            return user_id in self._fallback

    def __delitem__(self, user_id: int) -> None:
        self._fallback.pop(user_id, None)
        if self._r is not None:
            try:
                self._r.delete(self._key(user_id))
            except Exception as exc:
                logger.warning("[cache] Redis delete failed (%s)", exc)


def make_caches() -> tuple["StateCache", "StateCache", "StateCache", "StateCache"]:
    """Return the four per-user caches, all sharing one Redis connection."""
    client = _connect()
    return (
        StateCache(client, "user_states"),
        StateCache(client, "user_profile_states"),
        StateCache(client, "profile_response_cache"),
        StateCache(client, "examples_response_cache"),
    )

"""
Persistent key-value store.
- Production: Supabase REST API (HTTP, no IPv6 issues)
- Development: local JSON file (no env vars needed)
"""
import os
import json
import logging

log = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

_LOCAL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "kv_store.json")
_client = None


# ── Supabase client ───────────────────────────────────────────────────────────
def _get_client():
    global _client
    if _client is None:
        from supabase import create_client
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


def _sb_get(key, default=None):
    try:
        res = _get_client().table("kv_store").select("value").eq("key", key).execute()
        if res.data:
            return json.loads(res.data[0]["value"])
        return default
    except Exception as e:
        log.error("supabase get error: %s", e)
        return default


def _sb_set(key, value):
    _get_client().table("kv_store").upsert({
        "key":   key,
        "value": json.dumps(value, ensure_ascii=False),
    }).execute()


# ── Local fallback ────────────────────────────────────────────────────────────
def _local_load():
    if os.path.exists(_LOCAL_FILE):
        with open(_LOCAL_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _local_get(key, default=None):
    return _local_load().get(key, default)


def _local_set(key, value):
    store = _local_load()
    store[key] = value
    with open(_LOCAL_FILE, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)


# ── Public API ────────────────────────────────────────────────────────────────
def _use_supabase():
    return bool(SUPABASE_URL and SUPABASE_KEY)


def kv_get(key, default=None):
    if _use_supabase():
        return _sb_get(key, default)
    return _local_get(key, default)


def kv_set(key, value):
    if _use_supabase():
        _sb_set(key, value)
    else:
        _local_set(key, value)


def test_connection():
    if not _use_supabase():
        return True, "local mode (no SUPABASE_URL/KEY set)"
    try:
        _get_client().table("kv_store").select("key").limit(1).execute()
        return True, "connected to Supabase"
    except Exception as e:
        return False, str(e)

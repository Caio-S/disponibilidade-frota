"""
Persistent key-value store backed by PostgreSQL (production)
or a local JSON file (development, when DATABASE_URL is not set).
"""
import os
import json
import logging

log = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL")
_LOCAL_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "kv_store.json")


# ── Local fallback (development) ──────────────────────────────────────────────
def _local_load():
    if os.path.exists(_LOCAL_FILE):
        with open(_LOCAL_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}

def _local_save(store):
    with open(_LOCAL_FILE, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)

def _local_get(key, default=None):
    return _local_load().get(key, default)

def _local_set(key, value):
    store = _local_load()
    store[key] = value
    _local_save(store)


# ── PostgreSQL (production) ───────────────────────────────────────────────────
def _fix_url(url):
    """psycopg2 requires postgresql:// not postgres://"""
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url

def _pg_conn():
    import psycopg2
    return psycopg2.connect(
        _fix_url(DATABASE_URL),
        sslmode="require",
        connect_timeout=15,
    )

_pg_ready = False

def _pg_init():
    global _pg_ready
    with _pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS kv_store (
                    key        TEXT PRIMARY KEY,
                    value      TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
        conn.commit()
    _pg_ready = True
    log.info("kv_store table ready")

def _ensure_pg():
    if not _pg_ready:
        _pg_init()

def _pg_get(key, default=None):
    _ensure_pg()
    with _pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM kv_store WHERE key = %s", (key,))
            row = cur.fetchone()
    return json.loads(row[0]) if row else default

def _pg_set(key, value):
    _ensure_pg()
    with _pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO kv_store (key, value, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (key)
                DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            """, (key, json.dumps(value, ensure_ascii=False)))
        conn.commit()


# ── Public API ────────────────────────────────────────────────────────────────
def kv_get(key, default=None):
    if DATABASE_URL:
        return _pg_get(key, default)
    return _local_get(key, default)

def kv_set(key, value):
    if DATABASE_URL:
        _pg_set(key, value)
    else:
        _local_set(key, value)

def test_connection():
    """Returns (ok: bool, message: str)"""
    if not DATABASE_URL:
        return True, "local mode (no DATABASE_URL)"
    try:
        _pg_init()
        return True, "connected to PostgreSQL"
    except Exception as e:
        return False, str(e)

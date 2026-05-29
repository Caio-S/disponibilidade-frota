import os
import json
import logging
from flask import Flask, render_template, jsonify, request
from werkzeug.utils import secure_filename
from parser_xlsx import parse_report, parse_catalog, build_grouped
from database import kv_get, kv_set

app = Flask(__name__)

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(BASE_DIR, "data")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

os.makedirs(UPLOAD_DIR, exist_ok=True)

app.config["UPLOAD_FOLDER"]      = UPLOAD_DIR
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

DEFAULT_CSV  = os.path.join(DATA_DIR, "frota base.csv")
DEFAULT_XLSX = os.path.join(DATA_DIR, "mes.xlsx")

# Runtime cache so we don't re-parse on every request
_catalog_cache = None
_period_cache  = {}   # {period_key: data_dict}


# ── Catalog ───────────────────────────────────────────────────────────────────
def get_catalog():
    global _catalog_cache
    if _catalog_cache is None:
        _catalog_cache = parse_catalog(DEFAULT_CSV)
    return _catalog_cache


# ── Period helpers ────────────────────────────────────────────────────────────
def _build_period_dict(report, catalog):
    grouped = build_grouped(catalog, report)
    return {
        "periodo_inicio":          grouped["periodo_inicio"],
        "periodo_fim":             grouped["periodo_fim"],
        "overall_disponibilidade": grouped["overall_disponibilidade"],
        "cliente":                 report["cliente"],
        "groups":                  grouped["groups"],
        "vehicles":                grouped["vehicles"],
    }


def load_period(xlsx_path, period_key):
    """Parse xlsx, persist to DB, update runtime cache."""
    report  = parse_report(xlsx_path)
    catalog = get_catalog()
    data    = _build_period_dict(report, catalog)
    kv_set(f"period_{period_key}", data)
    _period_cache[period_key] = data
    return data


def get_all_periods():
    """Return all periods from runtime cache, falling back to DB."""
    result = {}
    for key in ("dia", "semana", "mes", "acumulado"):
        if key in _period_cache:
            result[key] = _period_cache[key]
            continue
        stored = kv_get(f"period_{key}")
        if stored:
            _period_cache[key] = stored
            result[key] = stored
    return result


def _bootstrap():
    """On first start, load default xlsx if no period data in DB yet."""
    if not kv_get("period_mes") and os.path.exists(DEFAULT_XLSX):
        load_period(DEFAULT_XLSX, "mes")


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/grouped")
def api_grouped():
    _bootstrap()
    return jsonify(get_all_periods())


@app.route("/api/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "Nenhum arquivo enviado"}), 400
    f      = request.files["file"]
    period = request.form.get("period", "").lower()
    if period not in ("dia", "semana", "mes", "acumulado"):
        return jsonify({"error": "period inválido"}), 400
    if not f.filename.endswith(".xlsx"):
        return jsonify({"error": "Apenas .xlsx são suportados"}), 400

    dest = os.path.join(UPLOAD_DIR, secure_filename(f.filename))
    f.save(dest)
    try:
        data = load_period(dest, period)
        return jsonify({
            "period":         period,
            "periodo_inicio": data["periodo_inicio"],
            "periodo_fim":    data["periodo_fim"],
            "overall_disponibilidade": data["overall_disponibilidade"],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/activities", methods=["GET"])
def get_activities():
    return jsonify(kv_get("activities", []))


@app.route("/api/activities", methods=["POST"])
def save_activities():
    data = request.get_json(force=True)
    if not isinstance(data, list):
        return jsonify({"error": "Payload deve ser uma lista"}), 400
    kv_set("activities", data)
    return jsonify({"ok": True, "count": len(data)})


@app.route("/api/catalog")
def api_catalog():
    cat   = get_catalog()
    items = [{"frota": k, **v} for k, v in sorted(cat.items())]
    return jsonify(items)


@app.route("/api/health")
def health():
    from database import DATABASE_URL, test_connection
    db_ok, db_msg = test_connection()
    periods = []
    try:
        periods = list(get_all_periods().keys())
    except Exception as e:
        db_msg = str(e)
    return jsonify({
        "ok":             db_ok,
        "db":             "postgres" if DATABASE_URL else "local",
        "db_message":     db_msg,
        "periods_loaded": periods,
    })


@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    log = app.logger
    log.error(traceback.format_exc())
    return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(host="0.0.0.0", port=port, debug=debug)

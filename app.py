import os
import json
from flask import Flask, render_template, jsonify, request
from werkzeug.utils import secure_filename
from parser_xlsx import parse_report, parse_catalog, build_grouped

app = Flask(__name__)

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(BASE_DIR, "data")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

app.config["UPLOAD_FOLDER"]      = UPLOAD_DIR
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

# Default data files (committed to the repo)
DEFAULT_CSV  = os.path.join(DATA_DIR, "frota base.csv")
DEFAULT_XLSX = os.path.join(DATA_DIR, "mes.xlsx")        # rename in data/
ACTIVITIES_FILE = os.path.join(DATA_DIR, "activities.json")

# In-memory: period_key → {"grouped": ..., "report": ...}
_catalog_cache = None
_period_data   = {}


# ── Catalog ───────────────────────────────────────────────────────────────────
def get_catalog():
    global _catalog_cache
    if _catalog_cache is None:
        _catalog_cache = parse_catalog(DEFAULT_CSV)
    return _catalog_cache


# ── Period loading ────────────────────────────────────────────────────────────
def load_period(xlsx_path, period_key):
    report  = parse_report(xlsx_path)
    catalog = get_catalog()
    grouped = build_grouped(catalog, report)
    entry   = {"grouped": grouped, "report": report}
    _period_data[period_key] = entry
    return entry


def _try_load_default():
    """Load default xlsx into 'mes' on first request if no data yet."""
    if os.path.exists(DEFAULT_XLSX):
        load_period(DEFAULT_XLSX, "mes")


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/grouped")
def api_grouped():
    if not _period_data:
        try:
            _try_load_default()
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    response = {}
    for key, val in _period_data.items():
        g = val["grouped"]
        r = val["report"]
        response[key] = {
            "periodo_inicio": g["periodo_inicio"],
            "periodo_fim":    g["periodo_fim"],
            "overall_disponibilidade": g["overall_disponibilidade"],
            "cliente":  r["cliente"],
            "groups":   g["groups"],
            "vehicles": g["vehicles"],
        }
    return jsonify(response)


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
        g    = data["grouped"]
        return jsonify({
            "period":         period,
            "periodo_inicio": g["periodo_inicio"],
            "periodo_fim":    g["periodo_fim"],
            "overall_disponibilidade": g["overall_disponibilidade"],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/activities", methods=["GET"])
def get_activities():
    if os.path.exists(ACTIVITIES_FILE):
        with open(ACTIVITIES_FILE, encoding="utf-8") as f:
            return jsonify(json.load(f))
    return jsonify([])


@app.route("/api/activities", methods=["POST"])
def save_activities():
    data = request.get_json(force=True)
    if not isinstance(data, list):
        return jsonify({"error": "Payload deve ser uma lista"}), 400
    with open(ACTIVITIES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return jsonify({"ok": True, "count": len(data)})


@app.route("/api/catalog")
def api_catalog():
    cat   = get_catalog()
    items = [{"frota": k, **v} for k, v in sorted(cat.items())]
    return jsonify(items)


if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(host="0.0.0.0", port=port, debug=debug)

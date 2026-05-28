import csv
from datetime import datetime, timedelta
from openpyxl import load_workbook


def excel_serial_to_date(serial):
    if serial is None:
        return None
    if isinstance(serial, datetime):
        return serial.strftime("%d/%m/%Y")
    try:
        return (datetime(1899, 12, 30) + timedelta(days=int(serial))).strftime("%d/%m/%Y")
    except Exception:
        return str(serial)


def safe_float(v, decimals=2):
    if v is None:
        return None
    try:
        return round(float(str(v).strip()), decimals)
    except (ValueError, TypeError):
        return None


def parse_hours(value):
    if value is None:
        return None
    s = str(value).strip()
    if not s or ":" not in s:
        return None
    try:
        parts = s.split(":")
        return round(int(parts[0].strip()) + int(parts[1].strip()) / 60, 4)
    except Exception:
        return None


def parse_catalog(filepath):
    """Read the fleet catalog CSV → {frota_int: {atividade, especialidade}}."""
    catalog = {}
    with open(filepath, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            try:
                frota = int(str(row.get("CodFrota", "")).strip())
            except ValueError:
                continue
            desc = str(row.get("descricao_especialidade", "")).strip()
            if " - " in desc:
                atividade, especialidade = desc.split(" - ", 1)
            else:
                atividade, especialidade = desc, ""
            catalog[frota] = {
                "atividade": atividade.strip(),
                "especialidade": especialidade.strip(),
                "descricao_especialidade": desc,
            }
    return catalog


def parse_report(filepath):
    wb = load_workbook(filepath, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    client = str(rows[0][1]).strip() if rows[0][1] else ""
    period_start = excel_serial_to_date(rows[2][1])
    period_end = excel_serial_to_date(rows[2][3])

    vehicles = []
    for row in rows[4:]:
        frota = row[0]
        desc = row[1]
        if frota is None or str(frota).strip() == "":
            break

        vehicles.append({
            "frota": int(frota),
            "descricao": str(desc).strip() if desc else "",
            "horas_periodo": parse_hours(row[2]),
            "horas_oficina": parse_hours(row[3]),
            "horas_apontadas": parse_hours(row[4]),
            "horas_disponiveis": parse_hours(row[5]),
            "disponibilidade": safe_float(row[6], 4),
            "horas_improdutivas": parse_hours(row[8]),
            "qtde_corretivas": int(row[9]) if row[9] is not None else 0,
            "mtbf_h": parse_hours(row[10]),
            "mtbf_dias": safe_float(row[11]),
            "mttr_h": parse_hours(row[12]),
            "mttr_dias": safe_float(row[13]),
        })

    with_disp = [v for v in vehicles if v["disponibilidade"] is not None]
    with_mtbf = [v for v in vehicles if v["mtbf_h"] is not None]
    with_mttr = [v for v in vehicles if v["mttr_h"] is not None]

    avg_disp = round(sum(v["disponibilidade"] for v in with_disp) / len(with_disp), 2) if with_disp else 0
    avg_mtbf = round(sum(v["mtbf_h"] for v in with_mtbf) / len(with_mtbf), 2) if with_mtbf else 0
    avg_mttr = round(sum(v["mttr_h"] for v in with_mttr) / len(with_mttr), 2) if with_mttr else 0

    return {
        "cliente": client,
        "periodo_inicio": period_start,
        "periodo_fim": period_end,
        "total_veiculos": len(vehicles),
        "summary": {
            "avg_disponibilidade": avg_disp,
            "avg_mtbf_h": avg_mtbf,
            "avg_mttr_h": avg_mttr,
            "total_corretivas": sum(v["qtde_corretivas"] for v in vehicles),
            "acima_95pct": sum(1 for v in with_disp if v["disponibilidade"] >= 95),
            "abaixo_90pct": sum(1 for v in with_disp if v["disponibilidade"] < 90),
            "com_mtbf": len(with_mtbf),
            "com_mttr": len(with_mttr),
        },
        "vehicles": vehicles,
    }


def build_grouped(catalog, report):
    """
    Merge catalog + report metrics, returning vehicles enriched with
    atividade/especialidade, plus an aggregate summary per specialty group.
    """
    metrics_map = {v["frota"]: v for v in report["vehicles"]}

    enriched = []
    for frota, cat in catalog.items():
        m = metrics_map.get(frota, {})
        enriched.append({
            "frota": frota,
            "atividade": cat["atividade"],
            "especialidade": cat["especialidade"],
            "descricao_especialidade": cat["descricao_especialidade"],
            "descricao": m.get("descricao", ""),
            "disponibilidade": m.get("disponibilidade"),
            "horas_periodo": m.get("horas_periodo"),
            "horas_oficina": m.get("horas_oficina"),
            "horas_improdutivas": m.get("horas_improdutivas"),
            "qtde_corretivas": m.get("qtde_corretivas", 0),
            "mtbf_h": m.get("mtbf_h"),
            "mttr_h": m.get("mttr_h"),
            "in_report": frota in metrics_map,
        })

    # Aggregate by specialty group
    groups = {}
    for v in enriched:
        key = v["descricao_especialidade"]
        if key not in groups:
            groups[key] = {
                "atividade": v["atividade"],
                "especialidade": v["especialidade"],
                "descricao_especialidade": key,
                "frotas": [],
            }
        groups[key]["frotas"].append(v)

    # Compute group-level averages
    group_list = []
    for g in groups.values():
        frotas_with_disp = [f for f in g["frotas"] if f["disponibilidade"] is not None]
        frotas_with_mtbf = [f for f in g["frotas"] if f["mtbf_h"] is not None]
        frotas_with_mttr = [f for f in g["frotas"] if f["mttr_h"] is not None]

        g["total_frotas"] = len(g["frotas"])
        g["frotas_no_report"] = sum(1 for f in g["frotas"] if f["in_report"])
        g["avg_disponibilidade"] = (
            round(sum(f["disponibilidade"] for f in frotas_with_disp) / len(frotas_with_disp), 2)
            if frotas_with_disp else None
        )
        g["avg_mtbf_h"] = (
            round(sum(f["mtbf_h"] for f in frotas_with_mtbf) / len(frotas_with_mtbf), 2)
            if frotas_with_mtbf else None
        )
        g["avg_mttr_h"] = (
            round(sum(f["mttr_h"] for f in frotas_with_mttr) / len(frotas_with_mttr), 2)
            if frotas_with_mttr else None
        )
        g["total_corretivas"] = sum(f["qtde_corretivas"] for f in g["frotas"])
        group_list.append(g)

    # Sort by atividade then especialidade
    group_list.sort(key=lambda g: (g["atividade"], g["especialidade"]))

    # Overall availability for this period (from enriched vehicles that have data)
    all_with_disp = [v for v in enriched if v["disponibilidade"] is not None]
    overall_disp = (
        round(sum(v["disponibilidade"] for v in all_with_disp) / len(all_with_disp), 2)
        if all_with_disp else None
    )

    return {
        "periodo_inicio": report["periodo_inicio"],
        "periodo_fim": report["periodo_fim"],
        "overall_disponibilidade": overall_disp,
        "groups": group_list,
        "vehicles": enriched,
    }

"""
Execute este script localmente sempre que adicionar/atualizar um xlsx em data/.
Ele converte os xlsx em JSON que são commitados no git e carregados em produção.

Uso:
    python generate_data.py
"""
import json, os
from parser_xlsx import parse_report, parse_catalog, build_grouped

BASE  = os.path.dirname(os.path.abspath(__file__))
DATA  = os.path.join(BASE, "data")
CSV   = os.path.join(DATA, "frota base.csv")

print("Lendo catálogo...")
catalog = parse_catalog(CSV)
print(f"  {len(catalog)} frotas")

PERIODS = ["dia", "semana", "mes", "acumulado"]

for period in PERIODS:
    xlsx = os.path.join(DATA, f"{period}.xlsx")
    out  = os.path.join(DATA, f"{period}.json")

    if not os.path.exists(xlsx):
        print(f"  [{period}] sem arquivo xlsx — pulando")
        continue

    print(f"  [{period}] processando {os.path.basename(xlsx)}...")
    report  = parse_report(xlsx)
    grouped = build_grouped(catalog, report)

    payload = {
        "periodo_inicio":          grouped["periodo_inicio"],
        "periodo_fim":             grouped["periodo_fim"],
        "overall_disponibilidade": grouped["overall_disponibilidade"],
        "cliente":                 report["cliente"],
        "groups":                  grouped["groups"],
        "vehicles":                grouped["vehicles"],
    }

    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    kb = os.path.getsize(out) / 1024
    print(f"  [{period}] ✓  {out}  ({kb:.0f} KB, {len(grouped['vehicles'])} veículos)")

print("\nPronto! Commit os arquivos JSON gerados em data/.")

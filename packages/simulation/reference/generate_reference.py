#!/usr/bin/env python3
"""Casos de referência de SAC e Price, calculados À PARTE do motor TypeScript.

Implementação independente (outra linguagem, aritmética decimal com 50 dígitos), feita a
partir das fórmulas do spec §4.4, para servir de "planilha de referência" até o financeiro
fornecer a dele. Gera:

  - ../test/fixtures/reference-cases.json  (lido pelos testes do motor)
  - reference-cases.csv                    (para abrir no Excel/LibreOffice e conferir)

Uso: python3 -I packages/simulation/reference/generate_reference.py
Regras de arredondamento (iguais às do motor): cálculo sem arredondar; saída arredondada
a centavos, meio para cima (ROUND_HALF_UP); teto de financiamento truncado (ROUND_FLOOR).
"""

import csv
import json
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal, getcontext
from pathlib import Path

getcontext().prec = 50
CENT = Decimal("0.01")
HERE = Path(__file__).resolve().parent


def d(x):
    return Decimal(str(x))


def cents(x):
    # Limpa o ruído da 50ª casa antes de arredondar: um meio-centavo exato (ex.: MIP de
    # 630/240 = 2,625) não pode virar 2,62 por causa de 2,62499…9.
    clean = x.quantize(Decimal("1e-12"), rounding=ROUND_HALF_UP)
    return float(clean.quantize(CENT, rounding=ROUND_HALF_UP))


def monthly_rate(annual, convention):
    annual = d(annual)
    if convention == "NOMINAL":
        return annual / 12
    return (1 + annual) ** (Decimal(1) / 12) - 1


def price_factor(i, n):
    if i == 0:
        return Decimal(1) / n
    g = (1 + i) ** n
    return i * g / (g - 1)


def schedule(system, pv, i, n, mip_rate, dfi, fees):
    pv, mip_rate, dfi, fees = d(pv), d(mip_rate), d(dfi), d(fees)
    pmt = price_factor(i, n) * pv
    amort_sac = pv / n
    balance = pv
    rows = []
    tot = {"paid": Decimal(0), "amortization": Decimal(0), "interest": Decimal(0), "insurance": Decimal(0), "fees": Decimal(0)}
    for k in range(1, n + 1):
        interest = balance * i
        if k == n:
            amort = balance
        elif system == "SAC":
            amort = amort_sac
        else:
            amort = pmt - interest
        mip = balance * mip_rate
        total = amort + interest + mip + dfi + fees
        balance -= amort
        tot["paid"] += total
        tot["amortization"] += amort
        tot["interest"] += interest
        tot["insurance"] += mip + dfi
        tot["fees"] += fees
        rows.append({"amortization": amort, "interest": interest, "mip": mip, "dfi": dfi, "fees": fees, "total": total})
    return rows, tot


def max_principal(system, max_installment, i, n, mip_rate, dfi, fees):
    available = d(max_installment) - d(dfi) - d(fees)
    if available <= 0:
        return 0.0
    factor = (price_factor(i, n) if system == "PRICE" else Decimal(1) / n + i) + d(mip_rate)
    # Remove o ruído da divisão (ex.: 1/60 arredondado) antes de truncar; senão um teto
    # exato como 60.000,00 viraria 59.999,99.
    clean = (available / factor).quantize(Decimal("1e-12"), rounding=ROUND_HALF_UP)
    return float(clean.quantize(CENT, rounding=ROUND_FLOOR))


def row_out(r):
    return {k: cents(v) for k, v in r.items()}


# (id, descrição, sistema, valor financiado, taxa anual, convenção, prazo, MIP mensal, DFI mensal R$, taxas R$, parcela máx.)
CASES = [
    ("price-livro-100k-1pct-12", "Price clássico de livro: 100.000 a 1% a.m. por 12 meses", "PRICE", 100000, 0.12, "NOMINAL", 12, 0, 0, 0, 8884.88),
    ("sac-livro-120k-1pct-12", "SAC clássico de livro: 120.000 a 1% a.m. por 12 meses", "SAC", 120000, 0.12, "NOMINAL", 12, 0, 0, 0, 11200),
    ("price-taxa-zero", "Price com taxa zero (parcela = PV/n)", "PRICE", 60000, 0, "NOMINAL", 60, 0, 0, 0, 1000),
    ("sac-taxa-zero", "SAC com taxa zero", "SAC", 60000, 0, "NOMINAL", 60, 0, 0, 0, 1000),
    ("price-sbpe-300k-360", "Price SBPE 300.000, 11,49% a.a. efetiva, 360 meses, com seguros e taxa", "PRICE", 300000, 0.1149, "EFFECTIVE", 360, 0.00014, 24.50, 25, 3200),
    ("sac-sbpe-300k-360", "SAC SBPE 300.000, 11,49% a.a. efetiva, 360 meses, com seguros e taxa", "SAC", 300000, 0.1149, "EFFECTIVE", 360, 0.00014, 24.50, 25, 3200),
    ("sac-sbpe-250k-420", "SAC 250.000, 10,5% a.a. nominal, 420 meses, com seguros e taxa", "SAC", 250000, 0.105, "NOMINAL", 420, 0.00028, 21.00, 25, 2600),
    ("price-sbpe-250k-420", "Price 250.000, 10,5% a.a. nominal, 420 meses, com seguros e taxa", "PRICE", 250000, 0.105, "NOMINAL", 420, 0.00028, 21.00, 25, 2600),
    ("price-habitacional-180k-360", "Price programa habitacional 180.000, 5% a.a. nominal, 360 meses", "PRICE", 180000, 0.05, "NOMINAL", 360, 0.000098, 15.40, 25, 1410),
    ("sac-habitacional-180k-360", "SAC programa habitacional 180.000, 5% a.a. nominal, 360 meses", "SAC", 180000, 0.05, "NOMINAL", 360, 0.000098, 15.40, 25, 1410),
    ("sac-alto-1m-240", "SAC 1.000.000, 12% a.a. efetiva, 240 meses, MIP faixa 50-60", "SAC", 1000000, 0.12, "EFFECTIVE", 240, 0.00063, 87.50, 25, 15000),
    ("price-alto-1m-240", "Price 1.000.000, 12% a.a. efetiva, 240 meses, MIP faixa 50-60", "PRICE", 1000000, 0.12, "EFFECTIVE", 240, 0.00063, 87.50, 25, 12000),
    ("price-curto-50k-60", "Price 50.000, 7,66% a.a. nominal, 60 meses", "PRICE", 50000, 0.0766, "NOMINAL", 60, 0.0013, 7.00, 25, 1100),
    ("sac-curto-50k-60", "SAC 50.000, 7,66% a.a. nominal, 60 meses", "SAC", 50000, 0.0766, "NOMINAL", 60, 0.0013, 7.00, 25, 1100),
    ("sac-fracao-centavos", "SAC com valor quebrado 187.654,32, 9,37% a.a. efetiva, 337 meses", "SAC", 187654.32, 0.0937, "EFFECTIVE", 337, 0.000177, 13.37, 31.9, 2222.22),
    ("price-fracao-centavos", "Price com valor quebrado 187.654,32, 9,37% a.a. efetiva, 337 meses", "PRICE", 187654.32, 0.0937, "EFFECTIVE", 337, 0.000177, 13.37, 31.9, 2222.22),
]


def build():
    out = []
    for (cid, desc, system, pv, annual, conv, n, mip, dfi, fees, max_inst) in CASES:
        i = monthly_rate(annual, conv)
        rows, tot = schedule(system, pv, i, n, mip, dfi, fees)
        out.append({
            "id": cid,
            "description": desc,
            "system": system,
            "principal": pv,
            "annualRate": annual,
            "rateConvention": conv,
            "termMonths": n,
            "charges": {"mipMonthlyRate": mip, "dfiMonthly": dfi, "feesMonthly": fees},
            "maxInstallment": max_inst,
            "expected": {
                "monthlyRate": float(i),
                "first": row_out(rows[0]),
                "last": row_out(rows[-1]),
                "totals": {k: cents(v) for k, v in tot.items()},
                "maxPrincipal": max_principal(system, max_inst, i, n, mip, dfi, fees),
            },
        })
    return out


def self_check(cases):
    by_id = {c["id"]: c for c in cases}
    # Valores conhecidos de livro-texto (conferíveis à mão / em qualquer calculadora financeira).
    assert by_id["price-livro-100k-1pct-12"]["expected"]["first"]["total"] == 8884.88
    sac = by_id["sac-livro-120k-1pct-12"]["expected"]
    assert sac["first"]["total"] == 11200.00 and sac["last"]["total"] == 10100.00
    assert sac["totals"]["interest"] == 7800.00
    # MIP da última parcela = 0,00063 × 1.000.000/240 = 2,625 exatos → 2,63
    assert by_id["sac-alto-1m-240"]["expected"]["last"]["mip"] == 2.63
    assert by_id["price-taxa-zero"]["expected"]["first"]["total"] == 1000.00
    assert by_id["price-taxa-zero"]["expected"]["maxPrincipal"] == 60000.00


def main():
    cases = build()
    self_check(cases)
    fixture = {
        "source": "packages/simulation/reference/generate_reference.py (Python decimal, independente do motor)",
        "status": "REFERENCIA_INTERNA",
        "note": "Substituir/complementar com a planilha do financeiro (spec §13).",
        "cases": cases,
    }
    (HERE.parent / "test" / "fixtures" / "reference-cases.json").write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with open(HERE / "reference-cases.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id", "sistema", "valor_financiado", "taxa_anual", "convencao", "prazo_meses",
                    "taxa_mensal", "mip_mensal", "dfi_mensal", "taxas_mensais",
                    "p1_amortizacao", "p1_juros", "p1_mip", "p1_total",
                    "ultima_amortizacao", "ultima_juros", "ultima_total",
                    "total_pago", "total_juros", "total_seguros", "total_taxas",
                    "parcela_max", "valor_max_financiavel", "descricao"])
        for c in cases:
            e = c["expected"]
            w.writerow([c["id"], c["system"], c["principal"], c["annualRate"], c["rateConvention"], c["termMonths"],
                        f'{e["monthlyRate"]:.12f}', c["charges"]["mipMonthlyRate"], c["charges"]["dfiMonthly"], c["charges"]["feesMonthly"],
                        e["first"]["amortization"], e["first"]["interest"], e["first"]["mip"], e["first"]["total"],
                        e["last"]["amortization"], e["last"]["interest"], e["last"]["total"],
                        e["totals"]["paid"], e["totals"]["interest"], e["totals"]["insurance"], e["totals"]["fees"],
                        c["maxInstallment"], e["maxPrincipal"], c["description"]])
    print(f"{len(cases)} casos gerados")


if __name__ == "__main__":
    main()

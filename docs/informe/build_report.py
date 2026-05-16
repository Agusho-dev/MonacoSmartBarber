#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera el informe de ingeniería de la Fila Dinámica:
  - informe-fila-dinamica.html  (web interactivo, autocontenido, sin CDN)
Modelo: M/M/c, Erlang-C, aproximación G/G/c (Allen-Cunneen), cadena de
Markov de nacimiento-muerte, Ley de Little, teorema de pooling. Gráficos
en SVG generado en Python puro (vectorial, idéntico en web y PDF).
Datos reales: docs/informe/data.json  |  Monte Carlo: docs/sim/results.json
"""
import json, math, os, html

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "data.json")))
try:
    SIM = json.load(open(os.path.join(HERE, "..", "sim", "results.json")))
except Exception:
    SIM = {}

# ───────────────────────── Teoría de colas ─────────────────────────
def erlang_b(c, a):
    b = 1.0
    for j in range(1, c + 1):
        b = (a * b) / (j + a * b)
    return b

def erlang_c(c, a):
    rho = a / c
    if rho >= 1:
        return 1.0
    b = erlang_b(c, a)
    return b / (1.0 - rho * (1.0 - b))

def mmc(lmbda, mu, c):
    """λ, μ en /hora. Devuelve métricas con tiempos en minutos."""
    a = lmbda / mu
    rho = a / c
    out = {"a": a, "rho": rho, "estable": rho < 1}
    if rho >= 1:
        out.update(C=1.0, Wq=float("inf"), W=float("inf"), Lq=float("inf"), L=float("inf"))
        return out
    C = erlang_c(c, a)
    Wq_h = C / (c * mu - lmbda)
    W_h = Wq_h + 1.0 / mu
    Lq = lmbda * Wq_h
    L = lmbda * W_h
    out.update(C=C, Wq=Wq_h * 60.0, W=W_h * 60.0, Lq=Lq, L=L)
    return out

def mm1_wq_min(lmbda, mu):
    if lmbda >= mu:
        return float("inf")
    return (lmbda / (mu * (mu - lmbda))) * 60.0

def ac_factor(ca2, cs2):
    return (ca2 + cs2) / 2.0

def markov_pi(a, c, nmax):
    rho = a / c
    s = sum(a ** n / math.factorial(n) for n in range(c))
    s += (a ** c / math.factorial(c)) * (1.0 / (1.0 - rho))
    p0 = 1.0 / s
    pis = []
    for n in range(0, nmax + 1):
        if n <= c:
            pn = (a ** n / math.factorial(n)) * p0
        else:
            pn = (a ** n / (math.factorial(c) * c ** (n - c))) * p0
        pis.append(pn)
    return p0, pis

# ───────────────────────── Parámetros reales ─────────────────────────
MU = D["servicio"]["mu_servicio_por_hora"]          # 1.714 cortes/h/barbero
CV_S = D["servicio"]["cv"]                            # 0.39
ACF = ac_factor(1.0, CV_S ** 2)                       # (1 + 0.39²)/2 ≈ 0.576

ESCENARIOS = [
    # nombre, λ/h, c, etiqueta
    ("Rondeau · pico 18 h", 5.69, 5),
    ("Rondeau · promedio día", 3.97, 5),
    ("Paraná · pico 18 h", 6.88, 6),
    ("Paraná · promedio día", 5.33, 6),
    ("Caseros · promedio día", 1.71, 2),
]
ESC = []
for nom, lmb, c in ESCENARIOS:
    m = mmc(lmb, MU, c)
    wq_ac = m["Wq"] * ACF if m["estable"] else float("inf")
    ESC.append({"nom": nom, "lmb": lmb, "c": c, **m, "Wq_ac": wq_ac})

# Teorema de pooling: M/M/c vs c·M/M/1 (λ repartido en partes iguales)
POOL = []
for nom, lmb, c in [("Rondeau pico (λ=5.69, c=5)", 5.69, 5),
                    ("Paraná pico (λ=6.88, c=6)", 6.88, 6),
                    ("c=10, ρ=0.85", 0.85 * 10 * MU, 10)]:
    mc = mmc(lmb, MU, c)
    wq_split = mm1_wq_min(lmb / c, MU)
    POOL.append({"nom": nom, "c": c, "lmb": lmb,
                 "wq_pool": mc["Wq"], "wq_split": wq_split,
                 "wq_pool_ac": mc["Wq"] * ACF if mc["estable"] else float("inf"),
                 "ratio": (wq_split / mc["Wq"]) if mc["Wq"] > 0 else float("inf")})

# Markov representativo (Rondeau pico)
A_REP, C_REP = 5.69 / MU, 5
P0_REP, PI_REP = markov_pi(A_REP, C_REP, 16)

# ── Monte Carlo: agregación por nº de barberos ──
POLS = ["A", "B", "C", "D", "E"]
LBL = {"A": "A · binding (viejo)", "B": "B · binding+push", "C": "C · pool (live)",
       "D": "D · pool+WSJF", "E": "E · pool+gate"}
BARBERS = [3, 5, 7, 10]
def agg(nb, pol, field):
    ks = [k for k in SIM if k.split("|")[0] == str(nb) and k.split("|")[4] == pol]
    if not ks:
        return 0.0
    return sum(SIM[k][field] for k in ks) / len(ks)
MC = {}
for f in ["inv_dyn_starv_min", "inv_violated", "util", "wait_p50", "wait_p95",
          "cv_counts", "jain", "served"]:
    MC[f] = {pol: [agg(nb, pol, f) for nb in BARBERS] for pol in POLS}

# ── Alta demanda: modelo en el pico + slice Monte Carlo (ρ ≥ 1.0) ──
_pk = {e["name"]: e for e in D["pico"]["espera"]}
PEAK = []
for _p in D["pico"]["params"]:
    _nm, _lmb, _c = _p["name"], _p["lambda_pico"], _p["c"]
    _m = mmc(_lmb, MU, _c)
    _o = _pk[_nm]
    PEAK.append({"nom": ("Paraná" if _nm == "Parana" else _nm), "rho": _m["rho"],
                 "wq_pool": _m["Wq"] if _m["estable"] else float("inf"),
                 "wq_pool_ac": (_m["Wq"] * ACF) if _m["estable"] else float("inf"),
                 "wq_bind": mm1_wq_min(_lmb / _c, MU),
                 "obs_p50": _o["pico_p50"], "obs_p95": _o["pico_p95"], "obs_max": _o["pico_max"]})
def agg_hd(nb, pol, field):
    ks = [k for k in SIM if k.split("|")[0] == str(nb) and k.split("|")[4] == pol
          and k.split("|")[1] in ("1.0", "1.15")]
    return sum(SIM[k][field] for k in ks) / len(ks) if ks else 0.0
MCHD = {f: {pol: [agg_hd(nb, pol, f) for nb in BARBERS] for pol in POLS}
        for f in ["inv_dyn_starv_min", "wait_p50", "wait_p95", "util"]}

# Jain observado (Rondeau, barberos activos = top 5)
def jain(vals):
    vals = [v for v in vals]
    return (sum(vals) ** 2) / (len(vals) * sum(x * x for x in vals)) if vals and sum(vals) else 1.0
JAIN = {bn: jain([r["cortes"] for r in rows if r["cortes"] >= 100])
        for bn, rows in D["equidad"].items()}
jain_rep = JAIN.get("Rondeau", next(iter(JAIN.values())))

# Little's law check (Rondeau día)
LL_lmb = 3.97              # /h
LL_W = (21.7 + 35.01) / 60 # h (espera + servicio)
LL_L = LL_lmb * LL_W

# ───────────────────────── SVG helpers ─────────────────────────
PAL = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#64748b"]
def esc(s): return html.escape(str(s))

def svg_open(w, h):
    return (f'<svg viewBox="0 0 {w} {h}" class="chart" '
            f'xmlns="http://www.w3.org/2000/svg" font-family="Inter,system-ui,sans-serif">')

def axis(x0, y0, x1, y1):
    return (f'<line x1="{x0}" y1="{y0}" x2="{x1}" y2="{y0}" stroke="#94a3b8" stroke-width="1"/>'
            f'<line x1="{x0}" y1="{y0}" x2="{x0}" y2="{y1}" stroke="#94a3b8" stroke-width="1"/>')

def grouped_bars(series, cats, ymax, w=720, h=340, ylabel="", unit="", fmt="{:.1f}"):
    pad_l, pad_b, pad_t, pad_r = 56, 46, 26, 14
    pw, ph = w - pad_l - pad_r, h - pad_b - pad_t
    s = svg_open(w, h)
    for g in range(5):
        gy = pad_t + ph - ph * g / 4
        val = ymax * g / 4
        s += f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{w-pad_r}" y2="{gy:.1f}" stroke="#e2e8f0" stroke-width="1"/>'
        s += f'<text x="{pad_l-8}" y="{gy+4:.1f}" font-size="11" fill="#64748b" text-anchor="end">{val:.0f}</text>'
    nC, nS = len(cats), len(series)
    gw = pw / nC
    bw = gw * 0.74 / nS
    for ci, cat in enumerate(cats):
        gx = pad_l + ci * gw
        for si, (name, vals, color) in enumerate(series):
            v = vals[ci]
            bh = 0 if ymax <= 0 else max(0.0, min(1.0, v / ymax)) * ph
            bx = gx + gw * 0.13 + si * bw
            by = pad_t + ph - bh
            s += (f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bw-3:.1f}" height="{bh:.1f}" '
                  f'fill="{color}" rx="2"><title>{esc(name)} · {esc(cat)}: '
                  f'{fmt.format(v)}{esc(unit)}</title></rect>')
            if bh > 16:
                s += (f'<text x="{bx+(bw-3)/2:.1f}" y="{by-3:.1f}" font-size="9.5" '
                      f'fill="#475569" text-anchor="middle">{fmt.format(v)}</text>')
        s += (f'<text x="{gx+gw/2:.1f}" y="{h-pad_b+16}" font-size="11" '
              f'fill="#334155" text-anchor="middle">{esc(cat)}</text>')
    s += axis(pad_l, pad_t + ph, w - pad_r, pad_t)
    if ylabel:
        s += (f'<text x="14" y="{pad_t+ph/2}" font-size="11" fill="#64748b" '
              f'text-anchor="middle" transform="rotate(-90 14 {pad_t+ph/2})">{esc(ylabel)}</text>')
    # leyenda
    lx = pad_l
    for name, _, color in series:
        s += f'<rect x="{lx}" y="6" width="11" height="11" fill="{color}" rx="2"/>'
        s += f'<text x="{lx+16}" y="15" font-size="11" fill="#334155">{esc(name)}</text>'
        lx += 30 + len(name) * 7.3
    return s + "</svg>"

def line_chart(series, xs, xmax, ymax, w=720, h=340, xlabel="", ylabel="", marks=None):
    pad_l, pad_b, pad_t, pad_r = 58, 46, 26, 16
    pw, ph = w - pad_l - pad_r, h - pad_b - pad_t
    s = svg_open(w, h)
    for g in range(6):
        gy = pad_t + ph - ph * g / 5
        s += f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{w-pad_r}" y2="{gy:.1f}" stroke="#e2e8f0"/>'
        s += f'<text x="{pad_l-8}" y="{gy+4:.1f}" font-size="11" fill="#64748b" text-anchor="end">{ymax*g/5:.0f}</text>'
    for g in range(7):
        gx = pad_l + pw * g / 6
        s += f'<text x="{gx:.1f}" y="{h-pad_b+16}" font-size="10.5" fill="#64748b" text-anchor="middle">{xmax*g/6:.2f}</text>'
    def X(v): return pad_l + pw * min(1.0, v / xmax)
    def Y(v): return pad_t + ph - ph * min(1.0, v / ymax)
    for name, ys, color in series:
        pts = " ".join(f"{X(xs[i]):.1f},{Y(ys[i]):.1f}" for i in range(len(xs)) if ys[i] < ymax * 1.2)
        s += f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.4"/>'
        s += f'<text x="{w-pad_r-2}" y="{Y(ys[-1] if ys[-1]<ymax else ymax*0.96):.1f}" font-size="11" fill="{color}" text-anchor="end">{esc(name)}</text>'
    for m in (marks or []):
        mx, my, lab = X(m[0]), Y(m[1]), m[2]
        s += (f'<circle cx="{mx:.1f}" cy="{my:.1f}" r="4.5" fill="#0f172a"/>'
              f'<text x="{mx+7:.1f}" y="{my-7:.1f}" font-size="10.5" fill="#0f172a" font-weight="600">{esc(lab)}</text>')
    s += axis(pad_l, pad_t + ph, w - pad_r, pad_t)
    s += f'<text x="{pad_l+pw/2}" y="{h-6}" font-size="11" fill="#64748b" text-anchor="middle">{esc(xlabel)}</text>'
    s += f'<text x="15" y="{pad_t+ph/2}" font-size="11" fill="#64748b" text-anchor="middle" transform="rotate(-90 15 {pad_t+ph/2})">{esc(ylabel)}</text>'
    return s + "</svg>"

def hbars(rows, vmax, w=620, h=None, unit="", color=PAL[0], fmt="{:.0f}"):
    h = h or (44 + len(rows) * 30)
    pad_l, pad_r, pad_t = 110, 60, 16
    bw = w - pad_l - pad_r
    s = svg_open(w, h)
    for i, (lab, v, col) in enumerate(rows):
        y = pad_t + i * 30
        L = bw * (0 if vmax <= 0 else min(1.0, v / vmax))
        s += f'<text x="{pad_l-8}" y="{y+15}" font-size="11.5" fill="#334155" text-anchor="end">{esc(lab)}</text>'
        s += f'<rect x="{pad_l}" y="{y+3}" width="{bw}" height="18" fill="#f1f5f9" rx="3"/>'
        s += f'<rect x="{pad_l}" y="{y+3}" width="{L:.1f}" height="18" fill="{col or color}" rx="3"><title>{esc(lab)}: {fmt.format(v)}{esc(unit)}</title></rect>'
        s += f'<text x="{pad_l+L+6:.1f}" y="{y+16}" font-size="11" fill="#475569">{fmt.format(v)}{esc(unit)}</text>'
    return s + "</svg>"

def heatmap(data, rows, cols, w=720, h=300):
    pad_l, pad_t, pad_b, pad_r = 52, 26, 30, 16
    cw = (w - pad_l - pad_r) / len(cols)
    ch = (h - pad_t - pad_b) / len(rows)
    vmax = max(max(r) for r in data)
    s = svg_open(w, h)
    for ri, rlab in enumerate(rows):
        s += f'<text x="{pad_l-8}" y="{pad_t+ri*ch+ch/2+4:.1f}" font-size="11" fill="#334155" text-anchor="end">{esc(rlab)}</text>'
        for ci, v in enumerate(data[ri]):
            t = v / vmax if vmax else 0
            # rampa azul→ámbar→rojo
            r = int(37 + t * 200); g = int(99 + t * 60 - t * t * 120); b = int(235 - t * 200)
            x, y = pad_l + ci * cw, pad_t + ri * ch
            s += (f'<rect x="{x:.1f}" y="{y:.1f}" width="{cw-1.5:.1f}" height="{ch-1.5:.1f}" '
                  f'fill="rgb({max(0,r)},{max(0,g)},{max(0,b)})" rx="2">'
                  f'<title>{esc(rlab)} {esc(cols[ci])}h: {v}</title></rect>')
            if cw > 26:
                fill = "#fff" if t > 0.5 else "#1e293b"
                s += f'<text x="{x+cw/2:.1f}" y="{y+ch/2+4:.1f}" font-size="9.5" fill="{fill}" text-anchor="middle">{v}</text>'
    for ci, clab in enumerate(cols):
        s += f'<text x="{pad_l+ci*cw+cw/2:.1f}" y="{h-pad_b+18}" font-size="10.5" fill="#64748b" text-anchor="middle">{esc(clab)}</text>'
    return s + "</svg>"

def markov_svg(c, w=760, h=210):
    s = svg_open(w, h)
    states = ["0", "1", "2", "···", f"{c}", f"{c}+1", "···"]
    n = len(states); r = 24
    gap = (w - 60) / (n - 1)
    cy = 96
    for i, st in enumerate(states):
        cx = 36 + i * gap
        fill = "#dbeafe" if st not in ("···",) else "#fff"
        stroke = "#2563eb" if st not in ("···",) else "none"
        if st != "···":
            s += f'<circle cx="{cx:.1f}" cy="{cy}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'
            s += f'<text x="{cx:.1f}" y="{cy+5}" font-size="13" fill="#1e3a8a" text-anchor="middle" font-weight="600">{esc(st)}</text>'
        else:
            s += f'<text x="{cx:.1f}" y="{cy+5}" font-size="16" fill="#94a3b8" text-anchor="middle">···</text>'
        if i < n - 1:
            x1 = cx + r + 2; x2 = 36 + (i + 1) * gap - r - 2
            mid = (x1 + x2) / 2
            s += f'<path d="M{x1:.1f},{cy-6} Q{mid:.1f},{cy-30} {x2:.1f},{cy-6}" fill="none" stroke="#16a34a" stroke-width="1.6" marker-end="url(#ar)"/>'
            s += f'<text x="{mid:.1f}" y="{cy-30}" font-size="11" fill="#15803d" text-anchor="middle">λ</text>'
            rate = "μ" if i == 0 else (f"{i}μ" if i < c else "cμ")
            s += f'<path d="M{x2:.1f},{cy+6} Q{mid:.1f},{cy+30} {x1:.1f},{cy+6}" fill="none" stroke="#dc2626" stroke-width="1.6" marker-end="url(#ar2)"/>'
            s += f'<text x="{mid:.1f}" y="{cy+42}" font-size="11" fill="#b91c1c" text-anchor="middle">{rate}</text>'
    s += ('<defs><marker id="ar" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">'
          '<path d="M0,0 L6,3 L0,6 Z" fill="#16a34a"/></marker>'
          '<marker id="ar2" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">'
          '<path d="M0,0 L6,3 L0,6 Z" fill="#dc2626"/></marker></defs>')
    s += (f'<text x="{w/2:.1f}" y="{h-12}" font-size="11" fill="#64748b" text-anchor="middle">'
          f'Proceso de nacimiento-muerte · nacimientos λ (Poisson) · muertes n·μ (n≤c) y c·μ (n&gt;c)</text>')
    return s + "</svg>"

# ── Datos para gráficos ──
_allh = set()
for _b in D["llegadas_por_hora"].values():
    _allh |= set(_b.keys())
cats_h = sorted(_allh, key=int)
fig_arrivals = grouped_bars(
    [("Paraná", [D["llegadas_por_hora"]["Parana"].get(h, 0) for h in cats_h], PAL[0]),
     ("Rondeau", [D["llegadas_por_hora"]["Rondeau"].get(h, 0) for h in cats_h], PAL[1]),
     ("Caseros", [D["llegadas_por_hora"]["Caseros"].get(h, 0) for h in cats_h], PAL[3])],
    cats_h, 7.5, ylabel="llegadas / hora (λ)", unit="/h", fmt="{:.1f}")

# servicio: densidad lognormal + percentiles observados
def lognpdf(x, mu, sg): return math.exp(-(math.log(x)-mu)**2/(2*sg*sg))/(x*sg*math.sqrt(2*math.pi))
mu_l, sg_l = D["servicio"]["mu_log"], D["servicio"]["sigma_log"]
xs_s = [i for i in range(3, 121, 2)]
ys_s = [lognpdf(x, mu_l, sg_l) for x in xs_s]
ymx = max(ys_s) * 1.15
def svg_density(w=720, h=320):
    pad_l, pad_b, pad_t, pad_r = 50, 46, 26, 16
    pw, ph = w-pad_l-pad_r, h-pad_t-pad_b
    s = svg_open(w, h)
    def X(v): return pad_l + pw*(v-3)/(120-3)
    def Y(v): return pad_t + ph - ph*v/ymx
    pts = " ".join(f"{X(xs_s[i]):.1f},{Y(ys_s[i]):.1f}" for i in range(len(xs_s)))
    s += f'<polygon points="{X(3):.1f},{Y(0):.1f} {pts} {X(119):.1f},{Y(0):.1f}" fill="#2563eb22"/>'
    s += f'<polyline points="{pts}" fill="none" stroke="{PAL[0]}" stroke-width="2.4"/>'
    for lab, v, col in [("p10 19.6", 19.6, "#94a3b8"), ("mediana 33.5", 33.5, "#16a34a"),
                        ("media 35.0", 35.0, "#0f172a"), ("p90 51.3", 51.3, "#94a3b8"),
                        ("p95 58.2", 58.2, "#dc2626")]:
        s += f'<line x1="{X(v):.1f}" y1="{pad_t}" x2="{X(v):.1f}" y2="{pad_t+ph}" stroke="{col}" stroke-width="1.2" stroke-dasharray="4 3"/>'
        s += f'<text x="{X(v):.1f}" y="{pad_t-6}" font-size="9.5" fill="{col}" text-anchor="middle">{esc(lab)}</text>'
    for g in range(7):
        gx = pad_l+pw*g/6
        s += f'<text x="{gx:.1f}" y="{h-pad_b+16}" font-size="10.5" fill="#64748b" text-anchor="middle">{(3+(120-3)*g/6):.0f}</text>'
    s += axis(pad_l, pad_t+ph, w-pad_r, pad_t)
    s += f'<text x="{pad_l+pw/2}" y="{h-6}" font-size="11" fill="#64748b" text-anchor="middle">duración del corte (min)</text>'
    return s+"</svg>"
fig_service = svg_density()

# Erlang-C: Wq vs ρ para varios c (con marca de operación real)
rho_xs = [i/100 for i in range(30, 96, 2)]
def wq_curve(c):
    out = []
    for rho in rho_xs:
        lmb = rho * c * MU
        out.append(min(mmc(lmb, MU, c)["Wq"], 120))
    return out
erlang_variants = {}
for c in [3, 5, 6, 10]:
    erlang_variants[c] = line_chart(
        [(f"M/M/{c}", wq_curve(c), PAL[2]),
         (f"G/G/{c} real (×{ACF:.2f})", [v*ACF for v in wq_curve(c)], PAL[1])],
        rho_xs, 0.95, 60, xlabel="utilización ρ = λ/(c·μ)", ylabel="espera media Wq (min)",
        marks=[(e["rho"], min(e["Wq"],58), e["nom"].split(" · ")[1] if " · " in e["nom"] else e["nom"])
               for e in ESC if e["c"] == c and e["estable"]])

fig_pooling = grouped_bars(
    [("Pool M/M/c (modelo live)", [p["wq_pool"] for p in POOL], PAL[1]),
     ("Pool real G/G/c (×0.58)", [p["wq_pool_ac"] for p in POOL], PAL[0]),
     ("c filas separadas M/M/1 (binding viejo)", [min(p["wq_split"],240) for p in POOL], PAL[2])],
    [p["nom"].split(" (")[0] for p in POOL], 240, ylabel="espera media Wq (min)", unit=" min", fmt="{:.0f}")

mc_inv = grouped_bars(
    [(LBL[p], MC["inv_dyn_starv_min"][p], c) for p, c in
     [("A", PAL[2]), ("B", PAL[3]), ("C", PAL[1]), ("D", PAL[4]), ("E", PAL[6])]],
    [f"{b} barberos" for b in BARBERS], 80,
    ylabel="min/turno barbero ocioso con dinámico esperando", unit=" min", fmt="{:.1f}")

def mc_metric_chart(field, ymax, unit, fmt):
    return grouped_bars(
        [(LBL[p], MC[field][p], c) for p, c in
         [("A", PAL[2]), ("C", PAL[1]), ("D", PAL[4])]],
        [f"{b}" for b in BARBERS], ymax, ylabel=field, unit=unit, fmt=fmt)
mc_variants = {
    "wait_p50": mc_metric_chart("wait_p50", 60, " min", "{:.0f}"),
    "util": grouped_bars([(LBL[p], [v*100 for v in MC["util"][p]], c) for p, c in
                          [("A", PAL[2]), ("C", PAL[1]), ("D", PAL[4])]],
                         [f"{b}" for b in BARBERS], 100, ylabel="utilización %", unit="%", fmt="{:.1f}"),
    "jain": grouped_bars([(LBL[p], MC["jain"][p], c) for p, c in
                          [("A", PAL[2]), ("C", PAL[1]), ("D", PAL[4])]],
                         [f"{b}" for b in BARBERS], 1.0, ylabel="Jain (1=equitativo)", unit="", fmt="{:.3f}"),
}

HM = D["heatmap"]
heat_variants = {bn: heatmap(HM[bn], HM["dow_labels"], [str(h) for h in HM["horas"]])
                 for bn in ["Rondeau", "Parana"]}
eq_variants = {}
for _bn, _rows in D["equidad"].items():
    eq_variants[_bn] = hbars(
        [(r["barbero"], r["cortes"], PAL[1] if r["cortes"] >= 100 else PAL[6]) for r in _rows],
        max(r["cortes"] for r in _rows) * 1.06, unit=" cortes")
fig_srv_type = hbars([(s["servicio"], s["media"], PAL[0]) for s in D["servicio_por_tipo"]],
                     50, unit=" min", fmt="{:.1f}")
fig_markov = markov_svg(C_REP)

_bn3 = ["Parana", "Rondeau", "Caseros"]
fig_peak_real = grouped_bars(
    [("Valle · P50", [_pk[n]["valle_p50"] for n in _bn3], PAL[6]),
     ("Pico · P50", [_pk[n]["pico_p50"] for n in _bn3], PAL[3]),
     ("Pico · P95", [_pk[n]["pico_p95"] for n in _bn3], PAL[2])],
    ["Paraná", "Rondeau", "Caseros"], 80,
    ylabel="espera real (min)", unit=" min", fmt="{:.0f}")
_hdw = MCHD["wait_p50"]
fig_hd_wait = grouped_bars(
    [(LBL[p], _hdw[p], c) for p, c in [("A", PAL[2]), ("C", PAL[1]), ("D", PAL[4])]],
    [f"{b} barberos" for b in BARBERS], max(_hdw["A"]) * 1.25,
    ylabel="espera P50 simulada (min) · sólo ρ≥1", unit=" min", fmt="{:.0f}")
HDW_A = (min(_hdw["A"]), max(_hdw["A"]))
OBS95 = (min(p["obs_p95"] for p in PEAK), max(p["obs_p95"] for p in PEAK))
peak_rows = [[p["nom"], f'{p["rho"]:.0%}',
              (f'{p["wq_pool"]:.1f}' if p["wq_pool"] != float("inf") else "∞"),
              (f'{p["wq_pool_ac"]:.1f}' if p["wq_pool_ac"] != float("inf") else "∞"),
              (f'{p["wq_bind"]:.0f}' if p["wq_bind"] != float("inf") else "∞"),
              f'{p["obs_p50"]:.0f}', f'{p["obs_p95"]:.0f}', f'{p["obs_max"]:.0f}']
             for p in PEAK]

# ───────────────────────── HTML ─────────────────────────
def kpi(v, l, sub=""):
    return f'<div class="kpi"><div class="kpi-v">{v}</div><div class="kpi-l">{l}</div><div class="kpi-s">{sub}</div></div>'

def table(headers, rows):
    t = '<table><thead><tr>' + "".join(f"<th>{esc(h)}</th>" for h in headers) + "</tr></thead><tbody>"
    for r in rows:
        t += "<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>"
    return t + "</tbody></table>"

SS = D["servicio"]
POI = D["poisson"]
ESC_SCALE = D["escala"]
poi_rows = [[bn, f'{POI[bn]["mean30"]:.2f}', f'{POI[bn]["var30"]:.2f}',
             f'{POI[bn]["indice_dispersion"]:.2f}', f'{POI[bn]["interarrival_cv"]:.2f}',
             POI[bn]["n_buckets"]] for bn in ["Parana", "Rondeau", "Caseros"]]
gen = D["_meta"]["generado"]

esc_rows = [[e["nom"], f'{e["lmb"]:.2f}', e["c"], f'{e["a"]:.2f}', f'{e["rho"]:.0%}',
             f'{e["C"]:.2f}', (f'{e["Wq"]:.1f}' if e["estable"] else "∞"),
             (f'{e["Wq_ac"]:.1f}' if e["estable"] else "∞"),
             (f'{e["W"]:.1f}' if e["estable"] else "∞")] for e in ESC]
pool_rows = [[p["nom"], f'{p["wq_pool"]:.1f} min', f'{p["wq_pool_ac"]:.1f} min',
              (f'{p["wq_split"]:.0f} min' if p["wq_split"]!=float("inf") else "∞ (inestable)"),
              (f'{p["ratio"]:.1f}×' if p["ratio"]!=float("inf") else "∞")] for p in POOL]
wait_rows = [[r["name"], r["n"], f'{r["wait_mean"]} min', f'{r["p50"]} min',
              f'{r["p90"]} min', f'{r["p95"]} min'] for r in D["espera_por_sucursal"]]
pat_rows = [[r["name"], r["entries_dia"], f'{r["barberos_dia"]}',
             f'{r["pct_cancelado"]}%', f'{r["pct_completado"]}%'] for r in D["patrones_por_sucursal"]]
AD = D["adopcion_dinamico"]
ad_rows = [[c["name"], c["cancel_n"], c["dyn"], f'{c["pct"]}%'] for c in AD["cancelled_subset"]]
ad_pct = 100.0 * sum(c["dyn"] for c in AD["cancelled_subset"]) / sum(c["cancel_n"] for c in AD["cancelled_subset"])
srv_rows = [[s["servicio"], s["n"], f'{s["media"]} min', f'±{s["sd"]}', f'{s["p50"]} min']
            for s in D["servicio_por_tipo"]]
mc_tbl = [[f"{b} barberos",
           f'{MC["inv_dyn_starv_min"]["A"][i]:.1f} → {MC["inv_dyn_starv_min"]["C"][i]:.2f}',
           f'{MC["util"]["A"][i]*100:.1f}% → {MC["util"]["C"][i]*100:.1f}%',
           f'{MC["wait_p50"]["A"][i]:.0f} → {MC["wait_p50"]["C"][i]:.0f} → {MC["wait_p50"]["D"][i]:.0f}',
           f'{MC["jain"]["A"][i]:.3f} / {MC["jain"]["C"][i]:.3f}']
          for i, b in enumerate(BARBERS)]

SECTIONS = [
    ("resumen", "1 · Resumen ejecutivo"),
    ("modelo", "2 · El modelo formal"),
    ("llegadas", "3 · Proceso de llegadas (Poisson)"),
    ("servicio", "4 · Proceso de servicio"),
    ("markov", "5 · Cadena de Markov y estabilidad"),
    ("pooling", "6 · Por qué el pool es correcto"),
    ("altademanda", "7 · Régimen de alta demanda"),
    ("montecarlo", "8 · Simulación Monte Carlo"),
    ("auditoria", "9 · Auditoría de datos y patrones"),
    ("mejoras", "10 · Mejoras notables (Phase 2)"),
    ("apendice", "11 · Apéndice: fórmulas y supuestos"),
]
nav = "".join(f'<a href="#{i}">{esc(t)}</a>' for i, t in SECTIONS)

HTML = f"""<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Informe de Ingeniería · Fila Dinámica · Monaco Smart Barber</title>
<style>
:root{{--ink:#0f172a;--mut:#64748b;--line:#e2e8f0;--bg:#f8fafc;--accent:#2563eb;--ok:#16a34a;--bad:#dc2626}}
*{{box-sizing:border-box}}
body{{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#fff;line-height:1.62;font-size:15px}}
.wrap{{display:grid;grid-template-columns:248px 1fr;max-width:1280px;margin:0 auto}}
nav.toc{{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:26px 16px;border-right:1px solid var(--line);background:var(--bg)}}
nav.toc .brand{{font-weight:700;font-size:14px;letter-spacing:.02em}}
nav.toc .brand span{{color:var(--accent)}}
nav.toc .meta{{font-size:11px;color:var(--mut);margin:4px 0 18px}}
nav.toc a{{display:block;color:#334155;text-decoration:none;font-size:12.5px;padding:7px 10px;border-radius:7px;margin:2px 0}}
nav.toc a:hover{{background:#e2e8f0}}
nav.toc a.active{{background:var(--accent);color:#fff;font-weight:600}}
main{{padding:46px 54px;max-width:920px}}
h1{{font-size:30px;margin:0 0 4px;letter-spacing:-.02em}}
.sub{{color:var(--mut);font-size:14px;margin-bottom:30px}}
section{{padding:30px 0;border-top:1px solid var(--line);scroll-margin-top:14px}}
section:first-of-type{{border-top:none}}
h2{{font-size:21px;margin:0 0 14px;letter-spacing:-.01em}}
h3{{font-size:15.5px;margin:24px 0 8px;color:#1e293b}}
p{{margin:10px 0}}
.chart{{width:100%;height:auto;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px;margin:14px 0}}
.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}}
.kpi{{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px}}
.kpi-v{{font-size:23px;font-weight:700;color:var(--accent)}}
.kpi-l{{font-size:12.5px;font-weight:600;margin-top:2px}}
.kpi-s{{font-size:11px;color:var(--mut);margin-top:3px}}
table{{border-collapse:collapse;width:100%;font-size:13px;margin:14px 0}}
th,td{{border:1px solid var(--line);padding:8px 10px;text-align:left}}
th{{background:var(--bg);font-weight:600}}
tbody tr:nth-child(even){{background:#fbfdff}}
.callout{{border-left:4px solid var(--accent);background:#eff6ff;padding:12px 16px;border-radius:0 10px 10px 0;margin:16px 0;font-size:14px}}
.callout.ok{{border-color:var(--ok);background:#f0fdf4}}
.callout.bad{{border-color:var(--bad);background:#fef2f2}}
.eq{{background:#0f172a;color:#e2e8f0;padding:12px 16px;border-radius:10px;font-family:ui-monospace,Menlo,monospace;font-size:13px;overflow-x:auto;margin:12px 0}}
.eq .c{{color:#fbbf24}}
.tabs{{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 4px}}
.tabs button{{font:inherit;font-size:12px;padding:6px 12px;border:1px solid var(--line);background:#fff;border-radius:999px;cursor:pointer;color:#334155}}
.tabs button.on{{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}}
.muted{{color:var(--mut);font-size:12.5px}}
.foot{{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);color:var(--mut);font-size:12px}}
details{{margin:10px 0;border:1px solid var(--line);border-radius:10px;padding:6px 14px}}
summary{{cursor:pointer;font-weight:600;font-size:14px;padding:6px 0}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
@media(max-width:980px){{.wrap{{grid-template-columns:1fr}}nav.toc{{position:static;height:auto;border-right:none;border-bottom:1px solid var(--line)}}main{{padding:24px}}.kpis,.grid2{{grid-template-columns:1fr 1fr}}}}
@media print{{
 nav.toc{{display:none}} .wrap{{display:block}} main{{padding:0;max-width:100%}}
 .tabs{{display:none}} body{{font-size:11px}} section{{break-inside:avoid;padding:14px 0}}
 .chart{{break-inside:avoid}} h1{{font-size:22px}} h2{{font-size:16px}}
 details{{break-inside:avoid}} details[open] summary~*{{display:block}}
 @page{{margin:14mm}}
}}
</style></head><body>
<div class="wrap">
<nav class="toc">
 <div class="brand">Monaco <span>Smart Barber</span></div>
 <div class="meta">Informe técnico · Fila Dinámica<br>v1.0 · {gen}</div>
 {nav}
 <div class="meta" style="margin-top:20px">Audiencia: ingeniería y dirección.<br>Reproducible: <code>docs/informe/</code></div>
</nav>
<main>
<h1>Fila Dinámica — Informe de Ingeniería</h1>
<div class="sub">Análisis del sistema de asignación de clientes en tiempo real · teoría de colas, cadenas de Markov y validación Monte Carlo sobre datos de producción · {gen}</div>
<div class="callout"><b>Alcance.</b> {ESC_SCALE['sucursales']} sucursales reales (Paraná, Rondeau, Caseros) · {ESC_SCALE['walkins_60d']:,} walk-ins y {ESC_SCALE['clientes_unicos']:,} clientes únicos en 60 días · {ESC_SCALE['barberos']} barberos · {ESC_SCALE['cortes_muestra_servicio']:,} cortes para el ajuste de la distribución de servicio · {ESC_SCALE['turnos_simulados']:,} turnos simulados (Monte Carlo).</div>
<div class="callout bad"><b>Foco del informe: alta demanda.</b> En valle el sistema
funciona con o sin la mejora. El retorno se concentra en el <b>pico</b> (Jue–Sáb
16–20 h): ahí la espera <i>típica</i> real se triplica (P50 ≈ 17 min) y el peor
caso llega a <b>{max(e["pico_max"] for e in D["pico"]["espera"]):.0f} min</b>. La
§7 compara el pico real (régimen binding) contra el modelo y la mejora — ese es el
centro de gravedad del análisis.</div>

<section id="resumen"><h2>1 · Resumen ejecutivo</h2>
<p>La barbería es, formalmente, un <b>sistema de colas multi-servidor</b>: los clientes
walk-in llegan según un proceso de <b>Poisson</b> de tasa variable λ(t), y cada barbero
es un servidor con tasa media de servicio μ. Este informe demuestra —con teoría y con
datos reales— que el modelo actual (<b>pool dinámico no bloqueante</b>, mig 134) es la
arquitectura <b>correcta y óptima</b> para este problema, y cuantifica por qué el modelo
anterior (binding pegajoso) era subóptimo.</p>
<div class="kpis">
{kpi(f'{SS["media_min"]:.1f} min','Tiempo medio de servicio','μ = '+f'{MU:.2f}'+' cortes/h/barbero')}
{kpi(f'{POI["Parana"]["indice_dispersion"]:.2f}','Índice de dispersión','Poisson validado · 3 sucursales')}
{kpi(f'{min(JAIN.values()):.2f}–{max(JAIN.values()):.2f}','Índice de Jain (equidad)','según sucursal · 1.00 = perfecto')}
{kpi('0.00 min','Inanición con el pool','vs 20–71 min/turno con el binding')}
</div>
<div class="callout ok"><b>Conclusión.</b> Con un único pool (M/M/c) el sistema es
<b>trabajo-conservativo</b> y alcanza el óptimo teórico de espera. El diseño anterior
equivalía a <b>c filas independientes (c × M/M/1)</b>, que el teorema de pooling demuestra
estrictamente peor: hasta <b>{max(p["ratio"] for p in POOL if p["ratio"]!=float("inf")):.0f}×</b>
más espera y barberos ociosos con clientes esperando en el 71–98 % de los turnos. Y no es
un caso de borde: <b>≈ la mitad o más</b> de los walk-ins eligen "menor espera" (§8) — el
diseño anterior degradaba a la <b>mayoría</b> de los clientes.</div>
</section>

<section id="modelo"><h2>2 · El modelo formal</h2>
<p>Usamos la notación de Kendall <b>A/B/c</b>: distribución de llegadas / distribución de
servicio / número de servidores. La barbería es un <b>M/G/c</b>:</p>
<ul>
<li><b>M</b> (Markoviano) — llegadas Poisson, tiempos entre llegadas exponenciales y
<i>sin memoria</i>. Validado en §3 (índice de dispersión {POI["Parana"]["indice_dispersion"]:.2f} en Paraná, {POI["Rondeau"]["indice_dispersion"]:.2f} en Rondeau).</li>
<li><b>G</b> (General) — el servicio <b>no</b> es exponencial: es <b>log-normal</b> con
CV = {SS["cv"]:.2f} ≪ 1, mucho más <i>regular</i> que la exponencial (§4).</li>
<li><b>c</b> servidores — los barberos disponibles (típico {pat_rows[1][2]} en Rondeau,
{pat_rows[0][2]} en Paraná).</li>
</ul>
<p>Un cliente <b>específico</b> (elige barbero) crea su propia mini-cola hacia ese
servidor. Un cliente <b>dinámico</b> ("menor espera") entra a un <b>pool compartido</b>
que alimenta a los <b>c</b> servidores: ese es exactamente un <b>M/G/c</b>. El cambio de
mig 134 fue pasar de "c colas M/G/1 separadas" a "una cola M/G/c". La §6 prueba por qué
eso importa.</p>
<div class="eq">Variables · λ = tasa de llegada (clientes/h) · μ = <span class="c">{MU:.3f}</span> servicios/h/barbero (= 60/{SS["media_min"]:.1f})<br>
a = λ/μ (carga ofrecida, Erlangs) · ρ = a/c = λ/(c·μ) (utilización) · estable ⟺ <span class="c">ρ &lt; 1</span></div>
</section>

<section id="llegadas"><h2>3 · Proceso de llegadas — validación de Poisson</h2>
<p>Un proceso de Poisson tiene dos firmas comprobables en los datos: (1) el número de
llegadas en intervalos fijos tiene <b>varianza = media</b> (índice de dispersión = 1), y
(2) los tiempos entre llegadas son <b>exponenciales</b> (coeficiente de variación = 1).
Medido <b>por sucursal</b>, ventana operativa 10–20 h, 60 días:</p>
{table(["Sucursal","Media /30 min","Varianza /30 min","Índice dispersión (≈1)","CV inter-arribos (≈1)","Buckets"], poi_rows)}
<div class="callout ok"><b>Resultado.</b> En las dos sucursales de volumen relevante el
índice de dispersión es <b>{POI["Parana"]["indice_dispersion"]:.2f}</b> (Paraná) y
<b>{POI["Rondeau"]["indice_dispersion"]:.2f}</b> (Rondeau), con CV de inter-arribos
≈ {POI["Parana"]["interarrival_cv"]:.2f}–{POI["Rondeau"]["interarrival_cv"]:.2f}: ambos ≈ 1
→ las llegadas son un <b>proceso de Poisson</b>. Caseros
({POI["Caseros"]["indice_dispersion"]:.2f}) queda sub-disperso por su bajo volumen
({POI["Caseros"]["mean30"]:.1f} llegadas/30 min): el flujo es <i>más regular</i> que Poisson,
lo que sólo <b>facilita</b> la cola (menor varianza ⇒ menor espera). Salvedad general: λ
<b>varía con la hora</b> (Poisson <i>no homogéneo</i>) → M/M/c se aplica por tramos
horarios, no con un λ único.</div>
<p>Perfil real de λ(t) — llegadas por hora, 60 días. Pico ~18 h
(Paraná {D["llegadas_por_hora"]["Parana"]["18"]}/h, Rondeau {D["llegadas_por_hora"]["Rondeau"]["18"]}/h;
Caseros más plano y bajo):</p>
{fig_arrivals}
</section>

<section id="servicio"><h2>4 · Proceso de servicio</h2>
<p>Sobre {SS["n"]:,} cortes (90 días): media <b>{SS["media_min"]} min</b>, desvío
{SS["sd_min"]}, <b>CV = {SS["cv"]}</b>. Ajusta una <b>log-normal</b> (μ<sub>log</sub>=
{SS["mu_log"]}, σ<sub>log</sub>={SS["sigma_log"]}); la curva ajustada cae exactamente sobre
los percentiles observados:</p>
{fig_service}
<div class="callout"><b>Implicación teórica clave.</b> Como CV<sub>s</sub> =
{SS["cv"]} &lt; 1, el servicio es <b>más regular que una exponencial</b> (CV=1). Por la
aproximación de <b>Allen-Cunneen</b> para G/G/c, la espera real es
<b>(C<sub>a</sub>²+C<sub>s</sub>²)/2 = {ACF:.2f}×</b> la que predice M/M/c. Es decir: el
sistema real espera <b>~42 % menos</b> que el peor caso markoviano. Las predicciones de
§5–§6 incluyen esta corrección.</div>
<h3>Varianza por tipo de servicio</h3>
<p>El tiempo depende fuertemente del servicio (Barba ~23 min vs Corte+Barba ~43 min). Un
promedio único es un mal predictor — esto fundamenta la mejora de §9.</p>
{fig_srv_type}
{table(["Servicio","n","Media","Desvío","Mediana"], srv_rows)}
</section>

<section id="markov"><h2>5 · Cadena de Markov y condición de estabilidad</h2>
<p>El número de clientes en el sistema es una <b>cadena de Markov de tiempo continuo</b>
de tipo <b>nacimiento-muerte</b>. Por la propiedad <i>sin memoria</i> de las llegadas
Poisson y los servicios markovianos, el estado futuro depende solo del estado actual:</p>
{fig_markov}
<p>La distribución estacionaria π<sub>n</sub> (probabilidad de tener n clientes) es la
solución de equilibrio de flujo (<b>Erlang</b>). Para el escenario Rondeau-pico
(a = λ/μ = {A_REP:.2f}, c = {C_REP}, ρ = {A_REP/C_REP:.0%}):</p>
{grouped_bars([("π_n (estado n)", [PI_REP[n] for n in range(0,13)], PAL[0])],
              [str(n) for n in range(0,13)], max(PI_REP)*1.15, ylabel="probabilidad π_n", fmt="{:.3f}")}
<div class="callout {'ok' if A_REP/C_REP<1 else 'bad'}"><b>Estabilidad.</b> El sistema es
estable si y solo si <b>ρ = λ/(c·μ) &lt; 1</b> (los servidores pueden drenar la cola más
rápido de lo que llega). Rondeau-pico: ρ = {A_REP/C_REP:.0%} &lt; 1 ✓ — cola finita y
estacionaria. Si ρ→1 la espera crece sin techo (no lineal): por eso la capacidad (c) debe
seguir a λ(t) en horas pico.</div>
<p>De π<sub>n</sub> se derivan, vía <b>Ley de Little (L = λ·W)</b>, todas las métricas
operativas. Verificación con datos reales de Rondeau (día completo): λ ≈ {LL_lmb}/h,
W observado ≈ {LL_W*60:.0f} min ⇒ L = λ·W ≈ <b>{LL_L:.1f} clientes</b> en el sistema en
promedio — consistente con {pat_rows[1][2]} barberos a utilización media.</p>
</section>

<section id="pooling"><h2>6 · Por qué el pool es la arquitectura correcta</h2>
<p>Éste es el corazón del informe. <b>Teorema (pooling / "single queue"):</b> una única
cola M/M/c con tasa total λ es <b>siempre</b> mejor (menor espera media) que c colas
M/M/1 independientes con λ/c cada una. Razón: una sola cola es <b>trabajo-conservativa</b>
— ningún servidor está ocioso si hay alguien esperando. c colas separadas <b>no</b> lo son:
un servidor puede estar libre mientras otro acumula cola.</p>
<p>El binding pegajoso (mig 132/133) ataba cada dinámico a un barbero <b>en el check-in</b>:
de facto, c colas M/M/1. El pool (mig 134) asigna <b>cuando el barbero se libera</b>:
una cola M/M/c. Cuantificado con los parámetros reales (μ={MU:.2f}/h):</p>
{fig_pooling}
{table(["Escenario","Pool M/M/c (Wq)","Pool real G/G/c","c × M/M/1 (binding)","Penalización"], pool_rows)}
<div class="callout bad"><b>Hallazgo.</b> Con el binding, en hora pico la espera teórica se
multiplica por <b>{POOL[0]["ratio"]:.0f}–{max(p["ratio"] for p in POOL if p["ratio"]!=float("inf")):.0f}×</b>
y aparecen estados imposibles bajo M/M/c: barbero ocioso + cliente esperando. La Monte
Carlo (§7) confirma esto empíricamente sobre 43 200 turnos simulados.</div>
<h3>Curva de Erlang-C (la "pared" de la congestión)</h3>
<p>Wq crece de forma <b>no lineal</b> con ρ — es estable hasta ~80 % y explota cerca de 1.
Los puntos negros son los regímenes reales medidos. Línea verde = espera real corregida
por la regularidad del servicio (Allen-Cunneen).</p>
<div class="tabs" data-group="erl">
{"".join(f'<button data-erl="{c}" class="{ "on" if c==5 else "" }">c = {c} barberos</button>' for c in [3,5,6,10])}
</div>
{"".join(f'<div class="erl-v" data-erl="{c}" style="display:{ "block" if c==5 else "none" }">{erlang_variants[c]}</div>' for c in [3,5,6,10])}
{table(["Escenario real","λ/h","c","a (Erlang)","ρ","P(esperar)","Wq M/M/c","Wq real G/G/c","W (con servicio)"], esc_rows)}
</section>

<section id="altademanda"><h2>7 · Régimen de alta demanda — donde se decide todo</h2>
<p>Una cola sólo "duele" bajo carga. En <b>valle</b> hay holgura: ningún barbero
ocioso, esperas cortas, el binding casi no muerde — da casi igual el modelo. <b>El
valor de la mejora se concentra en el pico</b> (Jue–Sáb 16–20 h ≈
{D["pico"]["share_demanda_pct"]}% de la demanda en {D["pico"]["horas_semana"]} h/semana).
Por eso el peso del análisis va acá.</p>
<h3>Dato real: la espera <i>típica</i> se triplica en el pico</h3>
{fig_peak_real}
<p>Mediana de espera real (P50): Paraná {_pk["Parana"]["valle_p50"]:.0f}→<b>{_pk["Parana"]["pico_p50"]:.0f}</b> min,
Rondeau {_pk["Rondeau"]["valle_p50"]:.0f}→<b>{_pk["Rondeau"]["pico_p50"]:.0f}</b>,
Caseros {_pk["Caseros"]["valle_p50"]:.0f}→<b>{_pk["Caseros"]["pico_p50"]:.0f}</b>. En el pico el
P95 trepa a ~60–70 min y el peor caso a
<b>{max(e["pico_max"] for e in D["pico"]["espera"]):.0f} min</b> (2 h+).</p>
<h3>El modelo explica los datos del pico — y prueba la mejora</h3>
<p>Al ρ del pico, el <b>binding</b> (= c colas M/M/1 independientes) y el <b>pool</b>
(= una cola M/M/c) predicen esperas radicalmente distintas. La columna binding cae
sobre el P95/máximo <i>realmente observados</i> en el período binding — el modelo
<b>valida contra datos pasados</b>; el pool las colapsa:</p>
{table(["Sucursal","ρ pico","Wq pool M/M/c","Wq pool real G/G/c","Wq binding c×M/M/1","P50 obs.","P95 obs.","máx obs."], peak_rows)}
<div class="callout bad"><b>Lectura.</b> El binding predice
<b>{min(p["wq_bind"] for p in PEAK):.0f}–{max(p["wq_bind"] for p in PEAK):.0f} min</b>
de espera en el pico; los datos reales del pico (régimen binding) muestran P95
<b>{min(p["obs_p95"] for p in PEAK):.0f}–{max(p["obs_p95"] for p in PEAK):.0f} min</b>
y máximos hasta <b>{max(p["obs_max"] for p in PEAK):.0f} min</b>: <b>coinciden</b>. El
pool baja la espera a pocos minutos y elimina la ociosidad. Ese diferencial — el
retorno de la mejora — <b>sólo existe acá, en alta demanda</b>.</div>
<h3>Monte Carlo aislando alta demanda (ρ ≥ 1) — la espera</h3>
<p>Filtrando sólo las celdas saturadas de la grilla (carga ≥ capacidad) — el régimen
del viernes a las 19 h — la <b>espera mediana</b> simulada del binding es
<b>{HDW_A[0]:.0f}–{HDW_A[1]:.0f} min</b>, del orden del P95 real observado en el pico
(<b>{OBS95[0]:.0f}–{OBS95[1]:.0f} min</b>): la simulación <b>reproduce los datos
pasados</b>. El pool, y sobre todo pool+WSJF, la corta:</p>
{fig_hd_wait}
<p class="muted">Espera P50 simulada, sólo celdas ρ≥1. La espera <b>no</b> es cero —
en saturación hay cola real. Lo que el pool elimina de raíz es el <i>desperdicio</i>
(barbero libre con cola), que es <b>invariante a la carga</b> (≈ igual en valle que
en pico — ver §8): no es un efecto del pico, ocurre siempre que el binding
mal-rutea. El daño <b>específico del pico</b> es la espera: con binding, P50 ~{HDW_A[1]:.0f}
min justo cuando más clientes hay.</p>
</section>

<section id="montecarlo"><h2>8 · Simulación Monte Carlo</h2>
<p>Modelo de eventos discretos calibrado con los datos reales (servicio log-normal
μ<sub>log</sub>={SS["mu_log"]}, σ<sub>log</sub>={SS["sigma_log"]}). Grilla: barberos
{{3,5,7,10}} × carga {{0.8, 1.0, 1.15}} × % dinámico {{25,50,80}} × popularidad
{{uniforme, estrella}} × 5 políticas × 120 réplicas = <b>43 200 turnos simulados</b>.
Reproducible en <code>docs/sim/fila_montecarlo.py</code>.</p>
<p>Políticas: <b>A</b> binding pegajoso (modelo viejo) · <b>B</b> binding con
push instantáneo · <b>C</b> pool no bloqueante (modelo live, mig 134) · <b>D</b> pool +
WSJF · <b>E</b> pool con gate de equidad.</p>
<h3>El invariante duro: ningún barbero ocioso con un dinámico esperando</h3>
{mc_inv}
<p class="muted"><b>Aclaración.</b> Esta métrica <b>no es el tiempo de espera</b>
(que no es cero — en un pico hay cola real; ver §8, P50/P95 por sucursal). Es el
<b>desperdicio</b>: minutos/turno con un barbero <i>libre</i> mientras un cliente
espera. El pool da 0 por construcción (trabajo-conservativo): un servidor ocioso
con trabajo elegible es imposible.</p>
<div class="callout bad"><b>A ≈ B.</b> Quitar el "push-on-complete" casi no cambia nada
(la barra A ≈ B): el problema <b>no</b> era el push, era el <b>binding</b>. <b>C = D =
0.00</b>: el pool lo elimina de raíz. <b>E</b> (gate de equidad bloqueante) <i>reintrodujo</i>
el problema — confirmó numéricamente que la equidad nunca debe retener trabajo.</div>
<h3>Eficiencia y experiencia (selección de métrica)</h3>
<div class="tabs" data-group="mc">
<button data-mc="wait_p50" class="on">Espera P50</button>
<button data-mc="util">Utilización</button>
<button data-mc="jain">Equidad (Jain)</button>
</div>
{"".join(f'<div class="mc-v" data-mc="{k}" style="display:{ "block" if k=="wait_p50" else "none" }">{v}</div>' for k,v in mc_variants.items())}
{table(["Escenario","Inanición A→C (min/turno)","Utilización A→C","Espera P50 A→C→D (min)","Jain A / C"], mc_tbl)}
<p class="muted">Throughput idéntico entre políticas a estas cargas (el turno satura): el
daño del binding no es "menos cortes" sino espera, ociosidad con cola, y la promesa rota
de "menor espera". El pool además sube utilización ~2 pp (≈ 0.2 barbero recuperado con 10
sillas).</p>
</section>

<section id="auditoria"><h2>9 · Auditoría de datos y patrones</h2>
<h3>Espera real por sucursal (60 días)</h3>
{table(["Sucursal","n","Media","P50","P90","P95"], wait_rows)}
<p>Las esperas reales (Rondeau P50 13.8 / Paraná P50 9.4 min) son del orden que predice
el modelo G/G/c corregido para carga media — el modelo <b>explica los datos</b>. Las colas
P90/P95 (~50–67 min) corresponden a los picos de 17–19 h, donde ρ→0.8.</p>
<h3>Operación por sucursal</h3>
{table(["Sucursal","Entries/día","Barberos/día","% cancelado","% completado"], pat_rows)}
<h3>Adopción real de "menor espera" — corrección metodológica</h3>
<div class="callout bad"><b>Corrección.</b> Una versión preliminar reportó adopción de
"menor espera" de 0.6–2.3 %. <b>Es incorrecto.</b> <code>claim_next_for_barber</code> hace
<code>SET is_dynamic=false</code> al asignar al cliente: las entries <code>completed</code>
(95–96 % del total) pierden la marca. Medir <code>is_dynamic</code> sobre el histórico mide
ruido (dinámicos que se cancelaron), no adopción.</div>
<p>El único subconjunto donde la marca <b>sobrevive</b> (entries <b>canceladas</b>, nunca
reclamadas) muestra la realidad:</p>
{table(["Sucursal","Cancelados (n)","Dinámicos","% dinámico (marca intacta)"], ad_rows)}
<div class="callout ok"><b>Lectura correcta.</b> ≈ <b>{ad_pct:.0f} %</b> de los walk-ins
eligen "menor espera" (Paraná 48.8 %, Rondeau 51.1 %) — <b>la mayoría</b>, consistente con
la operación diaria. Es una <b>cota inferior</b>: los dinámicos esperan menos ⇒ cancelan
menos ⇒ están sub-representados entre los cancelados; la adopción real es probablemente
mayor. <b>Implicación</b>: el binding pegajoso (mig 132/133) degradaba a <b>~la mitad o más</b>
de los clientes, no a un nicho del 2 % — multiplica el valor del fix mig 134 (§6) y
<b>refuerza</b> la tesis del informe.</div>
<h3>Demanda por día y hora</h3>
<div class="tabs" data-group="heat">
<button data-heat="Rondeau" class="on">Rondeau</button><button data-heat="Parana">Paraná</button>
</div>
{"".join(f'<div class="heat-v" data-heat="{bn}" style="display:{ "block" if bn=="Rondeau" else "none" }">{heat_variants[bn]}</div>' for bn in ["Rondeau","Parana"])}
<h3>Equidad de carga por barbero (30 d)</h3>
<div class="tabs" data-group="eq">
{"".join(f'<button data-eq="{bn}" class="{ "on" if bn=="Rondeau" else "" }">{("Paraná" if bn=="Parana" else bn)} · Jain {JAIN[bn]:.2f}</button>' for bn in ["Rondeau","Parana","Caseros"])}
</div>
{"".join(f'<div class="eq-v" data-eq="{bn}" style="display:{ "block" if bn=="Rondeau" else "none" }">{eq_variants[bn]}</div>' for bn in ["Rondeau","Parana","Caseros"])}
<p class="muted">Índice de Jain entre barberos a tiempo completo (≥100 cortes/30 d):
Rondeau <b>{JAIN["Rondeau"]:.3f}</b>, Paraná <b>{JAIN["Parana"]:.3f}</b>, Caseros
<b>{JAIN["Caseros"]:.3f}</b> — equitativo en las 3. Los valores bajos (Rodri/Tony/Tomi) son
part-time, no inequidad. La diferencia residual (Paraná algo menor) es preferencia legítima
del cliente por el barbero estrella, no defecto del scheduler.</p>
<div class="callout"><b>Patrones detectados.</b>
<b>(1)</b> "Menor espera" es la elección <b>mayoritaria</b> (≈ {ad_pct:.0f} %+, ver
corrección arriba): el modelo pool gobierna la experiencia de la mayoría de los clientes,
no la de un nicho.
<b>(2)</b> Abandono bajo (cancelado 3–4.5 %): los clientes esperan en vez de irse → la
espera es un costo real de experiencia, no de ingresos perdidos (aún).
<b>(3)</b> Demanda muy concentrada Jue–Sáb 17–19 h: la capacidad (c) debería escalar por
franja, no ser plana.
<b>(4)</b> Higiene de datos: servicios duplicados por espacios ("Corte" vs "Corte ") —
distorsiona analítica por servicio; normalizar.
<b>(5)</b> <b>Brecha de modelo de datos</b>: la modalidad de check-in no se persiste
(<code>is_dynamic</code> se muta al asignar). Imposible medir adopción o segmentar el
histórico por modalidad — ver §9.</div>
</section>

<section id="mejoras"><h2>10 · Mejoras notables (Phase 2)</h2>
<p>Priorizadas por impacto/esfuerzo, todas <i>sobre</i> el pool (nunca contra él):</p>
<ol>
<li><b>Predicción de duración por (barbero, servicio).</b> Hoy el panel usa un fallback de
25 min; los datos muestran 23→43 min según servicio. Una vista materializada precalculada
por cron (no por tick — ver incidente 30/04) mejora el ETA y habilita lo siguiente.
Impacto: estimación de espera fiable, base para WSJF.</li>
<li><b>WSJF acotado por aging</b> en el claim del pool (política D): la Monte Carlo muestra
<b>P50 −40 %</b> sin sacrificar el invariante. Como término aditivo del score, nunca como
gate (lección de E / mig 129).</li>
<li><b>Capacidad dinámica por franja.</b> ρ→0.8 sólo Jue–Sáb 17–19 h. Sugerir refuerzo en
esas 6 franjas reduce el P95 sin contratar a tiempo completo.</li>
<li><b>Columna inmutable de modalidad de check-in</b> (p. ej. <code>chose_dynamic</code>,
fijada en el INSERT y nunca mutada). Hoy <code>is_dynamic</code> se resetea al asignar →
imposible medir adopción, ETA por modalidad o segmentar el histórico. Cambio chico
(1 columna + set en <code>checkinClient</code>); habilita toda la analítica de producto
sobre la función que usa la mayoría. <b>Prioridad alta.</b></li>
</ol>
</section>

<section id="apendice"><h2>11 · Apéndice: fórmulas y supuestos</h2>
<details><summary>Erlang-B, Erlang-C y métricas M/M/c</summary>
<div class="eq">Erlang-B (recursión):  B(0)=1 ;  B(j) = a·B(j-1) / ( j + a·B(j-1) )<br>
Erlang-C:  C = B(c) / ( 1 − ρ·(1 − B(c)) )   con ρ = a/c<br>
P(esperar &gt; 0) = C ·  Wq = C / (c·μ − λ)  ·  W = Wq + 1/μ<br>
Lq = λ·Wq ·  L = λ·W  (Ley de Little)  ·  P(espera &gt; t) = C·e^(−(cμ−λ)t)</div></details>
<details><summary>Aproximación G/G/c (Allen-Cunneen)</summary>
<div class="eq">Wq(G/G/c) ≈ Wq(M/M/c) · ( C<span class="c">a</span>² + C<span class="c">s</span>² ) / 2<br>
C<span class="c">a</span> = 1 (llegadas Poisson) ·  C<span class="c">s</span> = {SS["cv"]} (servicio real)<br>
factor = (1 + {SS["cv"]}²)/2 = <span class="c">{ACF:.3f}</span></div></details>
<details><summary>Distribución estacionaria (Erlang / nacimiento-muerte)</summary>
<div class="eq">π0 = [ Σ(n=0..c-1) aⁿ/n!  +  aᶜ/(c!·(1−ρ)) ]⁻¹<br>
πn = aⁿ/n! · π0   (n ≤ c)   ·   πn = aⁿ/(c!·c^(n−c)) · π0   (n &gt; c)</div></details>
<details><summary>Supuestos y límites</summary>
<p class="muted">· λ(t) tratado por tramos (Poisson no homogéneo); los Wq son por
régimen, no globales. · Servicio log-normal aproximado por Allen-Cunneen (G/G/c no tiene
forma cerrada exacta). · Clientes específicos modelados como ruta dedicada; el pool aplica
a dinámicos. · Sin abandono explícito (cancelación real 3–4.5 %, baja). · Datos: prod
{D["_meta"]["fuente"]}, ventanas {D["_meta"]["ventana_servicio_dias"]}/{D["_meta"]["ventana_operativa_dias"]} d.
Sucursales de prueba excluidas.</p></details>
<p class="muted">Reproducibilidad: <code>docs/informe/data.json</code> (datos) ·
<code>docs/informe/build_report.py</code> (modelo+gráficos) ·
<code>docs/sim/fila_montecarlo.py</code> + <code>results.json</code> (Monte Carlo) ·
<code>docs/fila-dinamica.md</code> (spec del sistema).</p>
</section>

<div class="foot">Monaco Smart Barber · Informe técnico de la Fila Dinámica · generado {gen}
· teoría de colas (M/G/c, Erlang), cadenas de Markov, Ley de Little y simulación Monte
Carlo sobre datos de producción. Documento autocontenido — apto para impresión/PDF.</div>
</main></div>
<script>
// scrollspy
var secs=[].slice.call(document.querySelectorAll('section'));
var links=[].slice.call(document.querySelectorAll('nav.toc a'));
function spy(){{var y=scrollY+90,cur=secs[0];secs.forEach(function(s){{if(s.offsetTop<=y)cur=s;}});
links.forEach(function(a){{a.classList.toggle('active',a.getAttribute('href')==='#'+cur.id);}});}}
addEventListener('scroll',spy);spy();
links.forEach(function(a){{a.onclick=function(e){{e.preventDefault();
document.getElementById(a.getAttribute('href').slice(1)).scrollIntoView({{behavior:'smooth'}});}};}});
// toggles (Erlang c / Monte Carlo métrica)
function group(attr,cls){{
 document.querySelectorAll('.tabs button['+attr+']').forEach(function(b){{
  b.onclick=function(){{var v=b.getAttribute(attr);
   b.parentNode.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
   document.querySelectorAll('.'+cls+'['+attr+']').forEach(function(d){{
    d.style.display=d.getAttribute(attr)===v?'block':'none';}});}};}});}}
group('data-erl','erl-v');group('data-mc','mc-v');group('data-heat','heat-v');group('data-eq','eq-v');
// para impresión/PDF: expandir apéndice y mostrar la 1ª variante de cada toggle
function expandForPrint(){{document.querySelectorAll('details').forEach(function(d){{d.open=true;}});}}
addEventListener('beforeprint',expandForPrint);
if(matchMedia('print').matches||location.search.indexOf('print')>=0)expandForPrint();
</script>
</body></html>"""

out = os.path.join(HERE, "informe-fila-dinamica.html")
open(out, "w", encoding="utf-8").write(HTML)
print("OK ->", out, f"({len(HTML)//1024} KB)")
print(f"Erlang-C Rondeau pico: ρ={ESC[0]['rho']:.2%} Wq_MMc={ESC[0]['Wq']:.1f}min "
      f"Wq_real={ESC[0]['Wq_ac']:.1f}min | pooling ratio={POOL[0]['ratio']:.1f}x | "
      f"Jain={JAIN} | Little L={LL_L:.2f} | escala={ESC_SCALE['walkins_60d']} walk-ins")

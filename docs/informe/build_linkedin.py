#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deck para LinkedIn — versión narrativa y visual del informe de la Fila Dinámica.
Salida: linkedin-fila-dinamica.html  (deck interactivo, scroll-snap + teclado)
El PDF (1 slide = 1 página, 16:9) se genera con Chrome headless (ver README).
Sin PII: solo agregados. Python puro (stdlib). Reusa data.json + ../sim/results.json.
"""
import json, math, os, html, base64

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "data.json")))
try:
    SIM = json.load(open(os.path.join(HERE, "..", "sim", "results.json")))
except Exception:
    SIM = {}
_lp = os.path.join(HERE, "assets", "studios-logo.png")
LOGO = ("data:image/png;base64," + base64.b64encode(open(_lp, "rb").read()).decode()
        if os.path.exists(_lp) else "")

# ── teoría (mínimo necesario) ──
def erlang_b(c, a):
    b = 1.0
    for j in range(1, c + 1):
        b = (a * b) / (j + a * b)
    return b
def erlang_c(c, a):
    rho = a / c
    if rho >= 1: return 1.0
    b = erlang_b(c, a)
    return b / (1.0 - rho * (1.0 - b))
def mmc_wq_min(lmbda, mu, c):
    a = lmbda / mu
    if a / c >= 1: return float("inf")
    return erlang_c(c, a) / (c * mu - lmbda) * 60.0
def mm1_wq_min(lmbda, mu):
    if lmbda >= mu: return float("inf")
    return lmbda / (mu * (mu - lmbda)) * 60.0

MU = D["servicio"]["mu_servicio_por_hora"]
CV_S = D["servicio"]["cv"]
ACF = (1 + CV_S ** 2) / 2
SC = D["escala"]
AD = D["adopcion_dinamico"]["cancelled_subset"]
ad_pct = round(100.0 * sum(c["dyn"] for c in AD) / sum(c["cancel_n"] for c in AD))

# pooling worked example (Rondeau pico)
LMB, C = 5.69, 5
wq_pool = mmc_wq_min(LMB, MU, C)
wq_pool_ac = wq_pool * ACF
wq_split = mm1_wq_min(LMB / C, MU)
RATIO = round(wq_split / wq_pool)

# Monte Carlo agg by barberos (A binding vs C pool)
BAR = [3, 5, 7, 10]
def agg(nb, pol, f):
    ks = [k for k in SIM if k.split("|")[0] == str(nb) and k.split("|")[4] == pol]
    return sum(SIM[k][f] for k in ks) / len(ks) if ks else 0.0
INV_A = [agg(nb, "A", "inv_dyn_starv_min") for nb in BAR]
INV_C = [agg(nb, "C", "inv_dyn_starv_min") for nb in BAR]
P50_A = sum(agg(nb, "A", "wait_p50") for nb in BAR) / 4
P50_D = sum(agg(nb, "D", "wait_p50") for nb in BAR) / 4
p50_drop = round(100 * (P50_A - P50_D) / P50_A)
viol_A = round(100 * sum(agg(nb, "A", "inv_violated") for nb in BAR) / 4)

# ── pico real + Monte Carlo de alta demanda (ρ ≥ 1) ──
PK = D["pico"]
_pk = {x["name"]: x for x in PK["espera"]}
PK_MAX = max(x["pico_max"] for x in PK["espera"])
obs95_lo = round(min(x["pico_p95"] for x in PK["espera"]))
obs95_hi = round(max(x["pico_p95"] for x in PK["espera"]))
def _bind_pk(nm):
    q = next(z for z in PK["params"] if z["name"] == nm)
    return mm1_wq_min(q["lambda_pico"] / q["c"], MU)
BIND = {x["name"]: _bind_pk(x["name"]) for x in PK["espera"]}
bind_lo, bind_hi = round(min(BIND.values())), round(max(BIND.values()))
def agg_hd(nb, pol, f):
    ks = [k for k in SIM if k.split("|")[0] == str(nb) and k.split("|")[4] == pol
          and k.split("|")[1] in ("1.0", "1.15")]
    return sum(SIM[k][f] for k in ks) / len(ks) if ks else 0.0
INV_A_HD = [agg_hd(nb, "A", "inv_dyn_starv_min") for nb in BAR]
INV_C_HD = [agg_hd(nb, "C", "inv_dyn_starv_min") for nb in BAR]
W_A_HD = [round(agg_hd(nb, "A", "wait_p50")) for nb in BAR]   # espera viejo, alta demanda
W_C_HD = [round(agg_hd(nb, "C", "wait_p50")) for nb in BAR]   # espera pool
W_D_HD = [round(agg_hd(nb, "D", "wait_p50")) for nb in BAR]   # espera pool+WSJF

def e(s): return html.escape(str(s))

# ── SVG (estilo slide: grande, alto contraste) ──
def bars(series, cats, ymax, w=1200, h=360, unit="", fmt="{:.0f}", dark=False):
    fg = "#e5e7eb" if dark else "#0f172a"
    grid = "#374151" if dark else "#e2e8f0"
    mut = "#9ca3af" if dark else "#64748b"
    pl, pb, pt, pr = 70, 54, 40, 20
    pw, ph = w - pl - pr, h - pb - pt
    s = (f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" '
         f'preserveAspectRatio="xMidYMid meet" '
         f'font-family="Inter,system-ui,sans-serif">')
    for g in range(5):
        gy = pt + ph - ph * g / 4
        s += f'<line x1="{pl}" y1="{gy:.0f}" x2="{w-pr}" y2="{gy:.0f}" stroke="{grid}"/>'
        s += f'<text x="{pl-10}" y="{gy+5:.0f}" font-size="15" fill="{mut}" text-anchor="end">{ymax*g/4:.0f}</text>'
    nC, nS = len(cats), len(series)
    gw = pw / nC; bw = gw * 0.7 / nS
    for ci, cat in enumerate(cats):
        gx = pl + ci * gw
        for si, (nm, vals, col) in enumerate(series):
            v = vals[ci]
            bh = 0 if ymax <= 0 else max(0.0, min(1.0, v / ymax)) * ph
            bx = gx + gw * 0.15 + si * bw
            s += f'<rect x="{bx:.0f}" y="{pt+ph-bh:.0f}" width="{bw-6:.0f}" height="{bh:.0f}" fill="{col}" rx="3"/>'
            s += f'<text x="{bx+(bw-6)/2:.0f}" y="{pt+ph-bh-8:.0f}" font-size="15" font-weight="700" fill="{fg}" text-anchor="middle">{fmt.format(v)}{e(unit)}</text>'
        s += f'<text x="{gx+gw/2:.0f}" y="{h-pb+24:.0f}" font-size="16" fill="{fg}" text-anchor="middle">{e(cat)}</text>'
    lx = pl
    for nm, _, col in series:
        s += f'<rect x="{lx}" y="8" width="15" height="15" fill="{col}" rx="3"/>'
        s += f'<text x="{lx+21}" y="21" font-size="15" fill="{fg}">{e(nm)}</text>'
        lx += 42 + len(nm) * 9.5
    return s + "</svg>"

GREEN, RED, BLUE, AMBER = "#22c55e", "#ef4444", "#3b82f6", "#f59e0b"
fig_pool = bars(
    [("1 fila para todos (M/M/c) — modelo nuevo", [wq_pool_ac], GREEN),
     ("1 fila por barbero (c×M/M/1) — modelo viejo", [min(wq_split, 80)], RED)],
    ["Espera media en hora pico (min)"], 80, unit=" min", fmt="{:.0f}", dark=True)
fig_inv = bars(
    [("Modelo viejo (binding)", INV_A, RED), ("Modelo nuevo (pool)", INV_C, GREEN)],
    [f"{b} barberos" for b in BAR], max(INV_A) * 1.15, unit=" min", fmt="{:.0f}", dark=True)
fig_hd_wait = bars(
    [("Modelo viejo (binding)", W_A_HD, RED), ("Modelo nuevo (pool)", W_C_HD, GREEN)],
    [f"{b} barberos" for b in BAR], max(W_A_HD) * 1.2, unit=" min", fmt="{:.0f}", dark=True)
fig_peak = bars(
    [("Día tranquilo (valle)", [_pk[n]["valle_p50"] for n in ["Parana", "Rondeau", "Caseros"]], BLUE),
     ("Pico — viernes tarde", [_pk[n]["pico_p50"] for n in ["Parana", "Rondeau", "Caseros"]], RED)],
    ["Paraná", "Rondeau", "Caseros"], 26, unit=" min", fmt="{:.0f}", dark=True)

# ── slides ──
def slide(bg, content, dark=False, kicker="", n=0):
    cls = "slide dark" if dark else "slide"
    k = f'<div class="kicker">{e(kicker)}</div>' if kicker else ""
    return (f'<section class="{cls}" style="background:{bg}">'
            f'<div class="inner">{k}{content}</div>'
            f'<div class="pg">{n:02d} · studiOS</div></section>')

S = []
S.append(slide("#0b1220", f"""
 <img class="logo logo-lg" src="{LOGO}" alt="studiOS" style="margin-bottom:18px">
 <div class="kicker">studiOS · Caso de ingeniería</div>
 <h1>Teníamos barberos <span class="hl">parados</span><br>mientras los clientes esperaban.</h1>
 <p class="lead">Un viernes a las 7 de la tarde: cola en la puerta y un barbero
 libre al lado. Lo resolvimos con <b>teoría de colas</b>, Markov y Monte Carlo
 sobre datos reales del sistema <b>Monaco Smart Barber</b>.</p>
 <div class="chips"><span>{SC['sucursales']} sucursales</span>
 <span>{SC['walkins_60d']:,} walk-ins / 60 d</span>
 <span>{SC['clientes_unicos']:,} clientes</span>
 <span>{SC['turnos_simulados']:,} turnos simulados</span></div>""", dark=True, n=1))

S.append(slide("#ffffff", f"""
 <div class="kicker">Dónde duele de verdad — el pico</div>
 <h2>Un viernes a las 7 de la tarde.<br><span class="hl-r">Ahí</span> se decide todo.</h2>
 <div class="chart" style="background:#0f1729">{fig_peak}
 <div class="cap" style="color:#94a3b8;text-align:center;margin-top:8px;font-size:13px">
 Espera típica real (mediana) · día tranquilo vs pico (Jue–Sáb 16–20 h)</div></div>
 <p class="lead">La espera <b>típica</b> se <b>triplica</b> en el pico (P50 ≈ 17 min);
 P95 <b>{obs95_lo}–{obs95_hi} min</b>, peor caso <b>{PK_MAX} min</b>. En valle casi da
 igual el modelo: <b>el retorno de la mejora vive en el pico</b>.</p>""", n=2))

S.append(slide("#0b1220", f"""
 <div class="kicker">La causa raíz</div>
 <h2>El sistema "reservaba" cada cliente<br>a un barbero <span class="hl">al llegar</span>.</h2>
 <p class="lead">De facto, no era <b>una fila para todos</b>: eran
 <b>c filas separadas</b>, una por barbero. Si tu barbero asignado se complicaba,
 esperabas — aunque otro estuviera libre y no pudiera atenderte.</p>
 <div class="two"><div class="card bad">❌ Binding al check-in<br><small>c × fila individual</small></div>
 <div class="card good">✓ Pool al liberarse<br><small>1 fila · c servidores</small></div></div>""", dark=True, n=3))

S.append(slide("#ffffff", f"""
 <div class="kicker">No era un caso de borde</div>
 <h2>≈ <span class="hl-r">{ad_pct}%</span> de los clientes elige<br>"el que esté libre".</h2>
 <p class="lead">El bug degradaba a <b>la mayoría</b>, no a un nicho. Y fuimos
 honestos con los datos: <b>detectamos y corregimos un error en nuestra propia
 métrica</b> que subestimaba esa adopción (un flag que se reseteaba al asignar).
 La rigurosidad también es revisar lo propio.</p>""", n=4))

S.append(slide("#0b1220", f"""
 <div class="kicker">La teoría lo predice — teorema de pooling</div>
 <h2>Una sola fila para <i>c</i> barberos es<br><span class="hl">siempre</span> mejor que <i>c</i> filas.</h2>
 <div class="chart">{fig_pool}</div>
 <p class="lead">Misma gente, misma demanda — solo cambia la arquitectura:
 <b>{RATIO}× menos espera</b> en el pico. El modelo viejo predice
 <b>{bind_lo}–{bind_hi} min</b>; el P95 real del pico es
 <b>{obs95_lo}–{obs95_hi} min</b>. <b>Coinciden.</b></p>""",
 dark=True, n=5))

S.append(slide("#0b1220", f"""
 <div class="kicker">Lo probamos — Monte Carlo, {SC['turnos_simulados']:,} turnos</div>
 <h2>Cero barberos parados<br>con clientes <span class="hl">esperando</span>.</h2>
 <div class="metric-note"><b>Ojo: esto NO es el tiempo de espera</b> (esa es la
 slide anterior, y en el pico no es cero). Esto es el <b>desperdicio</b>: minutos
 por turno con un barbero <b>libre</b> mientras alguien esperaba — y ocurre a
 <b>cualquier carga</b>, no sólo en el pico. Viejo: hasta {max(INV_A):.0f}
 min/turno. Pool: <b>0</b> (por diseño: trabajo-conservativo).</div>
 <div class="chart">{fig_inv}
 <div class="cap">Desperdicio = min/turno con barbero LIBRE + cliente esperando · invariante a la carga · no es el tiempo de espera</div></div>""",
 dark=True, n=6))

S.append(slide("#0b1220", f"""
 <div class="kicker">La espera en alta demanda — viejo vs nuevo</div>
 <h2>En el pico, la espera<br>se <span class="hl">desploma</span>.</h2>
 <div class="chart">{fig_hd_wait}
 <div class="cap">Espera mediana simulada · régimen saturado (ρ≥1) · misma carga y capacidad · por nº de barberos</div></div>
 <div class="metric-note">La comparativa que importa en <b>alta demanda</b>:
 binding (viejo) deja P50 <b>{min(W_A_HD)}–{max(W_A_HD)} min</b>; el pool (nuevo, ya en
 producción) <b>{min(W_C_HD)}–{max(W_C_HD)} min</b>; con WSJF (Phase 2)
 <b>{min(W_D_HD)}–{max(W_D_HD)} min</b>. Misma gente, misma demanda — solo cambia el modelo.</div>""",
 dark=True, n=7))

S.append(slide("#ffffff", f"""
 <div class="kicker">El impacto</div>
 <h2>Mejor para el cliente <span class="hl">y</span> para el negocio.</h2>
 <div class="kpis">
 <div class="k"><div class="kv">0.00</div><div class="kl">min de desperdicio<br><small>barbero libre + cola · antes 20–71</small></div></div>
 <div class="k"><div class="kv">−{p50_drop}%</div><div class="kl">tiempo de espera P50<br><small>baja — no llega a cero</small></div></div>
 <div class="k"><div class="kv">+2 pp</div><div class="kl">utilización<br><small>≈ 0.2 barbero/10 sillas</small></div></div>
 <div class="k"><div class="kv">0.96–1.00</div><div class="kl">equidad (Jain)<br><small>carga pareja entre barberos</small></div></div>
 </div>
 <p class="lead">La espera <b>baja</b> —no se elimina: en un pico sigue habiendo
 cola y se espera—, pero deja de haber <b>sillas vacías con gente esperando</b>.
 Validado además contra datos reales con <b>Erlang-C</b> y <b>Allen-Cunneen</b> (G/G/c).</p>""", n=8))

S.append(slide("#0b1220", f"""
 <div class="kicker">4 lecciones de ingeniería</div>
 <h2>Lo que nos llevamos.</h2>
 <ol class="lessons">
 <li><b>Asigná cuando el recurso se libera</b>, no cuando el trabajo llega.
 La asignación temprana destruye la conservación de trabajo.</li>
 <li><b>La equidad nunca debe retener trabajo.</b> Un "gate de justicia" que deja
 a alguien parado reintroduce el problema (lo probamos).</li>
 <li><b>Validá con teoría + simulación + datos</b>, no con intuición. Los tres
 coincidieron.</li>
 <li><b>Medí dos veces.</b> Corregimos nuestro propio error de métrica antes de
 sacar conclusiones.</li>
 </ol>""", dark=True, n=9))

S.append(slide("#0b1220", f"""
 <div class="kicker">studiOS</div>
 <h1>Así construimos software:<br><span class="hl">ingeniería</span>, no slides.</h1>
 <p class="lead">Teoría de colas (M/G/c, Erlang), cadenas de Markov, Ley de Little
 y Monte Carlo — aplicados a un problema real de operación de
 <b>Monaco Smart Barber</b>, el producto que construimos en studiOS.</p>
 <img class="logo" src="{LOGO}" alt="studiOS" style="margin-top:24px">
 <p class="sign">Ignacio Baldovino · Co-fundador de studiOS · {D['_meta']['generado']}</p>""", dark=True, n=10))

NSL = len(S)
dots = "".join(f'<button data-i="{i}" aria-label="slide {i+1}"></button>' for i in range(NSL))

HTML = f"""<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fila Dinámica · de barberos parados a teoría de colas — Monaco Smart Barber</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
html,body{{height:100%}}
body{{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
 background:#0b1220;color:#0f172a;-webkit-font-smoothing:antialiased}}
.deck{{height:100vh;overflow-y:scroll;scroll-snap-type:y mandatory;scroll-behavior:smooth}}
.slide{{position:relative;width:100%;height:100vh;scroll-snap-align:start;
 display:flex;align-items:center;justify-content:center;overflow:hidden;color:#0f172a}}
.slide.dark{{color:#f1f5f9}}
.inner{{width:min(1080px,88vw);max-height:90vh;display:flex;flex-direction:column;justify-content:center;padding:18px 0}}
.kicker{{font-size:13px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;
 color:#3b82f6;margin-bottom:12px}}
.slide.dark .kicker{{color:#60a5fa}}
h1{{font-size:clamp(28px,4.4vw,52px);line-height:1.05;letter-spacing:-.02em;font-weight:800;margin:0}}
h2{{font-size:clamp(22px,3.3vw,40px);line-height:1.1;letter-spacing:-.02em;font-weight:800;margin:0}}
.hl{{color:#22c55e}} .hl-r{{color:#ef4444}}
.lead{{font-size:clamp(13px,1.5vw,18px);line-height:1.5;margin-top:13px;
 max-width:48ch;color:#334155}}
.slide.dark .lead{{color:#cbd5e1}}
.big{{font-size:clamp(80px,15vw,170px);font-weight:800;color:#ef4444;
 line-height:1;margin:18px 0 8px;letter-spacing:-.03em}}
.chips{{display:flex;gap:10px;flex-wrap:wrap;margin-top:30px}}
.chips span{{font-size:14px;font-weight:600;background:#1e293b;color:#e2e8f0;
 padding:8px 14px;border-radius:999px;border:1px solid #334155}}
.two{{display:flex;gap:18px;margin-top:30px}}
.card{{flex:1;padding:22px;border-radius:16px;font-size:20px;font-weight:700;text-align:center}}
.card small{{display:block;font-weight:500;opacity:.75;margin-top:6px;font-size:14px}}
.card.bad{{background:#3f1d1d;color:#fca5a5;border:1px solid #7f1d1d}}
.card.good{{background:#14321f;color:#86efac;border:1px solid #166534}}
.chart{{margin:13px 0;background:#0f1729;border:1px solid #1e293b;border-radius:16px;padding:14px;height:clamp(190px,40vh,330px);display:flex;flex-direction:column}}
.chart svg{{width:100%;flex:1;min-height:0;display:block}}
.chart .cap{{font-size:12px;color:#94a3b8;text-align:center;margin-top:6px;font-weight:600;letter-spacing:.01em;flex:0 0 auto}}
.metric-note{{font-size:clamp(12px,1.3vw,15px);line-height:1.42;background:#1e293b;
 border:1px solid #334155;border-left:4px solid #f59e0b;border-radius:0 12px 12px 0;
 padding:11px 16px;margin:10px 0 0;color:#e2e8f0;max-width:62ch}}
.metric-note b{{color:#fff}}
.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:30px 0}}
.k{{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:16px;padding:20px;text-align:center}}
.kv{{font-size:clamp(26px,3.4vw,40px);font-weight:800;color:#16a34a}}
.kl{{font-size:14px;font-weight:600;margin-top:6px;color:#334155}}
.kl small{{font-weight:500;color:#64748b}}
.lessons{{margin:24px 0 0 0;list-style:none;display:grid;gap:14px;max-width:46ch}}
.lessons li{{font-size:clamp(15px,1.8vw,20px);line-height:1.5;padding-left:34px;
 position:relative;color:#cbd5e1}}
.lessons li b{{color:#f1f5f9}}
.lessons li:before{{content:counter(li);counter-increment:li;position:absolute;left:0;top:0;
 width:24px;height:24px;background:#3b82f6;color:#fff;border-radius:7px;font-size:13px;
 font-weight:800;display:flex;align-items:center;justify-content:center}}
.lessons{{counter-reset:li}}
.sign{{margin-top:20px;font-size:15px;color:#94a3b8;font-weight:600}}
.logo{{height:46px;width:auto;display:block;align-self:flex-start;filter:invert(1)}}
.logo-lg{{height:74px}}
.pg{{position:absolute;bottom:22px;left:0;right:0;text-align:center;font-size:12px;
 color:#64748b;letter-spacing:.04em}}
.slide:not(.dark) .pg{{color:#94a3b8}}
.nav{{position:fixed;right:20px;top:50%;transform:translateY(-50%);display:flex;
 flex-direction:column;gap:10px;z-index:10}}
.nav button{{width:10px;height:10px;border-radius:50%;border:1.5px solid #64748b;
 background:transparent;cursor:pointer;padding:0}}
.nav button.on{{background:#3b82f6;border-color:#3b82f6;transform:scale(1.25)}}
.hint{{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);font-size:12px;
 color:#64748b;z-index:10;animation:fade 2.6s ease-in-out infinite}}
@keyframes fade{{0%,100%{{opacity:.35}}50%{{opacity:.9}}}}
@media print{{
 @page{{size:1280px 720px;margin:0}}
 html,body{{background:#0b1220;height:auto}}
 .deck{{height:auto;overflow:visible;scroll-snap-type:none;display:block}}
 .nav,.hint{{display:none}}
 .slide{{width:1280px;height:720px;overflow:hidden;break-after:page;page-break-after:always}}
 .slide:last-child{{break-after:auto;page-break-after:auto}}
 .inner{{width:1080px;max-height:none;padding:0}}
 .chart{{height:300px}}
}}
@media(max-width:760px){{.kpis{{grid-template-columns:repeat(2,1fr)}}.two{{flex-direction:column}}}}
</style></head><body>
<div class="deck" id="deck">{''.join(S)}</div>
<div class="nav">{dots}</div>
<div class="hint">↓ scroll · ←→ flechas</div>
<script>
var deck=document.getElementById('deck');
var slides=[].slice.call(document.querySelectorAll('.slide'));
var dots=[].slice.call(document.querySelectorAll('.nav button'));
function cur(){{var i=Math.round(deck.scrollTop/window.innerHeight);
 return Math.max(0,Math.min(slides.length-1,i));}}
function mark(){{var c=cur();dots.forEach(function(d,i){{d.classList.toggle('on',i===c);}});}}
deck.addEventListener('scroll',mark);mark();
dots.forEach(function(d){{d.onclick=function(){{
 slides[+d.getAttribute('data-i')].scrollIntoView();}};}});
addEventListener('keydown',function(ev){{
 if(['ArrowDown','ArrowRight',' ','PageDown'].indexOf(ev.key)>=0){{ev.preventDefault();
  var n=Math.min(slides.length-1,cur()+1);slides[n].scrollIntoView();}}
 if(['ArrowUp','ArrowLeft','PageUp'].indexOf(ev.key)>=0){{ev.preventDefault();
  var p=Math.max(0,cur()-1);slides[p].scrollIntoView();}}}});
</script></body></html>"""

out = os.path.join(HERE, "linkedin-fila-dinamica.html")
open(out, "w", encoding="utf-8").write(HTML)
print(f"OK -> {out} ({len(HTML)//1024} KB) · {NSL} slides · "
      f"pooling {RATIO}x · invA={[round(x) for x in INV_A]} · adopcion~{ad_pct}% · "
      f"P50 drop {p50_drop}%")

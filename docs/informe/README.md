# Informe de Ingeniería — Fila Dinámica

Análisis del sistema de fila dinámica con teoría de colas (M/G/c, Erlang),
cadenas de Markov, Ley de Little, teorema de pooling y validación Monte Carlo
sobre datos de producción. Audiencia: ingeniería y dirección.

## Entregables

| Archivo | Qué es |
|---|---|
| **`informe-fila-dinamica.html`** | Informe técnico **web interactivo** autocontenido (sin CDN). 3 sucursales (Paraná/Rondeau/Caseros). TOC con scrollspy, gráficos SVG, toggles (Erlang-C por nº de barberos, métricas Monte Carlo, heatmap y equidad por sucursal). |
| **`informe-fila-dinamica.pdf`** | Mismo informe técnico en **PDF** (apéndice expandido), para enviar/imprimir. |
| **`linkedin-fila-dinamica.html`** | Versión **LinkedIn**: deck narrativo de 9 slides (scroll-snap + teclado). Para presentar. |
| **`linkedin-fila-dinamica.pdf`** | Deck LinkedIn en **PDF 16:9, 9 páginas (1 slide = 1 página, 960×540 pt)** — formato ideal para *documento/carrusel* de LinkedIn. |
| `build_report.py` | Motor del informe técnico: lee `data.json` + `../sim/results.json`, calcula Erlang-B/C, G/G/c (Allen-Cunneen), Markov, Little, pooling; genera SVG y emite el HTML. Python puro (stdlib). |
| `build_linkedin.py` | Motor del deck LinkedIn (mismas fuentes, narrativa visual). Python puro (stdlib). |
| `data.json` | Datos reales auditados de producción (3 sucursales): servicio, llegadas, Poisson, espera, equidad, adopción, escala. Fuente única de verdad, reproducible. |

## Regenerar

```bash
cd docs/informe
python3 build_report.py                       # -> informe-fila-dinamica.html
python3 build_linkedin.py                     # -> linkedin-fila-dinamica.html (deck)
# PDF (macOS, Chrome instalado):
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=15000 \
  --print-to-pdf="informe-fila-dinamica.pdf" \
  "file://$PWD/informe-fila-dinamica.html?print=1"
```

Para actualizar los datos: re-correr las consultas de auditoría contra prod y
volcar los resultados en `data.json` (estructura documentada en el propio
archivo); `data.json` no contiene datos personales, solo agregados.

## Relación con el resto

- Spec del sistema: [`../fila-dinamica.md`](../fila-dinamica.md)
- Simulación Monte Carlo: [`../sim/fila_montecarlo.py`](../sim/fila_montecarlo.py) · `../sim/results.json`

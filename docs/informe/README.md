# Informe de Ingeniería — Fila Dinámica

Análisis del sistema de fila dinámica con teoría de colas (M/G/c, Erlang),
cadenas de Markov, Ley de Little, teorema de pooling y validación Monte Carlo
sobre datos de producción. Audiencia: ingeniería y dirección.

## Entregables

| Archivo | Qué es |
|---|---|
| **`informe-fila-dinamica.html`** | Informe **web interactivo** autocontenido (sin CDN). Abrir en cualquier navegador (doble clic) o servir como estático. TOC con scrollspy, gráficos SVG, toggles (Erlang-C por nº de barberos, métricas Monte Carlo). |
| **`informe-fila-dinamica.pdf`** | Mismo informe en **PDF** (8 págs, apéndice expandido), apto para enviar/imprimir. |
| `build_report.py` | Motor: lee `data.json` + `../sim/results.json`, calcula Erlang-B/C, G/G/c (Allen-Cunneen), Markov, Little, pooling, genera los SVG y emite el HTML. Python puro (solo stdlib). |
| `data.json` | Datos reales auditados de producción (servicio, llegadas, espera, patrones). Fuente única de verdad, reproducible. |

## Regenerar

```bash
cd docs/informe
python3 build_report.py                       # -> informe-fila-dinamica.html
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

"""Busca cortes rectos en los cuadros de los atlas: bordes horizontales o verticales largos y
perfectos, dentro del cuadro o en su borde (una cabeza cortada por la barra del título, una pierna
partida por un corte entre cuadros, un rectángulo que un «excluir» se llevó de más).

Uso (desde MonacoSmartBarber/): python3 scripts/juego/revision/cortes.py . <id> [<id> ...]
Imprime los cuadros sospechosos con el largo del borde recto: hay que mirarlos (una espalda o un
piso recto de 16-25 px puede ser del dibujo; 30 px o más casi siempre es un corte).
"""
import json, re, sys
from pathlib import Path
import numpy as np
from PIL import Image
repo = Path(sys.argv[1]); ids = sys.argv[2:]
CLAVES = ['quieto','caminar','correr','dash','guardia','agachado','saltar','caer','golpe','patada','combo','herramienta1','herramienta2','especial1','especial2','danio','ko','levantarse','victoria','burla']
def runs(b):
    # largo del tramo True más largo
    best = cur = 0
    for v in b:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best
def analizar(al):
    op = al > 160
    tr = al < 25
    h, w = op.shape
    pad = np.zeros((h + 2, w + 2), bool); pad[1:-1, 1:-1] = op
    vac = np.ones((h + 2, w + 2), bool); vac[1:-1, 1:-1] = tr
    hallazgos = []
    # bordes horizontales: opaco en y, vacío en y-1 (arriba) o y+1 (abajo), y opaco 3 px hacia adentro
    for y in range(1, h + 1):
        if y > h - 6: continue  # suelas
        up = pad[y] & vac[y - 1] & pad[min(y + 2, h)]
        dn = pad[y] & vac[y + 1] & pad[max(y - 2, 1)]
        for nombre, fila in (('techo', up), ('piso', dn)):
            r = runs(fila)
            if r >= 16: hallazgos.append((r, f'{nombre} recto {r}px en y={y-1}'))
    for x in range(1, w + 1):
        col_l = pad[:, x] & vac[:, x - 1] & pad[:, min(x + 2, w)]
        col_r = pad[:, x] & vac[:, x + 1] & pad[:, max(x - 2, 1)]
        for nombre, col in (('pared izq', col_l), ('pared der', col_r)):
            r = runs(col[: h - 4])
            if r >= 22: hallazgos.append((r, f'{nombre} recta {r}px en x={x-1}'))
    hallazgos.sort(reverse=True)
    return [t for _, t in hallazgos[:3]]
for pid in ids:
    base = repo / 'public/juego/personajes' / pid
    at = json.loads((base / 'atlas.json').read_text())
    img = Image.open(base / at['imagen']).convert('RGBA')
    A = np.array(img)[:, :, 3]
    vistos = {}
    for k in CLAVES:
        for i, c in enumerate(at['animaciones'][k]['cuadros']):
            key = (c['x'], c['y'], c['w'], c['h'])
            if key in vistos: continue
            al = A[c['y']:c['y'] + c['h'], c['x']:c['x'] + c['w']]
            r = analizar(al)
            vistos[key] = f'{k}[{i}]'
            if r: print(f'{pid} {k}[{i}] ({c["w"]}x{c["h"]}): ' + '; '.join(r))

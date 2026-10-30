#!/usr/bin/env python3
"""Hoja de revisión de TODOS los cuadros de un luchador, a la escala del juego.

Uso: python3 cuadros.py <repo> <salida> [ids...]

Por cada animación, una fila con sus cuadros apoyados en la misma línea de piso (verde), la línea
de la cabeza a alturaMundo (celeste) y el apoyo (ax) como raya vertical. Fondo gris medio: así se
ven los restos de fondo negro, las sombras y los halos. Además corre chequeos automáticos:
  - manchas sueltas (componentes separadas del cuerpo: pedazos del vecino, chispas, humo),
  - bordes rectos (muchos píxeles opacos sobre un borde del cuadro: miembro cortado),
  - alias (cuadros que repiten el rectángulo de otra animación),
  - altura del cuerpo por animación contra «quieto» (saltos de escala).
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

CLAVES = ['quieto', 'caminar', 'correr', 'dash', 'guardia', 'agachado', 'saltar', 'caer',
          'golpe', 'patada', 'combo', 'herramienta1', 'herramienta2', 'especial1', 'especial2',
          'danio', 'ko', 'levantarse', 'victoria', 'burla']
DE_PIE = {'quieto', 'caminar', 'correr', 'guardia', 'golpe', 'herramienta1', 'danio', 'victoria', 'burla'}

FONDO = (138, 143, 152)
CELDA_FONDO = (128, 133, 142)
PISO = (60, 220, 120)
CABEZA = (90, 200, 255)


def fuente(tam):
    for f in ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc']:
        try:
            return ImageFont.truetype(f, tam)
        except OSError:
            pass
    return ImageFont.load_default()


def alturas_mundo(repo: Path):
    t = (repo / 'src/lib/juego/personajes.ts').read_text()
    out = {}
    for m in re.finditer(r"\n  ([a-z_]+): \{\n    id: '([a-z_]+)',[\s\S]*?alturaMundo: (\d+)", t):
        out[m.group(2)] = int(m.group(3))
    return out


def analizar(alfa: np.ndarray):
    """Componentes conexas (alfa > 40) y bordes rectos."""
    m = alfa > 40
    etiquetas, n = ndimage.label(m, structure=np.ones((3, 3)))
    avisos = []
    if n > 1:
        tam = ndimage.sum(m, etiquetas, range(1, n + 1))
        principal = int(np.argmax(tam)) + 1
        total = float(tam.sum())
        # distancia de cada mancha al cuerpo principal
        dist = ndimage.distance_transform_edt(etiquetas != principal)
        for k in range(1, n + 1):
            if k == principal:
                continue
            px = float(tam[k - 1])
            if px < 6:
                continue
            d = float(dist[etiquetas == k].min())
            if px >= 25 or (px >= 10 and d > 6):
                ys, xs = np.nonzero(etiquetas == k)
                avisos.append(f'mancha {int(px)}px a {d:.0f}px ({xs.min()},{ys.min()})')
    h, w = m.shape
    fuerte = alfa > 200
    bordes = {'arriba': fuerte[0, :].sum(), 'izq': fuerte[:, 0].sum(), 'der': fuerte[:, -1].sum()}
    for lado, cant in bordes.items():
        lim = 9 if lado == 'arriba' else 14
        if cant >= lim:
            avisos.append(f'borde {lado} recto ({int(cant)}px)')
    return avisos


def hoja(repo: Path, salida: Path, pid: str, altura_mundo: int, escala_vista=1.0):
    base = repo / 'public/juego/personajes' / pid
    atlas = json.loads((base / 'atlas.json').read_text())
    img = Image.open(base / atlas['imagen']).convert('RGBA')
    ref = atlas['alturaReferencia']
    s = altura_mundo / ref * escala_vista
    anims = atlas['animaciones']
    # rectángulos → animaciones que los usan (alias)
    usos = {}
    for k in CLAVES:
        for i, c in enumerate(anims[k]['cuadros']):
            usos.setdefault((c['x'], c['y'], c['w'], c['h']), []).append(f'{k}[{i}]')
    # tamaño de celda
    max_w = 0
    max_arriba = 0
    max_abajo = 0
    for k in CLAVES:
        for c in anims[k]['cuadros']:
            izq = c['ax'] * s
            der = (c['w'] - c['ax']) * s
            max_w = max(max_w, 2 * max(izq, der))
            max_arriba = max(max_arriba, c['ay'] * s)
            max_abajo = max(max_abajo, (c['h'] - c['ay']) * s)
    cw = int(min(max_w, 360) + 16)
    ch = int(max(max_arriba, altura_mundo * escala_vista) + max_abajo + 34)
    cols = max(len(anims[k]['cuadros']) for k in CLAVES)
    etiqueta_w = 118
    W = etiqueta_w + cols * cw
    H = len(CLAVES) * ch + 40
    hojaimg = Image.new('RGB', (W, H), FONDO)
    d = ImageDraw.Draw(hojaimg)
    f_chica = fuente(12)
    f_media = fuente(15)
    d.text((8, 10), f'{pid}  ·  alturaMundo {altura_mundo}  ·  ref {ref}  ·  escala {s:.3f}  ·  {atlas["imagen"]} {img.size[0]}x{img.size[1]}',
           fill=(255, 255, 255), font=f_media)
    informe = []
    alturas = {}
    for fila, k in enumerate(CLAVES):
        a = anims[k]
        y0 = 40 + fila * ch
        piso_y = y0 + ch - int(max_abajo) - 22
        d.text((8, y0 + 8), k, fill=(255, 255, 255), font=f_media)
        d.text((8, y0 + 28), f"{len(a['cuadros'])} cuadros", fill=(230, 230, 230), font=f_chica)
        if a.get('impactos'):
            d.text((8, y0 + 44), f"imp {a['impactos']}", fill=(255, 120, 120), font=f_chica)
        hs = []
        for i, c in enumerate(a['cuadros']):
            x0 = etiqueta_w + i * cw
            d.rectangle([x0 + 2, y0 + 2, x0 + cw - 3, y0 + ch - 3], fill=CELDA_FONDO)
            recorte = img.crop((c['x'], c['y'], c['x'] + c['w'], c['y'] + c['h']))
            alfa = np.array(recorte.split()[-1])
            avisos = analizar(alfa)
            # alto del cuerpo (filas con algo opaco)
            filas = np.nonzero((alfa > 100).any(axis=1))[0]
            alto = (c['ay'] - filas.min()) * s / escala_vista if len(filas) else 0
            hs.append(alto)
            nw, nh = max(1, round(c['w'] * s)), max(1, round(c['h'] * s))
            esc = recorte.resize((nw, nh), Image.LANCZOS)
            cx = x0 + cw // 2
            px = int(round(cx - c['ax'] * s))
            py = int(round(piso_y - c['ay'] * s))
            hojaimg.paste(esc, (px, py), esc)
            # guías
            d.line([x0 + 4, piso_y, x0 + cw - 5, piso_y], fill=PISO, width=1)
            yc = piso_y - int(altura_mundo * escala_vista)
            for xx in range(x0 + 4, x0 + cw - 5, 6):
                d.line([xx, yc, xx + 2, yc], fill=CABEZA)
            for yy in range(y0 + 4, y0 + ch - 4, 6):
                d.line([cx, yy, cx, yy + 1], fill=(200, 200, 200))
            otros = [u for u in usos[(c['x'], c['y'], c['w'], c['h'])] if not u.startswith(k + '[')]
            col = (255, 90, 90) if i in a.get('impactos', []) else (255, 255, 255)
            d.text((x0 + 6, y0 + ch - 19), f"{i}{' IMP' if i in a.get('impactos', []) else ''}  {alto:.0f}",
                   fill=col, font=f_chica)
            if otros:
                d.text((x0 + 6, y0 + 6), '= ' + ', '.join(otros[:2]), fill=(255, 235, 120), font=f_chica)
            if avisos:
                d.rectangle([x0 + 2, y0 + 2, x0 + cw - 3, y0 + ch - 3], outline=(255, 60, 200), width=2)
                for j, av in enumerate(avisos[:3]):
                    d.text((x0 + 6, y0 + 22 + j * 14), av, fill=(255, 80, 210), font=f_chica)
                informe.append(f'{pid} {k}[{i}]: ' + '; '.join(avisos))
        alturas[k] = hs
    ref_q = float(np.median(alturas['quieto'])) if alturas['quieto'] else 1
    for k in CLAVES:
        if k in DE_PIE and alturas[k]:
            med = float(np.median(alturas[k]))
            if abs(med / ref_q - 1) > 0.09:
                informe.append(f'{pid} {k}: alto mediano {med:.0f} contra quieto {ref_q:.0f} ({(med / ref_q - 1) * 100:+.0f} %)')
    efectos = atlas.get('efectos') or {}
    if efectos:
        informe.append(f"{pid} efectos: " + ', '.join(f"{n} {v['cuadros'][0]['w']}x{v['cuadros'][0]['h']}" for n, v in efectos.items()))
    salida.mkdir(parents=True, exist_ok=True)
    destino = salida / f'cuadros_{pid}.png'
    hojaimg.save(destino, optimize=True)
    return destino, informe, {k: [round(x) for x in v] for k, v in alturas.items()}


def main():
    repo = Path(sys.argv[1])
    salida = Path(sys.argv[2])
    ids = sys.argv[3:]
    am = alturas_mundo(repo)
    if not ids:
        ids = list(am.keys())
    todo = []
    for pid in ids:
        destino, informe, alturas = hoja(repo, salida, pid, am[pid])
        todo.extend(informe)
        print(destino)
        print('  alturas:', json.dumps({k: alturas[k] for k in ['quieto', 'caminar', 'golpe', 'danio', 'victoria', 'burla']}))
        for linea in informe:
            print('  ' + linea)
    (salida / 'cuadros_informe.txt').write_text('\n'.join(todo) + '\n')


if __name__ == '__main__':
    main()

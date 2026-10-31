#!/usr/bin/env python3
"""
Pasa a WebP SIN pérdida los PNG de un barbero de «Corte Final» (atlas.png y rapado.png de
public/juego/personajes/<id>/) y deja su JSON apuntando al .webp.

Por qué existe: extraer_sprites.py (el que arma los atlas de Simón y de Chipi) y generar_rapado.py
escriben PNG y son compartidos: NO se editan (ver juego.md). Desde el 30/oct/2026 los 13 atlas y
los rapados de Simón y Chipi van en WebP sin pérdida (≈ 30 % menos). Después de correr
extraer_simon.py, extraer_chipi.py o generar_rapado.py, correr esto: si no, vuelve el PNG (más
pesado) y el .webp queda huérfano en el deploy.

  cd MonacoSmartBarber && python3 scripts/juego/webp_sin_perdida.py simon chipi

Para cada PNG prueba varias codificaciones (Pillow con method 4, 5 y 6 y, si está instalado, cwebp
-z 6 y -z 9), siempre con exact: el RGB que queda bajo alfa 0 entra en el md5 de las huellas de
generar_rapado.py y tiene que seguir igual. Se queda con la más chica de las que, decodificadas,
dan EXACTAMENTE el mismo RGBA que el PNG; si ninguna da idéntico, deja el PNG y sale con 1. En el
JSON cambia sólo el valor de "imagen" (el resto del archivo queda igual byte a byte) y borra el
PNG. Un barbero que ya no tiene PNG no se toca.

  --carpeta <dir>   otra carpeta de personajes (por defecto, la de public/ de este repo)
  --probar          mide y verifica, pero no escribe nada
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
PERSONAJES = os.path.normpath(os.path.join(AQUI, '..', '..', 'public', 'juego', 'personajes'))
# (json, png) de cada barbero: el atlas y, si tiene, el rapado del remate «¡AL CERO!».
PARES = (('atlas.json', 'atlas.png'), ('rapado.json', 'rapado.png'))


def rgba(ruta):
    im = Image.open(ruta)
    im.load()
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    return np.asarray(im)


def candidatos(png, trabajo, base):
    """Las codificaciones a probar (todas sin pérdida y con exact)."""
    out = []
    im = Image.open(png)
    im.load()
    for metodo in (4, 5, 6):
        r = os.path.join(trabajo, f'{base}_pil_m{metodo}.webp')
        im.save(r, 'WEBP', lossless=True, quality=100, method=metodo, exact=True)
        out.append(r)
    if shutil.which('cwebp'):
        for z in (6, 9):
            r = os.path.join(trabajo, f'{base}_cwebp_z{z}.webp')
            subprocess.run(['cwebp', '-quiet', '-lossless', '-z', str(z), '-exact', '-metadata', 'none', png, '-o', r],
                           check=True)
            out.append(r)
    return out


def convertir(carpeta, pid, nombre_json, nombre_png, trabajo, probar):
    """True si convirtió (o, con --probar, si se puede convertir); None si no había PNG; False si falló."""
    png = os.path.join(carpeta, pid, nombre_png)
    ruta_json = os.path.join(carpeta, pid, nombre_json)
    if not os.path.exists(png):
        return None
    if not os.path.exists(ruta_json):
        print(f'{pid}/{nombre_png}: está el PNG pero no {nombre_json}; no se toca', file=sys.stderr)
        return False
    original = rgba(png)
    pruebas = []
    for r in candidatos(png, trabajo, f'{pid}_{nombre_png[:-4]}'):
        igual = np.array_equal(rgba(r), original)
        pruebas.append((os.path.getsize(r), r, igual))
    buenas = sorted(p for p in pruebas if p[2])
    if not buenas:
        print(f'{pid}/{nombre_png}: ninguna codificación dio idéntica; queda el PNG', file=sys.stderr)
        return False
    tam, mejor, _ = buenas[0]
    antes = os.path.getsize(png)
    print(f'{pid}/{nombre_png}: {antes / 1024:.1f} KB -> {tam / 1024:.1f} KB '
          f'({100 * (1 - tam / antes):.1f} % menos, {os.path.basename(mejor)})')
    if probar:
        return True
    texto = open(ruta_json, encoding='utf-8').read()
    nuevo_nombre = nombre_png[:-4] + '.webp'
    nuevo, n = re.subn(r'("imagen"\s*:\s*")' + re.escape(nombre_png) + '"',
                       lambda m: m.group(1) + nuevo_nombre + '"', texto, count=1)
    if n != 1:
        print(f'{pid}: {nombre_json} no dice "imagen": "{nombre_png}"; no se toca', file=sys.stderr)
        return False
    json.loads(nuevo)
    destino = os.path.join(carpeta, pid, nuevo_nombre)
    shutil.copyfile(mejor, destino)
    if not np.array_equal(rgba(destino), original):  # verificación final sobre el archivo que queda
        os.remove(destino)
        print(f'{pid}/{nuevo_nombre}: el archivo copiado no dio idéntico; queda el PNG', file=sys.stderr)
        return False
    with open(ruta_json, 'w', encoding='utf-8') as f:
        f.write(nuevo)
    os.remove(png)
    print(f'  {pid}/{nombre_json} -> "{nuevo_nombre}", borrado {nombre_png}')
    return True


def main():
    ap = argparse.ArgumentParser(description='PNG de los barberos a WebP sin pérdida')
    ap.add_argument('ids', nargs='+', help='ids de los barberos (simon, chipi, …)')
    ap.add_argument('--carpeta', default=PERSONAJES)
    ap.add_argument('--probar', action='store_true')
    args = ap.parse_args()
    fallas = 0
    with tempfile.TemporaryDirectory(prefix='cf-webp-') as trabajo:
        for pid in args.ids:
            hechos = [convertir(args.carpeta, pid, j, p, trabajo, args.probar) for j, p in PARES]
            fallas += sum(1 for h in hechos if h is False)
            if all(h is None for h in hechos):
                print(f'{pid}: sin PNG (ya está en WebP)')
    sys.exit(1 if fallas else 0)


if __name__ == '__main__':
    main()

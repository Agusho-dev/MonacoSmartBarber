#!/usr/bin/env python3
"""Lámina de revisión de un luchador: las capturas de la pelea real en horizontal (844x390) y en
vertical (390x844) más la hoja de todos sus cuadros a la escala del juego.

Uso: python3 lamina.py <carpeta_peleas> <carpeta_cuadros> <salida> <id> [<id> ...]
  carpeta_peleas tiene 844x390/ y 390x844/ con <id>_NN_<momento>.png y <id>.json (pelea-revision.mjs)
  carpeta_cuadros tiene cuadros_<id>.png (cuadros.py)
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ANCHO = 1720
FONDO = (18, 19, 24)


def fuente(t):
    return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', t)


def capturas(carpeta: Path, pid: str):
    return sorted(carpeta.glob(f'{pid}_[0-9][0-9]_*.png'))


def recorte_horizontal(im):
    # el canvas va 16:9 al centro (franjas negras a los costados): se recorta a la franja del juego
    w, h = im.size
    canvas_w = int(h * 16 / 9)
    x0 = max(0, (w - canvas_w) // 2)
    return im.crop((x0, 0, min(w, x0 + canvas_w), h))


def recorte_vertical(im):
    # HUD + canvas (la mitad de arriba); los controles quedan afuera
    w, h = im.size
    return im.crop((0, 0, w, int(h * 0.42)))


def grilla(archivos, cols, recorte, titulo, pid):
    f = fuente(15)
    tiles = []
    for a in archivos:
        im = recorte(Image.open(a).convert('RGB'))
        tw = (ANCHO - 8 - (cols - 1) * 6) // cols
        th = int(im.height * tw / im.width)
        t = im.resize((tw, th), Image.LANCZOS)
        d = ImageDraw.Draw(t)
        nombre = a.stem[len(pid) + 4:]
        d.rectangle([0, 0, 8 + len(nombre) * 9, 20], fill=(0, 0, 0))
        d.text((4, 2), nombre, fill=(255, 214, 90), font=f)
        tiles.append(t)
    if not tiles:
        return None
    th = max(t.height for t in tiles)
    filas = (len(tiles) + cols - 1) // cols
    cab, detalle = (titulo.split(' · ', 3)[:3], titulo.split(' · ', 3)[3:])
    out = Image.new('RGB', (ANCHO, 56 + filas * (th + 6)), FONDO)
    d = ImageDraw.Draw(out)
    d.text((6, 4), ' · '.join(cab), fill=(255, 255, 255), font=fuente(19))
    d.text((6, 30), ' · '.join(detalle)[:190], fill=(200, 205, 215), font=fuente(14))
    for i, t in enumerate(tiles):
        out.paste(t, (4 + (i % cols) * (t.width + 6), 56 + (i // cols) * (th + 6)))
    return out


def resumen(datos):
    if not datos:
        return 'sin datos'
    r = datos.get('rendimiento') or {}
    partes = [f"{r.get('fps', '?')} fps (p95 {r.get('p95ms', '?')} ms)"]
    for e in datos.get('especiales', []):
        partes.append(f"especial {e['k']}: {'flash' if e.get('flash') else 'SIN flash'}, {e.get('fuentesAudio', 0)} fuentes de audio")
    cons = [c for c in datos.get('consola', []) if 'rapado' not in c]
    partes.append(f"consola: {len(cons)} errores ajenos al rapado" if cons else 'consola: sólo el 404 conocido del rapado')
    faltan = [k for k, v in (datos.get('momentos') or {}).items() if v == 'NO SE VIO']
    if faltan:
        partes.append('sin captura: ' + ', '.join(faltan))
    return ' · '.join(partes)


def main():
    peleas, cuadros, salida = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    salida.mkdir(parents=True, exist_ok=True)
    for pid in sys.argv[4:]:
        bloques = []
        datos = {}
        for tam, cols, rec in (('844x390', 4, recorte_horizontal), ('390x844', 6, recorte_vertical)):
            carpeta = peleas / tam
            j = carpeta / f'{pid}.json'
            datos[tam] = json.loads(j.read_text()) if j.exists() else None
            rival = (datos[tam] or {}).get('rival', '?')
            g = grilla(capturas(carpeta, pid), cols, rec, f'Pelea real contra la CPU · {tam} · contra {rival} · {resumen(datos[tam])}', pid)
            if g:
                bloques.append(g)
        hoja = cuadros / f'cuadros_{pid}.png'
        if hoja.exists():
            im = Image.open(hoja).convert('RGB')
            if im.width > ANCHO:
                im = im.resize((ANCHO, int(im.height * ANCHO / im.width)), Image.LANCZOS)
            cab = Image.new('RGB', (ANCHO, 34), FONDO)
            ImageDraw.Draw(cab).text((6, 6), 'Todos los cuadros del atlas a la escala del juego (verde = piso, celeste = alturaMundo, rojo = impacto, amarillo = alias)', fill=(255, 255, 255), font=fuente(19))
            bloques += [cab, im]
        titulo = Image.new('RGB', (ANCHO, 54), (36, 30, 60))
        ImageDraw.Draw(titulo).text((10, 10), f'Corte Final · revisión visual · {pid}', fill=(255, 255, 255), font=fuente(28))
        bloques.insert(0, titulo)
        H = sum(b.height for b in bloques) + 8 * len(bloques)
        lam = Image.new('RGB', (ANCHO, H), FONDO)
        y = 0
        for b in bloques:
            lam.paste(b, (0, y))
            y += b.height + 8
        destino = salida / f'{pid}.png'
        lam.save(destino, optimize=True)
        print(destino, lam.size)


if __name__ == '__main__':
    main()

"""
El logo de Monaco de la portada de «Corte Final» (public/juego/logo-monaco.webp), transparente,
a partir del logo de la marca sobre su fondo gris (public/logo-monaco.png, 1080×1080, #3c3c3c).

    python3 scripts/juego/logo_monaco.py public/logo-monaco.png public/juego/logo-monaco.webp [--revision /tmp/revision.png]

Cada píxel se separa en «blanco más rojo sobre el gris» (mínimos cuadrados con los dos colores
de la marca), así los bordes suavizados quedan con su alfa justo y sin halo gris sobre el
fondo negro del juego. Recorta con 6 px de margen y reescala a 720 px de ancho en alfa
premultiplicado (sin bordes claros). WebP sin pérdida (≈ 27 KB). El 30/oct/2026 salió idéntico
byte a byte al del repo.

La imagen de revisión (sobre fondo transparente) va sólo si se pide y NUNCA dentro de public/.
Requiere numpy y Pillow.
"""
import argparse

import numpy as np
from PIL import Image

FONDO = np.array([60.0, 60.0, 60.0])
BLANCO = np.array([255.0, 255.0, 255.0])
ROJO = np.array([189.0, 21.0, 46.0])
ANCHO = 720
MARGEN = 6


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('origen')
    ap.add_argument('destino')
    ap.add_argument('--revision', help='PNG para mirar el resultado (fuera de public/)')
    args = ap.parse_args()

    a = np.asarray(Image.open(args.origen).convert('RGB')).astype(np.float64)
    d = a - FONDO
    m = np.stack([BLANCO - FONDO, ROJO - FONDO], axis=1)  # 3x2
    # numpy 2.0 con Accelerate (macOS) avisa «divide by zero» en matmul sin motivo: el resultado es finito.
    with np.errstate(divide='ignore', over='ignore', invalid='ignore'):
        coef = d @ np.linalg.pinv(m).T  # (alto, ancho, 2): peso del blanco y del rojo
    pb = np.clip(coef[..., 0], 0, None)
    pr = np.clip(coef[..., 1], 0, None)
    alfa = np.clip(pb + pr, 0, 1)
    suma = pb + pr
    peso_rojo = np.where(suma > 1e-6, pr / np.maximum(suma, 1e-6), 0)
    color = BLANCO[None, None, :] * (1 - peso_rojo[..., None]) + ROJO[None, None, :] * peso_rojo[..., None]
    error = np.abs(FONDO + alfa[..., None] * (color - FONDO) - a).max(axis=2)
    print('error de reconstrucción: máximo %.1f, p99,9 %.1f niveles' % (error.max(), np.percentile(error, 99.9)))

    alfa[alfa < 2 / 255] = 0
    rgba = np.dstack([color, alfa * 255]).round().clip(0, 255).astype(np.uint8)
    im = Image.fromarray(rgba)  # alto × ancho × 4 en uint8: RGBA
    ys, xs = np.where(alfa > 0)
    caja = (
        int(max(0, xs.min() - MARGEN)),
        int(max(0, ys.min() - MARGEN)),
        int(min(a.shape[1], xs.max() + 1 + MARGEN)),
        int(min(a.shape[0], ys.max() + 1 + MARGEN)),
    )
    im = im.crop(caja)
    alto = round(im.size[1] * ANCHO / im.size[0])
    im = im.convert('RGBa').resize((ANCHO, alto), Image.LANCZOS).convert('RGBA')
    im.save(args.destino, 'WEBP', lossless=True, quality=100, method=6)
    if args.revision:
        im.save(args.revision)
    print('recorte', caja, '→', im.size)


if __name__ == '__main__':
    main()

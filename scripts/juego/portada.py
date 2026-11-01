#!/usr/bin/env python3
"""
Retrato de cuerpo entero de un barbero de «Corte Final» a partir de la «portada» en pixel art que mandó
el dueño: juego-fuentes/<id>_retrato.png (o .jpg) → public/juego/personajes/<id>/retrato.webp.

    python3 scripts/juego/portada.py <id> [<id> ...] [--cara] [--alto 1080] [--revision <carpeta FUERA de public/>]

Sin modelo y sin candado: tarda 1–5 s por barbero y sale igual byte a byte en cada corrida (misma
fuente, mismo Pillow). Requiere numpy, scipy y Pillow.

Por qué así (31/oct/2026, portadas de Fabri, Luciano y Nico U.):
  - Las portadas son JPG de 1122×1402 con el fondo a cuadros gris y blanco DIBUJADO (no es
    transparencia: blanco ≈ 252 y gris ≈ 234, cuadros de ≈ 15–16 px) y un contorno negro alrededor de
    todo el personaje. Zapatillas, medias, el texto MONACO, la pipa de Nike, las cuchillas de la
    máquina y los brillos son tan claros como el damero, pero quedan ADENTRO del contorno. Por eso el
    fondo sale con una inundación desde el borde de la imagen que sólo avanza por píxeles claros y
    neutros y frena en el contorno (oscuro, con sus huecos de hasta ≈ 4 px tapados por un cierre
    morfológico y conectividad de 4, para que no se cuele en diagonal entre dos escalones). rembg
    (isnet) se probó como control y es peor acá: se come la media y la suela blancas de Nico U. y las
    cuchillas de las máquinas, y deja el hilo claro del borde y los asomos chicos del damero.
  - Hay fondo ENCERRADO (entre el brazo y el cuerpo) que la inundación no alcanza. Una mancha clara y
    neutra encerrada es fondo si el damero del fondo de alrededor (período y fase ajustados ahí) la
    explica (r² ≥ 0,1 y error mediano ≤ 6); el metal de la máquina, las hebillas o el peine no lo
    cumplen (r² negativo). Los asomos chicos del damero (< 120 px) no se pueden decidir así: van a mano
    en AJUSTES, con su punto en px de la fuente.
  - El JPG deja ≈ 1 px de transición entre el damero y el contorno: con alfa duro queda un hilo gris
    alrededor del personaje (se ve sobre el fondo oscuro del juego). Esa franja se separa en «contorno
    + fondo»: alfa = cuánto contorno tiene, color = el del contorno más cercano. Sin halo claro.
  - Las manchitas claras (≤ 60 px) pegadas al borde y rodeadas de contorno o pelo son restos del damero
    y van al fondo (los dientes de la máquina, igual de claros y chicos, quedan a 5 px o más del borde).
  - Recorte al cuerpo con margen chico arriba y a los costados y los pies abajo (la UI apoya el retrato
    abajo: `object-position: center bottom`).
  - Tamaño: 1080 px de alto. En un celular el retrato se dibuja a ≈ 160–230 px CSS (resultado), 190–330
    (ficha grande de «Elegí tu barbero»), 330–440 (portada del juego) y 310–500 (VS; el máximo, en
    vertical); por 3 de densidad son 480–1500 px. Los 720 de los retratos de antes alcanzan para la selección y el
    resultado pero en el VS y la portada el navegador los agranda ×1,6–1,9 y el pixel art se ablanda;
    1080 queda nítido en todas (como mucho ×1,25 en el VS vertical) y pesa ≈ 85 KB. Con --alto 720
    sale como los demás (≈ 55 KB).
  - Escala: Lanczos con el color extendido hacia afuera del contorno (el fondo nunca se mezcla en el
    borde) y el alfa aparte. El dibujo NO tiene una grilla única (el «píxel» mide de 8 a 12 px según
    la zona y la fase se corre), así que ningún factor la respeta en todo el cuerpo: reducir a 4–6 px
    por píxel del dibujo salió más blando y con los mismos escalones.
  - Formato: WebP con pérdida, calidad 90 y alfa sin pérdida, como los retratos de los otros 13 (la
    fuente es un JPG: sin pérdida pesaba 4 veces más y guardaba el ruido del JPG).
  - Orientación: la imagen va como vino (la máquina hacia la izquierda, como Simón y Chipi) y NO se
    espeja: el texto de la remera de Fabri y la gorra de Nico U. no se pueden dar vuelta. La UI espeja
    el retrato del jugador (portada, VS, resultado, elección online) y el del rival en la ficha
    acostada, salvo que la ficha tenga `retratoFijo` (personajes.ts): todo barbero con portada lo lleva.

Las portadas PNG (1/nov/2026: Brian, Guillermo, Lucas, Nahuel, Gabriel, Rodrigo, Stefano y Chino, de
1024×1536) ya traen la transparencia: el dibujo tiene alfa ≈ 253 y el fondo 0, y en algunas (Lucas,
Rodrigo, Stefano) el RGB del fondo transparente guarda un degradé con un resplandor naranja que no se
ve. Sin damero que separar: el alfa se lleva a 255, se borran las motas sueltas (manchas de menos de
MOTA px separadas del cuerpo) y pasan por el mismo recorte y la misma escala, que reemplaza el color
de afuera del contorno por el del borde (así el resplandor escondido no entra al escalar). Si
existen las dos fuentes de un barbero, manda el PNG.

OJO: los extractores con --retrato (o --solo retrato) reescriben retrato.webp desde un cuadro de la
hoja y pisan la portada: después de correrlos con esa opción, volver a correr este script con los
barberos que tienen portada (con --cara).

Con --cara escribe también cara.webp (la grilla de «Elegí tu barbero», la barra VOS/RIVAL, el HUD y la
banda del especial), 256×256 como las de siempre: el dueño (1/nov) quiso las caras chicas en el mismo
estilo que la portada. El cuadrado se mide desde la mancha de piel de la cara (la más grande y centrada
de la parte de arriba): su ancho da el tamaño (CARA_LADO) y su borde de arriba la altura (CARA_ARRIBA);
lo que no salga bien solo va en CARA_AJUSTES. Los extractores con --retrato también reescriben
cara.webp desde la hoja.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

AQUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(AQUI))
FUENTES = os.path.join(os.path.dirname(REPO), 'juego-fuentes')

ALTO = 1080            # px del retrato (ver «Tamaño» arriba)
CALIDAD = 90           # WebP con pérdida, como los retratos de los otros barberos
MARGEN = 0.012         # margen arriba y a los costados, en fracción del alto (abajo, 0: pies abajo)

# Damero y contorno (valores de la fuente, 0..255)
CLARO = 205            # el canal más bajo de un píxel del damero (gris ≈ 234 y blanco ≈ 252, ± JPG)
NEUTRO = 20            # máx − mín de un píxel del damero (es gris puro)
OSCURO = 110           # el contorno: luminancia menor que esto
CIERRE = 2             # radio del cierre que tapa los huecos del contorno (hasta ≈ 4 px)
NUCLEO = 50            # el negro del contorno (de él sale el color de la franja)
FRANJA = 2.5           # px de transición del JPG entre el damero y el contorno
HUECO_AREA = 120       # una mancha encerrada más chica no se puede probar contra el damero (va a mano)
MANCHA_AREA = 60       # restos del damero pegados al borde, metidos en el contorno o el pelo

# Portadas PNG con transparencia
ALFA_DIBUJO = 253      # el alfa con que vienen los píxeles del dibujo (se lleva a 255)
MOTA = 200             # manchas sueltas más chicas que esto (px de la fuente) se borran; las de hoy, ≤ 14

# La cara (cara.webp, con --cara): un cuadrado de CARA px medido desde la mancha de la cara y el cuello
CARA = 256             # como las caras de siempre
CARA_LADO = 2.0        # el lado del cuadrado, en anchos de la mancha de la cara (el alto varía: a
                       # veces suma el cuello o una mano, y en Rodrigo los lentes la cortan)
CARA_ARRIBA = 0.55     # cuánto pelo o gorra entra arriba de la frente, en anchos de la mancha
# Corrimientos (dx, dy en fracción del lado) y escala del cuadrado, por barbero, si hace falta.
CARA_AJUSTES = {
    # la mancha de Luciano suma la mano de la máquina: sin esto queda medio cuerpo
    'luciano': (0.0, 0.0, 0.85),
}

# Lo que no sale solo, en px de la fuente.
#   huecos: un punto adentro de un asomo chico del damero (fondo encerrado de menos de HUECO_AREA px)
AJUSTES = {
    # entre el pulgar de la mano de la máquina y la remera (20 px)
    'fabri': {'huecos': [(397, 432)]},
    # entre la mano de la máquina y la manga (79 px); el cuadrado blanco de la oreja es el arito (no va)
    'luciano': {'huecos': [(353, 564)]},
}

CRUZ = ndimage.generate_binary_structure(2, 1)
OCHO = np.ones((3, 3), bool)


def _disco(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r + r


def _luminancia(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def _damero_explica(lum_c, ys_c, xs_c, lum_f, ys_f, xs_f):
    """Ajusta un damero de dos tonos (período 14–18,5 px, fases de a 1 px) sobre el fondo vecino
    (lum_f en ys_f, xs_f) y devuelve cuánto explica a la mancha (r², error mediano, período)."""
    fases = np.arange(0, 18.5, 1.0)
    mejor = (-np.inf, None)
    for p in np.arange(14.0, 18.51, 0.1):
        fy = fases[fases < p]
        col_y = np.floor((ys_f[None, :] + fy[:, None]) / p)
        for fx in fases[fases < p]:
            par = ((np.floor((xs_f + fx) / p)[None, :] + col_y) % 2).astype(bool)
            n1 = np.maximum(par.sum(1), 1)
            n0 = np.maximum((~par).sum(1), 1)
            c1 = (lum_f * par).sum(1) / n1
            c0 = (lum_f * ~par).sum(1) / n0
            err = ((lum_f[None, :] - np.where(par, c1[:, None], c0[:, None])) ** 2).mean(1)
            k = int(np.argmin(err))
            if -err[k] > mejor[0]:
                mejor = (-err[k], (p, fx, fy[k], c0[k], c1[k]))
    p, fx, fy, c0, c1 = mejor[1]
    par = ((np.floor((xs_c + fx) / p) + np.floor((ys_c + fy) / p)) % 2).astype(bool)
    pred = np.where(par, c1, c0)
    ss = ((lum_c - lum_c.mean()) ** 2).sum()
    r2 = 1 - ((lum_c - pred) ** 2).sum() / max(ss, 1e-6)
    return float(r2), float(np.median(np.abs(lum_c - pred))), float(p)


def separar(a, nombre):
    """Alfa (0..1) y color del personaje sobre la fuente entera, más lo que se hizo (para la revisión)."""
    alto, ancho = a.shape[:2]
    mn, mx = a.min(axis=2), a.max(axis=2)
    lum = _luminancia(a)
    claro = (mn >= CLARO) & ((mx - mn) <= NEUTRO)
    contorno = lum < OSCURO
    contorno |= ndimage.binary_closing(contorno, structure=_disco(CIERRE))
    pasa = claro & ~contorno

    # 1) inundación desde el borde
    lab, _ = ndimage.label(pasa, structure=CRUZ)
    ids = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    fondo = np.isin(lab, ids[ids > 0])

    # 2) fondo encerrado: manchas claras y neutras que el damero de alrededor explica
    encerrado, _ = ndimage.label(pasa & ~fondo, structure=CRUZ)
    huecos = np.zeros_like(fondo)
    rng = np.random.default_rng(0)
    for i, sl in enumerate(ndimage.find_objects(encerrado)):
        m = encerrado[sl] == i + 1
        area = int(m.sum())
        if area < HUECO_AREA:
            continue
        rgb = a[sl][m]
        rb = float((rgb[:, 0] - rgb[:, 2]).mean())
        if abs(rb) > 3:          # el damero es gris puro; lo blanco del dibujo tira a crema
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        vy0, vy1, vx0, vx1 = max(0, y0 - 110), min(alto, y1 + 110), max(0, x0 - 110), min(ancho, x1 + 110)
        yy, xx = np.nonzero(fondo[vy0:vy1, vx0:vx1])
        if len(yy) < 400:
            continue
        sel = rng.choice(len(yy), size=min(4000, len(yy)), replace=False)
        ys_f, xs_f = yy[sel] + vy0, xx[sel] + vx0
        cy, cx = np.nonzero(m)
        r2, error, periodo = _damero_explica(lum[sl][m], cy + y0, cx + x0, lum[ys_f, xs_f], ys_f, xs_f)
        es_fondo = r2 >= 0.1 and error <= 6
        print(f'  {nombre}: mancha encerrada x {x0}–{x1}, y {y0}–{y1} ({area} px): r² {r2:.2f}, '
              f'error {error:.1f}, damero de {periodo:.1f} px → {"FONDO" if es_fondo else "dibujo"}')
        if es_fondo:
            huecos[sl] |= m
    for (x, y) in AJUSTES.get(nombre, {}).get('huecos', []):
        if encerrado[y, x] == 0:
            sys.exit(f'{nombre}: el hueco ({x}, {y}) de AJUSTES no cae en una mancha clara encerrada')
        m = encerrado == encerrado[y, x]
        print(f'  {nombre}: hueco a mano ({x}, {y}): {int(m.sum())} px')
        huecos |= m
    fondo |= huecos

    # 3) la franja del JPG entre el damero y el contorno: «contorno + fondo»
    nucleo = lum < NUCLEO
    cerca = (~fondo) & (ndimage.distance_transform_edt(~fondo) <= FRANJA) & ~nucleo & ((mx - mn) <= 40)
    fondo |= cerca & claro                   # restos claros del damero pegados al contorno
    cerca &= ~claro
    d_nucleo, (iy, ix) = ndimage.distance_transform_edt(~nucleo, return_indices=True)
    suma = ndimage.uniform_filter(np.where(fondo, lum, 0).astype(np.float32), 9)
    cuenta = ndimage.uniform_filter(fondo.astype(np.float32), 9)
    lum_fondo = np.where(cuenta > 1e-3, suma / np.maximum(cuenta, 1e-3), 243)
    lum_fondo = np.where(lum_fondo > 150, lum_fondo, 243)
    mezcla = cerca & (d_nucleo <= 3)
    alfa = np.where(fondo, 0.0, 1.0).astype(np.float32)
    lum_nucleo = lum[iy, ix]
    alfa[mezcla] = np.clip((lum_fondo[mezcla] - lum[mezcla]) / np.maximum(lum_fondo[mezcla] - lum_nucleo[mezcla], 1), 0, 1)
    color = a.copy()
    color[mezcla] = a[iy[mezcla], ix[mezcla]]

    # 4) restos del damero pegados al borde y metidos en el contorno o el pelo (un punto blanco en la
    #    punta del jopo de Fabri, una rayita junto al brazo de Nico U.): son fondo. Los dientes de la
    #    máquina se parecen (claros, chicos, entre negro y metal) pero quedan a 5 px o más del borde.
    lejos = ndimage.distance_transform_edt(alfa > 0)
    figura = alfa > 0.5
    manchas = np.zeros_like(fondo)
    restos, _ = ndimage.label(figura & (lum > 185) & ((mx - mn) < 35), structure=OCHO)
    for i, sl in enumerate(ndimage.find_objects(restos)):
        sl2 = tuple(slice(max(0, s.start - 3), s.stop + 3) for s in sl)
        m = restos[sl2] == i + 1
        if m.sum() > MANCHA_AREA or lejos[sl2][m].min() > 1.5:
            continue
        anillo = ndimage.binary_dilation(m, iterations=2) & ~m & figura[sl2]
        if anillo.any() and (lum[sl2][anillo] < 110).mean() >= 0.6:
            manchas[sl2] |= m
    alfa[manchas] = 0
    print(f'  {nombre}: {int(manchas.sum())} px de restos del damero en el borde, '
          f'{int(mezcla.sum())} px de franja mezclada')

    # 5) sólo el personaje (afuera quedan motas del JPG y la columna del borde derecho de la fuente)
    lab, n = ndimage.label(alfa > 0, structure=OCHO)
    if n > 1:
        areas = ndimage.sum(np.ones_like(alfa), lab, index=np.arange(1, n + 1))
        alfa[~np.isin(lab, 1 + np.nonzero(areas >= 0.05 * areas.max())[0])] = 0
    return alfa, color, {'fondo': fondo, 'huecos': huecos, 'mezcla': mezcla, 'manchas': manchas}


def desde_png(a):
    """Portada que ya viene con transparencia (ver el docstring): alfa del dibujo a 255 y sin motas."""
    alfa = np.clip(a[..., 3].astype(np.float32) / ALFA_DIBUJO, 0, 1)
    lab, n = ndimage.label(alfa > 0.02, structure=OCHO)
    if n > 1:
        areas = ndimage.sum(np.ones(alfa.shape, np.float32), lab, index=np.arange(1, n + 1))
        alfa[~np.isin(lab, 1 + np.nonzero(areas >= MOTA)[0])] = 0
    return alfa, a[..., :3].astype(np.float32)


def escalar(alfa, color, alto_final):
    """Recorte al cuerpo (margen chico, pies abajo) y Lanczos sin halo: el color se extiende hacia
    afuera desde el contorno, así el fondo nunca entra en el borde (ni al escalar ni en el WebP)."""
    ys, xs = np.nonzero(alfa > 0.02)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    m = int(round((y1 - y0) * MARGEN))
    alto_f, ancho_f = alfa.shape
    caja = (x0 - m, y0 - m, x1 + m, y1)
    pad = [(max(0, -caja[1]), 0), (max(0, -caja[0]), max(0, caja[2] - ancho_f))]
    alfa_c = np.pad(alfa, pad)[caja[1] + pad[0][0]:caja[3] + pad[0][0], caja[0] + pad[1][0]:caja[2] + pad[1][0]]
    color_c = np.pad(color, pad + [(0, 0)], mode='edge')[caja[1] + pad[0][0]:caja[3] + pad[0][0],
                                                       caja[0] + pad[1][0]:caja[2] + pad[1][0]]
    _, (iy, ix) = ndimage.distance_transform_edt(alfa_c < 0.5, return_indices=True)
    extendido = color_c[iy, ix]
    tam = (round(alfa_c.shape[1] * alto_final / alfa_c.shape[0]), alto_final)
    rgb = Image.fromarray(np.clip(extendido + 0.5, 0, 255).astype(np.uint8)).resize(tam, Image.LANCZOS)
    a = Image.fromarray(np.clip(alfa_c * 255 + 0.5, 0, 255).astype(np.uint8)).resize(tam, Image.LANCZOS)
    a = np.asarray(a).copy()
    a[a < 4] = 0                             # el rebote del Lanczos afuera del contorno
    # 4 canales uint8 → RGBA (el parámetro «mode» de fromarray se va en Pillow 13)
    return Image.fromarray(np.ascontiguousarray(np.dstack([np.asarray(rgb), a])))


def revision(carpeta, nombre, fuente, partes, retrato):
    os.makedirs(carpeta, exist_ok=True)
    if partes is not None:                   # la máscara del damero (las portadas PNG no tienen)
        vista = fuente.astype(np.float32).copy()
        for clave, tono in (('fondo', (0, 160, 255)), ('huecos', (255, 0, 200)), ('mezcla', (255, 220, 0)), ('manchas', (255, 40, 40))):
            z = partes[clave]
            vista[z] = vista[z] * 0.25 + np.array(tono) * 0.75
        Image.fromarray(vista.astype(np.uint8)).resize((fuente.shape[1] // 2, fuente.shape[0] // 2), Image.LANCZOS).save(
            os.path.join(carpeta, f'{nombre}_mascara.png'))
    # el retrato sobre el negro del juego, sobre gris medio y sobre damero (para ver el alfa)
    w, h = retrato.size
    lamina = Image.new('RGBA', (w * 3 + 40, h + 20), (40, 40, 44, 255))
    for i, base in enumerate(((5, 5, 7), (128, 128, 128), None)):
        if base is None:
            fondo = Image.new('RGBA', (w, h))
            px = np.zeros((h, w, 4), np.uint8)
            yy, xx = np.mgrid[0:h, 0:w]
            px[...] = np.where((((yy // 16) + (xx // 16)) % 2 == 0)[..., None], (200, 200, 200, 255), (150, 150, 150, 255))
            fondo = Image.fromarray(px)
        else:
            fondo = Image.new('RGBA', (w, h), base + (255,))
        fondo.alpha_composite(retrato)
        lamina.alpha_composite(fondo, (10 + i * (w + 10), 10))
    lamina.convert('RGB').save(os.path.join(carpeta, f'{nombre}_retrato.png'))


def buscar_cara(alfa, color):
    """La cara: la mancha de piel más grande y más centrada de la parte de arriba del cuerpo (las manos
    que levantan las herramientas también son piel, pero quedan a los costados). Devuelve y0, y1, x0, x1."""
    ys, xs = np.nonzero(alfa > 0.5)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    r, g, b = color[..., 0], color[..., 1], color[..., 2]
    piel = ((alfa > 0.5) & (r > 95) & (g > 40) & (b > 20) & (r > g) & (r > b)
            & (r - np.minimum(g, b) > 15) & (np.abs(r - g) > 15))
    piel[int(y0 + 0.42 * (y1 - y0)):] = False
    piel = ndimage.binary_opening(piel, structure=_disco(2))
    lab, n = ndimage.label(piel)
    if n == 0:
        sys.exit('no encontré la cara')
    centro = (x0 + x1) / 2
    mejor, puntaje = None, -1.0
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        area = float((lab[sl] == i).sum())
        medio = (sl[1].start + sl[1].stop) / 2
        p = area / (1 + ((medio - centro) / (0.18 * (x1 - x0))) ** 2)
        if p > puntaje:
            mejor, puntaje = sl, p
    return mejor[0].start, mejor[0].stop, mejor[1].start, mejor[1].stop


def cara(alfa, color, nombre):
    """cara.webp desde la portada: un cuadrado con la cabeza arriba y el comienzo de los hombros, como
    las de Simón y Chipi. Se mide desde el ancho y el borde de arriba de la mancha de la cara."""
    fy0, _, fx0, fx1 = buscar_cara(alfa, color)
    ancho_c = fx1 - fx0
    dx, dy, esc = CARA_AJUSTES.get(nombre, (0.0, 0.0, 1.0))
    lado = int(round(CARA_LADO * ancho_c * esc))
    x0 = int(round((fx0 + fx1) / 2 - lado / 2 + dx * lado))
    y0 = int(round(fy0 - CARA_ARRIBA * ancho_c + dy * lado))
    alto_f, ancho_f = alfa.shape
    pad = max(0, -x0, -y0, x0 + lado - ancho_f, y0 + lado - alto_f)
    alfa_p = np.pad(alfa, pad)
    color_p = np.pad(color, [(pad, pad), (pad, pad), (0, 0)], mode='edge')
    alfa_c = alfa_p[y0 + pad:y0 + pad + lado, x0 + pad:x0 + pad + lado]
    color_c = color_p[y0 + pad:y0 + pad + lado, x0 + pad:x0 + pad + lado]
    _, (iy, ix) = ndimage.distance_transform_edt(alfa_c < 0.5, return_indices=True)
    rgb = Image.fromarray(np.clip(color_c[iy, ix] + 0.5, 0, 255).astype(np.uint8)).resize((CARA, CARA), Image.LANCZOS)
    a = Image.fromarray(np.clip(alfa_c * 255 + 0.5, 0, 255).astype(np.uint8)).resize((CARA, CARA), Image.LANCZOS)
    a = np.asarray(a).copy()
    a[a < 4] = 0
    return Image.fromarray(np.ascontiguousarray(np.dstack([np.asarray(rgb), a])))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('ids', nargs='+', help='ids del juego (fabri, luciano, nico_u…)')
    ap.add_argument('--alto', type=int, default=ALTO, help=f'alto del retrato en px (default {ALTO})')
    ap.add_argument('--cara', action='store_true', help='también cara.webp (la grilla, el HUD y la banda del especial)')
    ap.add_argument('--revision', help='carpeta para las imágenes de revisión (NUNCA dentro de public/)')
    args = ap.parse_args()
    if args.revision and os.path.abspath(args.revision).startswith(os.path.join(REPO, 'public')):
        sys.exit('la revisión no va dentro de public/')
    for nombre in args.ids:
        png = os.path.join(FUENTES, f'{nombre}_retrato.png')
        jpg = os.path.join(FUENTES, f'{nombre}_retrato.jpg')
        if not os.path.exists(png) and not os.path.exists(jpg):
            sys.exit(f'falta {png} (o .jpg)')
        carpeta = os.path.join(REPO, 'public', 'juego', 'personajes', nombre)
        if not os.path.isdir(carpeta):
            sys.exit(f'{nombre} no está en el juego (falta {carpeta})')
        if os.path.exists(png):
            rgba = np.asarray(Image.open(png).convert('RGBA'))
            fuente = rgba[..., :3]
            alfa, color = desde_png(rgba)
            partes = None
        else:
            fuente = np.asarray(Image.open(jpg).convert('RGB'))
            alfa, color, partes = separar(fuente.astype(np.float32), nombre)
        retrato = escalar(alfa, color, args.alto)
        destino = os.path.join(carpeta, 'retrato.webp')
        retrato.save(destino, 'WEBP', quality=CALIDAD, method=6)
        print(f'{nombre}: {os.path.relpath(destino, REPO)} {retrato.width}×{retrato.height}, '
              f'{os.path.getsize(destino) / 1024:.1f} KB')
        if args.revision:
            revision(args.revision, nombre, fuente, partes, Image.open(destino).convert('RGBA'))
        if args.cara:
            destino = os.path.join(carpeta, 'cara.webp')
            cara(alfa, color, nombre).save(destino, 'WEBP', quality=CALIDAD, method=6)
            print(f'{nombre}: {os.path.relpath(destino, REPO)} {CARA}×{CARA}, {os.path.getsize(destino) / 1024:.1f} KB')


if __name__ == '__main__':
    main()

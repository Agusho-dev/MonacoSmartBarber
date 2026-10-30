#!/usr/bin/env python3
"""
Recorte de las hojas de 18 paneles de Stefano y Brian para «Corte Final» (30/oct/2026).

Este archivo es el motor; extraer_brian.py lo llama con su JSON. Importa SIN tocarlos el extractor
compartido (scripts/juego/extraer_sprites.py: máscara de isnet-general-use, apoyo de cada cuadro,
empaquetado del atlas) y el envoltorio de Chipi (scripts/juego/extraer_chipi.py: costuras entre
cuadros que se tocan, inferencia «ancho», incluir/excluir/limite por cuadro, limpiezas), y les suma
lo que piden estas dos hojas:

  - Caché de máscaras: cada inferencia del modelo se guarda en
    scripts/juego/personajes/.cache/<id>/mascaras (no se versiona), con la clave de los píxeles que
    entraron. Rehacer el atlas después de tocar el JSON tarda segundos y sólo infiere lo nuevo.
  - "escala" por animación y "escalaPorCuadro": las filas de la hoja están dibujadas a distintos
    tamaños (en Stefano la de abajo es ~1,2x y las de los especiales ~1,3x). Todo se lleva a la
    escala de «quieto».
  - "injertos": en la hoja de Stefano los especiales están cortados a la altura de las canillas (no
    hay pies). El cuadro se arma con el torso del especial (hasta el ruedo de la campera) y la cadera
    y las piernas de otro cuadro con la misma postura, alineados por el centro de la cadera; el ruedo
    de la campera tapa la unión.
  - herramienta1 / herramienta2 son ALIAS (no hay paneles de herramienta en estas hojas): los MISMOS
    rectángulos del atlas que el remate del combo y el golpe 2 («matezo», «golpe pesado»), sin
    duplicar píxeles. Así el botón MÁQUINA es su golpe pesado.
  - "retoques" por cuadro: sacar la víctima del agarre de Brian, los arcos de golpe pintados encima
    del cuerpo, el humo del dash, el fondo que el modelo se traga al lado de la ropa negra.
  - El atlas lo arma este script con el formato de extraer_sprites (los cuadros repetidos, como un
    cuadro prestado o un alias, comparten el MISMO rectángulo) y se guarda en WebP sin pérdida si pesa
    menos que el PNG (atlas.json dice cuál).
  - retrato.webp y cara.webp salen de un cuadro de la hoja (no hay foto de cuerpo entero): agrandados
    con LANCZOS en alfa premultiplicado (sin halo) y un poco de nitidez, con el tamaño y el encuadre
    de los de Simón y Chipi (retrato de 720 de alto, cara de 256x256).
  - Con --revision: las tiras del compartido (revision_<anim>.png), la máscara de cada cuadro sobre
    la hoja (mascara_<anim>_<i>.png, de extraer_chipi), las costuras, y lamina.png: todos los
    cuadros a escala sobre la misma línea de piso.

Claves del JSON propias de este motor (el resto, ver extraer_sprites.py y extraer_chipi.py; los
índices por cuadro son los de ANTES de "usar"; coordenadas en px de la HOJA):
  raíz
    "escalaGlobal": f   agranda todos los cuadros y efectos (hojas más chicas que el resto)
    "limpiezasColor": [{"zona": forma, "tono"?, "satMin"?, ..., "radio"?}]  reconstruye (inpaint)
                        en la hoja, ANTES del modelo, los píxeles de ese color dentro de la zona
    "retratoDesde": {"anim": "victoria", "cuadro": 0, "alto": 720, "cara": [x0, y0, x1, y1],
                     "caraDesde": {"anim": "especial2", "cuadro": 0}, "nitidez": 80}
                    (el cuadro SIN escalar; "cara" en px de la hoja; "caraDesde" opcional: la cara
                    sale de otro cuadro, p. ej. de una fila dibujada más grande)
  por animación
    "alias": "combo", "usar": [...], "impactos": [...]   (sólo herramienta1 / herramienta2)
    "usar": [0, 2, "golpe:2"]        orden final; "otra:i" toma prestado el cuadro i de otra animación
    "escala": f, "escalaPorCuadro": {"i": f}
    "ajusteYPorCuadro": {"i": px}    sube (+) o baja (-) el apoyo de un cuadro
    "axPorCuadro": {"i": px}         corre el apoyo X de un cuadro (en px del cuadro final)
    "retoques": {"i": {...}}, "retoqueTodos": {...}   ediciones del cuadro ya recortado (ver retocar):
        "quitar": [formas], "limite": [formas], "quitarColor": [{"zona"?, "tono"?: [h0, h1],
        "satMin"?, "satMax"?, "lumMin"?, "lumMax"?, "invertir"?}], "pelarFondo": {...} y "pelar":
        [{...}] (ver pelar_fondo), "restaurar": [formas] (vuelve lo que había antes de quitar),
        "sumarColor": [{"caja", regla de color}] y "sumar": [{"caja"}] (agregan un objeto que el
        modelo perdió: piel de un antebrazo, el mate al final del brazo), "componentes"
    "injertos": {"i": {"donante": "combo:3", "corte": y_hoja, "corteDonante": y_hoja, "dx": px,
                        "solape": px, "caderaX": [xa, xb], "caderaXDonante": [xa, xb],
                        "apoyo": "pies", "conservar": [formas]}}
                 el cuadro i se queda con lo que está por ENCIMA de "corte" (y de la hoja) y debajo
                 se pega lo del cuadro 3 de «combo» (antes de su "usar") por debajo de
                 "corteDonante"; "dx" corre las piernas (px finales), "solape" baja el corte del
                 torso para que tape la unión, "caderaX" acota dónde se mide el centro de la cadera
                 (sin el bolso), "apoyo": "pies" pone el apoyo X entre los pies del donante y
                 "conservar" deja del torso lo que cuelga por debajo del corte (un puño).
  efectos (además de los modos de extraer_chipi)
    "escala": f                      lleva el sprite a la escala de «quieto»
    "modo": "recorte"                un objeto chico recortado a mano: lo que cae dentro de
                                     "poligono" y no es fondo ("lumMin", "quitarColor")

Uso (desde MonacoSmartBarber/; el modelo, con el candado de la Mac):
  TURNO=ml <scratchpad>/herramientas/turno.sh python3 scripts/juego/extraer_stefano.py \
      scripts/juego/personajes/stefano.json --revision <carpeta> [--solo a,b] [--sin-atlas]
SIN_MODELO=1 hace fallar en vez de inferir (para verificar que todo sale del caché).
Herramientas para armar el JSON de una hoja nueva:
  --paneles              imprime los paneles de la hoja y dónde termina la barra del título de cada uno
  --ver <anim> <i,j>     dibuja esos cuadros crudos (retocados, antes de escalar) sobre la hoja, con la
                         grilla en px de la hoja, en la carpeta de --revision (default: la actual)
"""
import argparse
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

_AQUI = os.path.dirname(os.path.abspath(__file__))
_REPO = '/Users/ignaciobaldovino/MSB_FULL/MonacoSmartBarber'
for _d in (_AQUI, os.path.join(_REPO, 'scripts', 'juego')):
    if os.path.exists(os.path.join(_d, 'extraer_sprites.py')) and os.path.exists(os.path.join(_d, 'extraer_chipi.py')):
        sys.path.insert(0, _d)
        break
import extraer_sprites as ES  # noqa: E402
import extraer_chipi as CH  # noqa: E402

CLAVES = ES.CLAVES
_estado = {'cache': None, 'hoja': None, 'inferencias': 0, 'del_cache': 0}
_isnet_original = ES.mascara_isnet


def mascara_isnet_con_cache(img_rgb, cuadrar=False):
    """ES.mascara_isnet con caché en disco: la clave son los píxeles que entran al modelo."""
    clave = hashlib.sha1()
    clave.update(img_rgb.convert('RGB').tobytes())
    clave.update(repr((img_rgb.size, bool(cuadrar), 'isnet-general-use', 1)).encode())
    ruta = os.path.join(_estado['cache'], clave.hexdigest() + '.npy')
    if os.path.exists(ruta):
        _estado['del_cache'] += 1
        return np.load(ruta).astype(np.float32)
    if os.environ.get('SIN_MODELO'):
        raise SystemExit(f'SIN_MODELO: falta una máscara en el caché ({img_rgb.size}, cuadrar={cuadrar})')
    m = _isnet_original(img_rgb, cuadrar)
    np.save(ruta, m.astype(np.float16))
    _estado['inferencias'] += 1
    return m


ES.mascara_isnet = mascara_isnet_con_cache


def escalar_cuadro(c, s):
    """Lleva un cuadro a otra escala (alfa premultiplicado, bordes duros como el resto)."""
    if c is None or abs(s - 1) < 1e-6:
        return c
    im = c['img']
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    chica = im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    a = np.asarray(chica).copy()
    a[..., 3] = np.where(a[..., 3] >= 110, 255, 0).astype(np.uint8)
    out = dict(c)
    out['img'] = Image.fromarray(a)
    out['ax'] = round(c['ax'] * w / im.width, 1)
    out['ay'] = round(c['ay'] * h / im.height, 1)
    out['escala'] = c.get('escala', 1.0) * s
    return out


def centro_fila(alfa, y, alto=3):
    """Centro x de la máscara en una franja de filas (para alinear caderas)."""
    y0, y1 = max(0, int(y) - alto), min(alfa.shape[0], int(y) + 1)
    ys, xs = np.nonzero(alfa[y0:y1] > 0)
    if len(xs) == 0:
        return None
    return float((xs.min() + xs.max()) / 2.0)


def injertar(c, donante, op):
    """Torso de c (por encima de "corte") sobre cadera y piernas del donante (por debajo de
    "corteDonante"). Las dos y vienen en px de la HOJA; se pasan al cuadro final con su origen y su
    escala. El apoyo Y queda en los pies del donante; el X, el del torso."""
    s_c = c.get('escala', 1.0)
    s_d = donante.get('escala', 1.0)
    yc = (float(op['corte']) - c['origen'][1]) * s_c
    yd = (float(op['corteDonante']) - donante['origen'][1]) * s_d
    yc_tapa = yc + float(op.get('solape', 3))
    A = np.asarray(c['img']).copy()
    D = np.asarray(donante['img']).copy()
    ac = A[..., 3] > 0
    ad = D[..., 3] > 0

    def centro(alfa, y, c_, s_, rango):
        # centro de la cadera; "rango" [xa, xb] en px de la hoja deja afuera lo que cuelga (un bolso)
        if not rango:
            return centro_fila(alfa, y)
        xa = max(0, int((rango[0] - c_['origen'][0]) * s_))
        xb = min(alfa.shape[1], int((rango[1] - c_['origen'][0]) * s_))
        v = centro_fila(alfa[:, xa:xb], y) if xb > xa else None
        return None if v is None else v + xa

    cx_c = centro(ac, yc, c, s_c, op.get('caderaX'))
    cx_d = centro(ad, yd, donante, s_d, op.get('caderaXDonante'))
    if cx_c is None or cx_d is None:
        print('  AVISO: injerto sin cadera para alinear', file=sys.stderr)
        return c
    dx = cx_c - cx_d + float(op.get('dx', 0))
    dy = yc - yd
    # lienzo que contiene a los dos
    x0 = min(0, int(np.floor(dx)))
    y0 = min(0, int(np.floor(dy)))
    x1 = max(A.shape[1], int(np.ceil(dx)) + D.shape[1])
    y1 = max(int(np.ceil(yc_tapa)) + 1, int(np.ceil(dy)) + D.shape[0])
    W, H = x1 - x0, y1 - y0
    lienzo = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # piernas del donante (sólo lo de abajo del corte, con un margen hacia arriba que tapa el torso)
    Dp = D.copy()
    tope = int(max(0, np.floor(yd - float(op.get('margenDonante', 6)))))
    Dp[:tope, :, 3] = 0
    lienzo.alpha_composite(Image.fromarray(Dp), (int(round(dx)) - x0, int(round(dy)) - y0))
    # torso encima (lo de arriba del corte + el solape; "conservar" deja también lo de abajo que
    # cae en esas formas, p. ej. el puño del brazo que cuelga por debajo del ruedo)
    Ap = A.copy()
    guardar = None
    if op.get('conservar'):
        ox, oy = c['origen']
        mitad = CH.rasterizar(op['conservar'], (ox, oy), (int(round(A.shape[1] / s_c)) + 2, int(round(A.shape[0] / s_c)) + 2))
        yy, xx = np.mgrid[0:A.shape[0], 0:A.shape[1]]
        ys = np.clip((yy / s_c).astype(int), 0, mitad.shape[0] - 1)
        xs = np.clip((xx / s_c).astype(int), 0, mitad.shape[1] - 1)
        guardar = mitad[ys, xs]
    abajo = np.zeros(A.shape[:2], bool)
    abajo[int(np.ceil(yc_tapa)):, :] = True
    if guardar is not None:
        abajo &= ~guardar
    Ap[abajo, 3] = 0
    lienzo.alpha_composite(Image.fromarray(Ap), (-x0, -y0))
    arr = np.asarray(lienzo).copy()
    arr[..., 3] = np.where(arr[..., 3] >= 128, 255, 0).astype(np.uint8)
    bb = Image.fromarray(arr).getbbox()
    img = Image.fromarray(arr).crop(bb)
    out = dict(c)
    out['img'] = img
    out['ax'] = round(c['ax'] - x0 - bb[0], 1)
    if op.get('apoyo') == 'pies':
        # entre los pies del donante: el bolso o el brazo estirado del torso no lo corren
        out['ax'] = round(ES.ancla_x(np.asarray(img)[..., 3] > 0, 'pies') + float(op.get('dxApoyo', 0)), 1)
    out['ay'] = round(donante['ay'] + dy - y0 - bb[1], 1)
    out['injerto'] = True
    return out


def tono_sat_lum(rgb):
    """Tono (grados), saturación (0..1) y luminancia (0..255) de un arreglo RGB."""
    a = rgb.astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(axis=2), a.min(axis=2)
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    h = np.where(mx - mn < 1e-6, 0, h)
    s = (mx - mn) / np.maximum(mx, 1)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return h, s, lum


def condicion_color(rgb, regla):
    h, s, lum = tono_sat_lum(rgb)
    cond = np.ones(rgb.shape[:2], bool)
    if 'tono' in regla:
        h0, h1 = regla['tono']
        cond &= ((h >= h0) & (h <= h1)) if h0 <= h1 else ((h >= h0) | (h <= h1))
    if 'satMin' in regla:
        cond &= s >= regla['satMin']
    if 'satMax' in regla:
        cond &= s <= regla['satMax']
    if 'lumMin' in regla:
        cond &= lum >= regla['lumMin']
    if 'lumMax' in regla:
        cond &= lum <= regla['lumMax']
    return cond


def pelar_fondo(rgb, alfa, lumMax=26, stdMax=3.5, pasos=12, lumMin=0, satMax=1.0, gMenosRMin=None, ventanaTinte=3,
                zona=None, origen=None):
    """Pela desde el borde de la máscara el fondo que el modelo se tragó entre las piernas o al
    lado de la ropa negra: píxeles oscuros (lum <= lumMax) y LISOS (desvío local <= stdMax, el fondo
    de la hoja no tiene textura y la ropa sí). Avanza de a un píxel por paso."""
    from scipy import ndimage
    _, sat, lum = tono_sat_lum(rgb)
    media = ndimage.uniform_filter(lum, 5)
    desvio = np.sqrt(np.maximum(ndimage.uniform_filter(lum * lum, 5) - media * media, 0))
    fondo = (lum <= lumMax) & (lum >= lumMin) & (sat <= satMax) & (desvio <= stdMax)
    if gMenosRMin is not None:
        # el fondo de la hoja de Brian tira a verde azulado (g > r); su remera negra, no
        g_r = ndimage.uniform_filter(rgb[..., 1].astype(np.float32) - rgb[..., 0].astype(np.float32), int(ventanaTinte))
        fondo &= g_r >= float(gMenosRMin)
    if zona is not None:
        fondo &= CH.rasterizar([zona], origen, (rgb.shape[1], rgb.shape[0]))
    M = alfa.copy()
    for _ in range(int(pasos)):
        borde = M & ~ndimage.binary_erosion(M, structure=np.ones((3, 3)), border_value=0)
        sacar = borde & fondo
        if not sacar.any():
            break
        M &= ~sacar
    return M


def limpiar_por_color(hoja, reglas):
    """Borra de la hoja (antes del modelo) los efectos pintados ENCIMA del cuerpo (arcos de golpe,
    destellos): dentro de cada "zona" (polígono o caja, coords de la hoja), los píxeles que cumplen la
    regla de color se reconstruyen con lo que los rodea (cv2.inpaint). Así el modelo ve la ropa
    oscura en vez del arco y el color del cuadro queda limpio.
    [{"zona": forma, "tono"?, "satMin"?, "satMax"?, "lumMin"?, "lumMax"?, "dilatar"?: 1, "radio"?: 3}]"""
    if not reglas:
        return hoja
    import cv2
    from scipy import ndimage
    a = np.asarray(hoja).copy()
    for r in reglas:
        zona = CH.rasterizar([r['zona']], (0, 0), hoja.size)
        m = zona & condicion_color(a, r)
        if int(r.get('dilatar', 1)) > 0:
            m = ndimage.binary_dilation(m, iterations=int(r.get('dilatar', 1))) & zona
        if m.any():
            a = cv2.inpaint(a, m.astype(np.uint8) * 255, int(r.get('radio', 3)), cv2.INPAINT_TELEA)
    return Image.fromarray(a)


def retocar(c, op):
    """Ediciones sobre el cuadro ya recortado (antes de escalar). Coordenadas de la HOJA. En orden:
    quitar        [formas]  se sacan
    limite        [formas]  sólo queda lo de adentro
    quitarColor   [{"zona"?: forma, "tono"?: [h0, h1], "satMin"?, "satMax"?, "lumMin"?, "lumMax"?,
                    "invertir"?}]  se sacan los píxeles de ese color (dentro de la zona)
    pelarFondo    {...} y pelar [{...}]: ver pelar_fondo (desde el borde, de a un píxel)
    restaurar     [formas]  vuelve lo que había ahí antes de todo lo anterior
    componentes   'principal' (default: la mancha mayor y lo que cuelga) | 'todos'
    sumarColor    [{"caja", regla de color}] agrega esos píxeles de la hoja aunque no toquen al cuerpo
    sumar         [{"caja", "umbral"?}] agrega la mancha mayor de una inferencia propia de esa caja
    El apoyo Y queda a la misma distancia del borde de abajo de la máscara (los pies) que antes.
    """
    arr = np.asarray(c['img']).copy()
    h, w = arr.shape[:2]
    ox, oy = c['origen']
    # el apoyo Y queda a la misma distancia del borde de abajo de la máscara (los pies)
    ajuste = c['ay'] - h
    alfa = arr[..., 3] > 0
    if op.get('quitar'):
        alfa &= ~CH.rasterizar(op['quitar'], (ox, oy), (w, h))
    if op.get('limite'):
        alfa &= CH.rasterizar(op['limite'], (ox, oy), (w, h))
    for regla in op.get('quitarColor') or []:
        zona = CH.rasterizar([regla['zona']], (ox, oy), (w, h)) if regla.get('zona') else np.ones((h, w), bool)
        cond = condicion_color(arr[..., :3], regla)
        if regla.get('invertir'):
            cond = ~cond
        alfa &= ~(zona & cond)
    for pf in ([op['pelarFondo']] if op.get('pelarFondo') else []) + list(op.get('pelar') or []):
        # pelarFondo: el fondo oscuro y liso; "pelar": más pasadas (humo claro y liso, etc.)
        alfa = pelar_fondo(arr[..., :3], alfa, origen=(ox, oy), **pf)
    if op.get('restaurar'):
        # lo que había en estas formas antes de quitar (las zapatillas dentro del humo del dash)
        alfa |= (arr[..., 3] > 0) & CH.rasterizar(op['restaurar'], (ox, oy), (w, h))
    alfa = ES.limpiar(alfa, op.get('componentes', 'principal'))
    for s in op.get('sumarColor') or []:
        # píxeles de un color (la piel de un antebrazo que el modelo dejó afuera) dentro de "caja"
        hoja = _estado['hoja']
        bx0, by0, bx1, by1 = s['caja']
        sub = np.asarray(hoja.crop((bx0, by0, bx1, by1)))
        m = condicion_color(sub, s)
        nx0, ny0 = min(ox, bx0), min(oy, by0)
        nx1, ny1 = max(ox + w, bx1), max(oy + h, by1)
        nuevo = np.zeros((ny1 - ny0, nx1 - nx0, 4), np.uint8)
        nuevo[oy - ny0:oy - ny0 + h, ox - nx0:ox - nx0 + w] = arr
        na = np.zeros(nuevo.shape[:2], bool)
        na[oy - ny0:oy - ny0 + h, ox - nx0:ox - nx0 + w] = alfa
        zona = np.zeros_like(na)
        zona[by0 - ny0:by1 - ny0, bx0 - nx0:bx1 - nx0] = m
        rgb = np.asarray(hoja.crop((nx0, ny0, nx1, ny1)))
        nuevo[zona, :3] = rgb[zona]
        na |= zona
        c = dict(c, ax=c['ax'] + (ox - nx0))
        arr, alfa, ox, oy = nuevo, na, nx0, ny0
        h, w = alfa.shape
    for s in op.get('sumar') or []:
        # un objeto que el recorte perdió (el mate al final del brazo): su propia inferencia
        # (caja rellenada a cuadrado), la mancha mayor, pegada aunque no toque al cuerpo
        hoja = _estado['hoja']
        bx0, by0, bx1, by1 = s['caja']
        m = ES.mascara_isnet(hoja.crop((bx0, by0, bx1, by1)), cuadrar=True) >= float(s.get('umbral', 0.5))
        m = ES.limpiar(m, 'principal')
        nx0, ny0 = min(ox, bx0), min(oy, by0)
        nx1, ny1 = max(ox + w, bx1), max(oy + h, by1)
        nuevo = np.zeros((ny1 - ny0, nx1 - nx0, 4), np.uint8)
        nuevo[oy - ny0:oy - ny0 + h, ox - nx0:ox - nx0 + w] = arr
        na = np.zeros(nuevo.shape[:2], bool)
        na[oy - ny0:oy - ny0 + h, ox - nx0:ox - nx0 + w] = alfa
        zona = np.zeros_like(na)
        zona[by0 - ny0:by1 - ny0, bx0 - nx0:bx1 - nx0] = m
        rgb = np.asarray(hoja.crop((nx0, ny0, nx1, ny1)))
        nuevo[zona, :3] = rgb[zona]
        na |= zona
        c = dict(c, ax=c['ax'] + (ox - nx0))
        arr, alfa, ox, oy = nuevo, na, nx0, ny0
        h, w = alfa.shape
    ys, xs = np.nonzero(alfa)
    if len(xs) == 0:
        return c
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    arr[..., 3] = np.where(alfa, 255, 0).astype(np.uint8)
    out = dict(c)
    out['img'] = Image.fromarray(np.ascontiguousarray(arr[y0:y1, x0:x1]))
    out['ax'] = round(c['ax'] - x0, 1) if not op.get('recalcularApoyo') else round(
        ES.ancla_x(alfa[y0:y1, x0:x1], op.get('ancla', 'torso')), 1)
    out['ay'] = round((y1 - y0) + ajuste, 1)
    out['origen'] = [ox + int(x0), oy + int(y0)]
    return out


def efecto_recorte(hoja, ef):
    """Un objeto chico recortado a mano: lo que cae dentro de "poligono" y no es fondo oscuro
    ("lumMin"). Para los mates voladores, donde el modelo se queda con el borde y nada más."""
    x0, y0, x1, y1 = ef['caja']
    rec = hoja.crop((x0, y0, x1, y1))
    rgb = np.asarray(rec)
    m = CH.rasterizar([ef['poligono']], (x0, y0), rec.size)
    _, _, lum = tono_sat_lum(rgb)
    m &= lum >= float(ef.get('lumMin', 35))
    for regla in ef.get('quitarColor') or []:
        zona = CH.rasterizar([regla['zona']], (x0, y0), rec.size) if regla.get('zona') else np.ones_like(m)
        m &= ~(zona & condicion_color(rgb, regla))
    m = ES.limpiar(m, 'principal')
    from scipy import ndimage
    m = ndimage.binary_fill_holes(m)
    rgba = np.dstack([rgb, np.where(m, 255, 0).astype(np.uint8)])
    img = Image.fromarray(np.ascontiguousarray(rgba))
    bb = img.getbbox()
    img = img.crop(bb)
    return {'img': img, 'ax': img.width / 2.0, 'ay': img.height / 2.0, 'origen': [x0 + bb[0], y0 + bb[1]]}


def extraer(hoja, nombre, anim, revision):
    """Cuadros de una animación ANTES de "usar", ya retocados y escalados (sin injertos)."""
    sin_usar = {k: v for k, v in anim.items() if k != 'usar'}
    lista = CH.extraer_animacion(hoja, sin_usar, revision, nombre)
    s = float(anim.get('escala', 1) or 1)
    por = anim.get('escalaPorCuadro') or {}
    glob = float(_estado.get('escalaGlobal', 1) or 1)
    retoques = anim.get('retoques') or {}
    todos = anim.get('retoqueTodos')
    salida = []
    for i, c in enumerate(lista):
        c = dict(c)
        op = dict(todos or {})
        op.update(retoques.get(str(i)) or {})
        if op:
            c = retocar(c, op)
        c['sinEscalar'] = {'img': c['img'], 'origen': c['origen']}
        f = float(por.get(str(i), s)) * glob
        c['escala'] = 1.0
        salida.append(escalar_cuadro(c, f))
    return salida


def aplicar_retoques(anim, lista):
    for k, v in (anim.get('ajusteYPorCuadro') or {}).items():
        if int(k) < len(lista):
            lista[int(k)]['ay'] = round(lista[int(k)]['ay'] + float(v), 1)
    for k, v in (anim.get('axPorCuadro') or {}).items():
        if int(k) < len(lista):
            lista[int(k)]['ax'] = round(lista[int(k)]['ax'] + float(v), 1)
    return lista


def agrandar(img, alto, nitidez=80):
    """Agranda un RGBA en alfa premultiplicado (sin halo) y le da un poco de nitidez."""
    ancho = round(img.width * alto / img.height)
    grande = img.convert('RGBa').resize((ancho, alto), Image.LANCZOS)
    rgb = grande.convert('RGBA')
    if nitidez:
        a = rgb.getchannel('A')
        color = rgb.convert('RGB').filter(ImageFilter.UnsharpMask(radius=2, percent=int(nitidez), threshold=2))
        rgb = color.convert('RGBA')
        rgb.putalpha(a)
    return rgb


def procesar_retrato(cfg, crudos, salida, revision=None):
    """retrato.webp (cuerpo entero, 720 de alto) y cara.webp (256x256) desde un cuadro sin escalar."""
    r = cfg['retratoDesde']
    c = crudos[r['anim']][int(r['cuadro'])]
    c = c.get('sinEscalar', c)
    img = c['img']
    bb = img.getbbox()
    cuerpo = img.crop(bb)
    retrato = agrandar(cuerpo, int(r.get('alto', 720)), r.get('nitidez', 80))
    retrato.save(os.path.join(salida, 'retrato.webp'), 'WEBP', quality=90, method=6)
    x0, y0, x1, y1 = r['cara']
    # la cara puede salir de otro cuadro (uno de una fila dibujada más grande): "caraDesde"
    cc = crudos[r['caraDesde']['anim']][int(r['caraDesde']['cuadro'])] if r.get('caraDesde') else c
    cc = cc.get('sinEscalar', cc)
    ox, oy = cc['origen']
    caja = (x0 - ox, y0 - oy, x1 - ox, y1 - oy)
    cara = cc['img'].crop(caja)
    lado = max(cara.size)
    cuadrada = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
    # pegada abajo: los hombros llegan al borde, como en Simón y Chipi
    cuadrada.alpha_composite(cara, ((lado - cara.width) // 2, lado - cara.height))
    cara_g = agrandar(cuadrada, 256, r.get('nitidez', 80))
    cara_g = cara_g.resize((256, 256), Image.LANCZOS) if cara_g.size != (256, 256) else cara_g
    cara_g.save(os.path.join(salida, 'cara.webp'), 'WEBP', quality=90, method=6)
    if revision:
        fondo = (38, 40, 48, 255)
        ret = Image.open(os.path.join(salida, 'retrato.webp')).convert('RGBA')
        ca = Image.open(os.path.join(salida, 'cara.webp')).convert('RGBA')
        L = Image.new('RGBA', (ret.width + ca.width + 30, max(ret.height, ca.height)), (90, 90, 90, 255))
        a = Image.new('RGBA', ret.size, fondo)
        a.alpha_composite(ret)
        b = Image.new('RGBA', ca.size, fondo)
        b.alpha_composite(ca)
        L.paste(a, (0, 0))
        L.paste(b, (ret.width + 30, 0))
        L.convert('RGB').save(os.path.join(revision, 'retrato_y_cara.png'))
    print(f"retrato {retrato.size[0]}x{retrato.size[1]} y cara 256x256 (de {r['anim']}[{r['cuadro']}])")


def lamina(finales, efectos, ref, carpeta, titulo):
    """Todos los cuadros a escala sobre la misma línea de piso (verde) y la altura de «quieto»."""
    filas = []
    for nombre in CLAVES:
        if nombre in finales:
            filas.append((nombre, finales[nombre]))
    for nombre, lista in efectos.items():
        filas.append(('efecto ' + nombre, lista))
    margen, sep = 70, 6
    anchos = []
    altos = []
    for _, lista in filas:
        anchos.append(sum(int(max(c['ax'], c['img'].width - c['ax']) * 2) + sep for c in lista) + margen + 10)
        altos.append(int(max(max(c['ay'], c['img'].height) for c in lista)) + 22)
    W = max(anchos)
    H = sum(altos) + 30
    L = Image.new('RGBA', (W, H), (52, 54, 62, 255))
    d = ImageDraw.Draw(L)
    d.text((6, 6), titulo, fill=(255, 255, 0, 255))
    y = 24
    for (nombre, lista), alto in zip(filas, altos):
        base = y + alto - 10
        d.text((4, y + 4), nombre, fill=(255, 255, 255, 255))
        d.line([(0, base), (W, base)], fill=(0, 220, 0, 255))
        if ref and not nombre.startswith('efecto'):
            d.line([(margen, base - ref), (W, base - ref)], fill=(0, 170, 255, 255))
        x = margen
        for i, c in enumerate(lista):
            mitad = int(max(c['ax'], c['img'].width - c['ax']))
            cx = x + mitad
            if nombre.startswith('efecto'):
                L.alpha_composite(c['img'], (int(cx - c['img'].width / 2), int(base - c['img'].height)))
            else:
                L.alpha_composite(c['img'], (int(round(cx - c['ax'])), int(round(base - c['ay']))))
                d.line([(cx, base - 4), (cx, base + 4)], fill=(255, 0, 0, 255))
            d.text((cx - 3, base + 1), str(i), fill=(255, 255, 0, 255))
            x += mitad * 2 + sep
        y += alto
    L.convert('RGB').save(os.path.join(carpeta, 'lamina.png'))


def medir_paneles(ruta_hoja):
    """--paneles: los paneles de la hoja (separados por el blanco de la hoja) y dónde termina la
    barra del título de cada uno. Es el punto de partida para escribir el JSON de un barbero nuevo."""
    from scipy import ndimage
    a = np.asarray(Image.open(ruta_hoja).convert('RGB')).astype(int)
    noblanco = ndimage.binary_opening(a.max(axis=2) <= 200, iterations=1)
    lab, n = ndimage.label(noblanco)
    areas = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    filas = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None or areas[i] < 4000:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        sub = a[y0:y1, x0:x1]
        frac = ((sub.max(axis=2) - sub.min(axis=2)) > 60).mean(axis=1)
        tit = [k for k in range(min(70, len(frac))) if frac[k] > 0.35]
        filas.append((y0, x0, x1, y1, y0 + (max(tit) + 1 if tit else 0)))
    for y0, x0, x1, y1, fin in sorted(filas):
        print(f'panel [{x0}, {y0}, {x1}, {y1}]  título hasta y={fin}  → región [{x0 + 3}, {fin + 2}, {x1 - 3}, {y1 - 3}]')


def ver_cuadros(cfg_ruta, nombre, indices, carpeta):
    """--ver anim i,j: el cuadro CRUDO (retocado, antes de escalar e injertar) sobre la hoja, con la
    grilla en px de la hoja: así se miden los polígonos de quitar/limite/restaurar."""
    base = os.path.dirname(os.path.abspath(cfg_ruta))
    with open(cfg_ruta) as f:
        cfg = json.load(f)
    _estado['cache'] = os.path.join(base, '.cache', cfg['personaje'], 'mascaras')
    os.makedirs(_estado['cache'], exist_ok=True)
    hoja_o = Image.open(ES.ruta(base, cfg['hoja'])).convert('RGB')
    hoja = limpiar_por_color(CH.aplicar_limpiezas(hoja_o, cfg.get('limpiezas')), cfg.get('limpiezasColor'))
    CH._limpiezas['mascara'] = CH.mascara_limpiezas(hoja.size, cfg.get('limpiezas'))
    _estado['hoja'] = hoja
    anim = cfg['animaciones'][nombre]
    lista = CH.extraer_animacion(hoja, {k: v for k, v in anim.items() if k not in ('usar', 'retoques')}, None, nombre)
    os.makedirs(carpeta, exist_ok=True)
    for i in indices:
        c = lista[i]
        op = dict(anim.get('retoqueTodos') or {})
        op.update((anim.get('retoques') or {}).get(str(i)) or {})
        if op:
            c = retocar(dict(c), op)
        alfa = np.asarray(c['img'])[..., 3] > 0
        ox, oy = c['origen']
        M = np.zeros((hoja.height, hoja.width), bool)
        M[oy:oy + alfa.shape[0], ox:ox + alfa.shape[1]] = alfa
        ruta = os.path.join(carpeta, f'ver_{nombre}_{i}.png')
        CH.guardar_mascara_debug(hoja, M, (0, 0), ruta, esc=4, paso=5)
        print(ruta)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--solo', default='')
    ap.add_argument('--revision', default='')
    ap.add_argument('--sin-atlas', action='store_true')
    ap.add_argument('--paneles', action='store_true', help='sólo mide los paneles de la hoja')
    ap.add_argument('--ver', nargs=2, metavar=('ANIM', 'I,J'), help='sólo dibuja esos cuadros crudos sobre la hoja')
    args = ap.parse_args()
    if args.paneles:
        with open(args.config) as f:
            medir_paneles(ES.ruta(os.path.dirname(os.path.abspath(args.config)), json.load(f)['hoja']))
        return
    if args.ver:
        ver_cuadros(args.config, args.ver[0], [int(x) for x in args.ver[1].split(',')], args.revision or '.')
        return

    config = os.path.abspath(args.config)
    base = os.path.dirname(config)
    with open(config) as f:
        cfg = json.load(f)
    pid = cfg['personaje']
    carpeta_cache = os.path.join(base, '.cache', pid)
    _estado['cache'] = os.path.join(carpeta_cache, 'mascaras')
    os.makedirs(_estado['cache'], exist_ok=True)
    carpeta_cuadros = os.path.join(carpeta_cache, 'cuadros')
    os.makedirs(carpeta_cuadros, exist_ok=True)
    salida = ES.ruta(base, cfg['salida'])
    os.makedirs(salida, exist_ok=True)
    revision = args.revision or None
    if revision:
        os.makedirs(revision, exist_ok=True)

    hoja_orig = Image.open(ES.ruta(base, cfg['hoja'])).convert('RGB')
    hoja = CH.aplicar_limpiezas(hoja_orig, cfg.get('limpiezas'))
    hoja = limpiar_por_color(hoja, cfg.get('limpiezasColor'))
    CH._limpiezas['mascara'] = CH.mascara_limpiezas(hoja.size, cfg.get('limpiezas'))
    _estado['hoja'] = hoja
    # "escalaGlobal": agranda TODO el atlas (una hoja más chica que las demás: Brian viene a
    # 1280x853 y sin esto el render lo estiraba x2,3 contra x1,75 del resto, con píxeles más gruesos)
    _estado['escalaGlobal'] = float(cfg.get('escalaGlobal', 1) or 1)
    if revision and cfg.get('limpiezas'):
        hoja.save(os.path.join(revision, 'hoja_limpia.png'))

    solo = [s for s in args.solo.split(',') if s]
    animaciones = {k: v for k, v in cfg['animaciones'].items() if 'alias' not in v}
    alias = {k: v for k, v in cfg['animaciones'].items() if 'alias' in v}
    # Los donantes de injertos se procesan siempre (hacen falta sus cuadros crudos).
    necesarias = set(animaciones) if not solo else set(solo)
    for nombre in list(necesarias):
        for op in ((animaciones.get(nombre) or {}).get('injertos') or {}).values():
            necesarias.add(op['donante'].split(':')[0])
        for u in (animaciones.get(nombre) or {}).get('usar') or []:
            if isinstance(u, str):
                necesarias.add(u.split(':')[0])
    if cfg.get('retratoDesde') and not solo:
        necesarias.add(cfg['retratoDesde']['anim'])
        if cfg['retratoDesde'].get('caraDesde'):
            necesarias.add(cfg['retratoDesde']['caraDesde']['anim'])

    crudos = {}
    for nombre, anim in animaciones.items():
        if nombre not in necesarias:
            continue
        crudos[nombre] = extraer(hoja, nombre, anim, revision)

    finales = {}
    for nombre, anim in animaciones.items():
        if solo and nombre not in solo:
            continue
        lista = [dict(c) for c in crudos[nombre]]
        for k, op in (anim.get('injertos') or {}).items():
            dn, di = op['donante'].split(':')
            lista[int(k)] = injertar(lista[int(k)], crudos[dn][int(di)], op)
        lista = aplicar_retoques(anim, lista)
        usar = anim.get('usar')
        if usar:
            # "otra:i" toma prestado el cuadro i (antes de su "usar") de otra animación
            lista = [dict(crudos[u.split(':')[0]][int(u.split(':')[1])]) if isinstance(u, str) else lista[u]
                     for u in usar if isinstance(u, str) or u < len(lista)]
        finales[nombre] = {'cuadros': lista, 'impactos': anim.get('impactos', [])}
        print(f"{nombre}: {len(lista)} cuadros {[ (c['img'].width, c['img'].height) for c in lista ]}")

    efectos = {}
    for nombre, ef in (cfg.get('efectos') or {}).items():
        if solo and nombre not in solo:
            continue
        CH._debug['carpeta'], CH._debug['nombre'] = revision, 'efecto_' + nombre
        c = efecto_recorte(hoja_orig, ef) if ef.get('modo') == 'recorte' else CH.extraer_efecto(hoja, hoja_orig, ef)
        if c:
            c = escalar_cuadro(dict(c, escala=1.0), float(ef.get('escala', 1) or 1) * _estado['escalaGlobal'])
            c['ax'], c['ay'] = c['img'].width / 2.0, c['img'].height / 2.0
            efectos[nombre] = [c]
        print(f'efecto {nombre}: {"listo " + str(c["img"].size) if c else "VACÍO"}')

    # Caché en el formato del extractor compartido (su main() arma el atlas con esto).
    cache = os.path.join(carpeta_cache, 'cuadros.json')
    previos = {}
    if solo and os.path.exists(cache):
        with open(cache) as f:
            previos = json.load(f)
    if not solo:
        for archivo in os.listdir(carpeta_cuadros):
            if archivo.endswith('.png'):
                os.remove(os.path.join(carpeta_cuadros, archivo))
    pares = list(finales.items()) + [('efecto:' + k, {'cuadros': v, 'impactos': []}) for k, v in efectos.items()]
    for nombre, r in pares:
        prefijo = nombre.replace(':', '_') + '_'
        for archivo in os.listdir(carpeta_cuadros):
            if archivo.startswith(prefijo) and archivo[len(prefijo):-4].isdigit():
                os.remove(os.path.join(carpeta_cuadros, archivo))
        entradas = []
        for i, c in enumerate(r['cuadros']):
            archivo = f'{prefijo}{i}.png'
            c['img'].save(os.path.join(carpeta_cuadros, archivo))
            entradas.append({'archivo': archivo, 'ax': c['ax'], 'ay': c['ay']})
        previos[nombre] = {'cuadros': entradas, 'impactos': r['impactos']}
    validos = set(animaciones) | {'efecto:' + k for k in (cfg.get('efectos') or {})}
    previos = {k: v for k, v in previos.items() if k in validos}
    with open(cache, 'w') as f:
        json.dump(previos, f)

    def cargar(nombre):
        lista = []
        for e in previos.get(nombre, {}).get('cuadros', []):
            img = Image.open(os.path.join(carpeta_cuadros, e['archivo'])).convert('RGBA')
            lista.append({'img': img, 'ax': e['ax'], 'ay': e['ay']})
        return lista

    todos_finales = {k: {'cuadros': cargar(k)} for k in previos if not k.startswith('efecto:')}
    todos_efectos = {k.split(':', 1)[1]: cargar(k) for k in previos if k.startswith('efecto:')}
    ref = todos_finales['quieto']['cuadros'][0]['img'].height if todos_finales.get('quieto') else 0
    if revision:
        for nombre, r in finales.items():
            ES.tira_revision(nombre, r['cuadros'], revision, ref)
        for nombre, lista in efectos.items():
            lista[0]['img'].save(os.path.join(revision, f'efecto_{nombre}.png'))
        lamina({k: v['cuadros'] for k, v in todos_finales.items()}, todos_efectos, ref, revision,
               f'{pid}: alturaReferencia {ref}')
    print(f"máscaras: {_estado['inferencias']} inferidas, {_estado['del_cache']} del caché")

    if args.sin_atlas:
        return
    if cfg.get('retratoDesde') and not solo:
        procesar_retrato(cfg, crudos, salida, revision)

    armar_atlas(cfg, previos, carpeta_cuadros, alias, salida)


def armar_atlas(cfg, previos, carpeta_cuadros, alias, salida):
    """atlas.json + la imagen, con el formato de extraer_sprites.main(). Los cuadros repetidos (un
    cuadro prestado a otra animación, los alias) comparten el MISMO rectángulo: no se duplican
    píxeles. Se guarda en WebP sin pérdida si pesa menos que el PNG."""
    unicos, claves = [], {}
    indice = {}
    for nombre, r in previos.items():
        indice[nombre] = []
        for e in r['cuadros']:
            img = Image.open(os.path.join(carpeta_cuadros, e['archivo'])).convert('RGBA')
            clave = hashlib.sha1(img.tobytes() + repr(img.size).encode()).hexdigest()
            if clave not in claves:
                claves[clave] = len(unicos)
                unicos.append({'img': img})
            indice[nombre].append((claves[clave], e['ax'], e['ay']))
    ancho, alto, pos = ES.empaquetar(unicos)
    atlas_img = Image.new('RGBA', (max(1, ancho), max(1, alto)), (0, 0, 0, 0))
    for c, (x, y) in zip(unicos, pos):
        atlas_img.alpha_composite(c['img'], (x, y))

    def cuadro_json(k, ax, ay):
        (x, y), im = pos[k], unicos[k]['img']
        return {'x': x, 'y': y, 'w': im.width, 'h': im.height, 'ax': ax, 'ay': ay}

    anims, efs = {}, {}
    for nombre, lista in indice.items():
        bloque = {'cuadros': [cuadro_json(*t) for t in lista]}
        if nombre.startswith('efecto:'):
            efs[nombre.split(':', 1)[1]] = bloque
        else:
            bloque['impactos'] = previos[nombre].get('impactos', [])
            anims[nombre] = bloque
    for nombre, al in alias.items():
        fuente = anims.get(al['alias'])
        if not fuente:
            print(f'AVISO: el alias {nombre} apunta a {al["alias"]}, que no está', file=sys.stderr)
            continue
        idxs = al.get('usar') or list(range(len(fuente['cuadros'])))
        anims[nombre] = {'cuadros': [dict(fuente['cuadros'][i]) for i in idxs], 'impactos': al.get('impactos', [])}
    anims = {k: anims[k] for k in CLAVES if k in anims}
    faltan = [k for k in CLAVES if k not in anims]
    if faltan:
        print('AVISO: faltan animaciones:', ', '.join(faltan), file=sys.stderr)
    for k, a in anims.items():
        malos = [i for i in a['impactos'] if not (0 <= i < len(a['cuadros']))]
        if malos:
            print(f'AVISO: {k}: impactos fuera de rango {malos}', file=sys.stderr)
    png = os.path.join(salida, 'atlas.png')
    webp = os.path.join(salida, 'atlas.webp')
    atlas_img.save(png, optimize=True)
    atlas_img.save(webp, 'WEBP', lossless=True, quality=100, method=6, exact=False)
    t_png, t_webp = os.path.getsize(png), os.path.getsize(webp)
    if t_webp < t_png * 0.95:
        imagen = 'atlas.webp'
        os.remove(png)
    else:
        imagen = 'atlas.png'
        os.remove(webp)
    datos = {
        'version': 1,
        'personaje': cfg['personaje'],
        'imagen': imagen,
        'alturaReferencia': anims['quieto']['cuadros'][0]['h'] if 'quieto' in anims else None,
        'animaciones': anims,
        'efectos': efs,
    }
    with open(os.path.join(salida, 'atlas.json'), 'w') as f:
        json.dump(datos, f, separators=(',', ':'))
    print(f'atlas {ancho}x{alto}, {len(unicos)} cuadros únicos → {imagen} '
          f'({os.path.getsize(os.path.join(salida, imagen)) // 1024} KB; PNG {t_png // 1024} KB, WebP {t_webp // 1024} KB)')


if __name__ == '__main__':
    os.environ.setdefault('OMP_NUM_THREADS', '3')
    main()

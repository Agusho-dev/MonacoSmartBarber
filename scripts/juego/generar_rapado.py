#!/usr/bin/env python3
"""
Genera los sprites «rapados» del remate «¡AL CERO!» de «Corte Final».

Cuando el ganador remata la partida, al perdedor le vuela el pelo (o la gorra) y queda pelado.
Este script arma, para cada personaje, en public/juego/personajes/<id>/:

  rapado.png + rapado.json   los cuadros de «danio» y «ko» con la cabeza pelada. Cada cuadro
                             conserva EXACTAMENTE w, h, ax, ay del atlas original (el render los
                             cambia 1 a 1) y la misma cantidad y orden de cuadros. Para Chipi,
                             además, extras.gorra: la gorra recortada como sprite suelto (pivote
                             al centro) para que el render la tire girando.
  retrato_rapado.webp        retrato.webp pelado (mismo tamaño y encuadre).
  cara_rapado.webp           cara.webp pelada (mismo tamaño y encuadre).

  rapado.json lleva además, opcionales para el render: «cabezas» (centro del cráneo de cada
  cuadro, en px del cuadro como ax/ay) y, en extras.gorra, «desfase» (centro de la gorra menos
  centro del cráneo): con los dos se larga la gorra o los mechones justo desde la cabeza.

Uso (desde MonacoSmartBarber/):
  python3 scripts/juego/generar_rapado.py                    # los dos personajes
  python3 scripts/juego/generar_rapado.py simon --qa /tmp/x  # uno, con hojas comparativas
  python3 scripts/juego/generar_rapado.py --actualizar-huellas  # tras un cambio del atlas

El atlas lo regenera OTRO proceso (extraer_sprites.py y sus envoltorios) y los cuadros cambian de
orden, de recorte o se espejan. Por eso cada entrada de la config se reconoce por CONTENIDO: su
huella [w, h, ax, ay, md5] y una firma chica de la cabeza (alfa + luminancia). Si el cuadro cambió,
la entrada se reubica sola (corrimiento y/o espejo) y el script avisa; un cuadro sin config sale
CON pelo y con un AVISO. --actualizar-huellas reescribe la config contra el atlas actual.

Cómo se pinta la cabeza
-----------------------
No hay modelos de imagen: todo es geometría y color sacados del propio personaje.

* La forma: por cuadro hay una ELIPSE del cráneo (lo que queda debajo del pelo o la gorra) y una
  ZONA (polígono) con todo lo que hay que sacar (pelo, gorra, visera, su contorno). Dentro de la
  zona: lo que cae en el cráneo se pinta de piel; lo demás pasa a transparente. Fuera de la zona
  no se toca nada (cara, orejas, cuerpo).
* La luz: el cráneo se sombrea como una esfera achatada (normal de la elipse) con la luz del
  personaje; los tonos salen de la PALETA DE SU PROPIA CARA (k-means sobre la piel de sus
  cuadros), así queda la misma piel y la misma luz. Brillo en la coronilla (lóbulo especular)
  y una sombra apenas azulada de pelo al ras en los costados y la nuca.
* El contorno: 1 px oscuro siguiendo el cráneo nuevo; los píxeles de la cara que quedaron en el
  borde (antes tapados por el pelo) también se oscurecen para que la silueta siga cerrada.
* Retrato y cara: se pinta UNA cabeza pelada en la fuente en alta (juego-fuentes/<id>_full.jpg)
  y se pasa por el MISMO camino que usó extraer_sprites.py (máscara ISNet, recorte, LANCZOS),
  con el recorte del original: fuera de la cabeza los dos webp quedan idénticos al original.

Configuración: scripts/juego/personajes/rapado_<id>.json (coordenadas en px del cuadro; el píxel
(i, j) ocupa [i, i+1) x [j, j+1)). Ver la nota al principio de cada archivo.

Requisitos: numpy, scipy, pillow, opencv; rembg + onnxruntime sólo para retrato/cara (los mismos
que extraer_sprites.py).
"""

import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..', '..'))
PERSONAJES = os.path.join(RAIZ, 'public', 'juego', 'personajes')
CONFIGS = os.path.join(AQUI, 'personajes')

CRUZ = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)


# ─── Utilidades de geometría ─────────────────────────────────────────────────


def dentro_poligono(h, w, pts, esc=1.0, off=(0.0, 0.0)):
    """Máscara (h, w) de los píxeles cuyo CENTRO cae dentro del polígono (par-impar).

    pts en coordenadas de origen; esc/off las llevan a esta grilla: p' = p * esc - off.
    """
    ys, xs = np.mgrid[0:h, 0:w]
    px = xs + 0.5
    py = ys + 0.5
    dentro = np.zeros((h, w), bool)
    P = [((x * esc - off[0]), (y * esc - off[1])) for x, y in pts]
    n = len(P)
    for i in range(n):
        x1, y1 = P[i]
        x2, y2 = P[(i + 1) % n]
        if y1 == y2:
            continue
        cruza = ((y1 > py) != (y2 > py))
        xc = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
        dentro ^= cruza & (px < xc)
    return dentro


def marco_cabeza(h, w, craneo, esc=1.0, off=(0.0, 0.0)):
    """Coordenadas locales de la elipse del cráneo para cada píxel.

    craneo = [cx, cy, rx, ry, ang]: ang en grados, horario (la «arriba» de la cabeza girada).
    Devuelve u, v (v < 0 hacia la coronilla; u > 0 hacia la derecha local) y r = sqrt(u²+v²).
    """
    cx, cy, rx, ry, ang = craneo
    cx, cy, rx, ry = cx * esc - off[0], cy * esc - off[1], rx * esc, ry * esc
    a = math.radians(ang)
    ys, xs = np.mgrid[0:h, 0:w]
    dx = xs + 0.5 - cx
    dy = ys + 0.5 - cy
    # rotación inversa: imagen → local
    xl = dx * math.cos(a) + dy * math.sin(a)
    yl = -dx * math.sin(a) + dy * math.cos(a)
    u = xl / rx
    v = yl / ry
    return u, v, np.sqrt(u * u + v * v)


def normal_imagen(u, v, ang):
    """Normal de la «esfera» de la elipse, llevada a coordenadas de imagen (x der, y abajo, z al ojo)."""
    nz = np.sqrt(np.clip(1 - u * u - v * v, 0, 1))
    a = math.radians(ang)
    nx = u * math.cos(a) - v * math.sin(a)
    ny = u * math.sin(a) + v * math.cos(a)
    return nx, ny, nz


def normalizar(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def suave(a, b, x):
    """smoothstep de a a b."""
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mezclar(c1, c2, t):
    c1 = np.asarray(c1, float)
    c2 = np.asarray(c2, float)
    return c1 * (1 - t) + c2 * t


# ─── Paleta de piel ──────────────────────────────────────────────────────────


def rgb_a_lab(rgb):
    import cv2
    a = np.asarray(rgb, np.uint8).reshape(-1, 1, 3)
    return cv2.cvtColor(a, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)


def lab_a_rgb(lab):
    import cv2
    a = np.clip(np.asarray(lab, np.float32), 0, 255).astype(np.uint8).reshape(-1, 1, 3)
    return cv2.cvtColor(a, cv2.COLOR_LAB2RGB).reshape(-1, 3)


def es_piel(rgb):
    """Píxeles de piel (naranja/rosada) de estos personajes."""
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    return (r > 140) & (r - b > 45) & (g > 70) & (r > g) & (g > b)


def rampa_de_piel(muestras, n=6, semilla=7):
    """Rampa de n tonos de piel ordenada de oscuro a claro (k-means en Lab)."""
    import cv2
    lab = rgb_a_lab(muestras)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.3)
    cv2.setRNGSeed(semilla)
    _, lbl, cen = cv2.kmeans(lab, n, None, crit, 6, cv2.KMEANS_PP_CENTERS)
    orden = np.argsort(cen[:, 0])
    return lab_a_rgb(cen[orden]).astype(float)


# ─── Atlas: cuadros pelados ──────────────────────────────────────────────────


def cargar_atlas(pid):
    ruta = os.path.join(PERSONAJES, pid, 'atlas.json')
    with open(ruta) as f:
        datos = json.load(f)
    img = Image.open(os.path.join(PERSONAJES, pid, datos['imagen'])).convert('RGBA')
    return datos, img


def recortar(img, c):
    return np.asarray(img.crop((c['x'], c['y'], c['x'] + c['w'], c['y'] + c['h']))).copy()


def paleta_sprites(datos, img, cfg):
    """Paleta del cráneo para los sprites, sacada de la piel de la cara en los cuadros."""
    muestras = []
    for anim in ('quieto', 'danio', 'ko'):
        for c in datos['animaciones'][anim]['cuadros']:
            a = recortar(img, c)
            arriba = a[: max(8, int(c['h'] * 0.4))]
            m = (arriba[..., 3] > 0) & es_piel(arriba[..., :3])
            muestras.append(arriba[m][:, :3])
    muestras = np.concatenate(muestras)
    rampa = rampa_de_piel(muestras, n=6)
    p = cfg.get('paleta', {})
    azul = np.array(p.get('rasurado', [92, 104, 132]), float)
    claro = np.array(p.get('brillo', [255, 238, 222]), float)
    return {
        'rampa': rampa,
        # brillo: el tono más claro de la piel llevado hacia un blanco cálido
        'brillo1': mezclar(rampa[-1], claro, 0.45),
        'brillo2': mezclar(rampa[-1], claro, 0.85),
        'azul': azul,
        'contorno': np.array(cfg.get('contorno', [18, 14, 13]), float),
    }


def zona_de_cuadro(h, w, cc):
    """Máscara de lo que se saca (pelo o gorra) en un cuadro.

    Se arma con cualquiera de estas piezas (se unen) y después se restan las de «conservar»:
      columnas [x0, [l0, l1, ...]]        en la columna x0+k, las filas 0..l_k-1 (el pelo de
                                          arriba hasta la línea del nacimiento, columna por columna)
      filas    [y0, [l0, l1, ...], lado]  en la fila y0+k, las columnas < l_k (lado "izq") o
                                          >= l_k (lado "der"): el pelo de la nuca o del costado
      zona     [[x, y], ...] o lista de polígonos
      conservar  polígonos que NUNCA se tocan (una mano, una oreja, el ojo de atrás)
    """
    zona = np.zeros((h, w), bool)
    if cc.get('columnas'):
        x0, lims = cc['columnas']
        for k, lim in enumerate(lims):
            x = x0 + k
            if 0 <= x < w:
                zona[:max(0, min(h, lim)), x] = True
    for fila in cc.get('filas', []):
        y0, lims, lado = fila
        for k, lim in enumerate(lims):
            y = y0 + k
            if 0 <= y < h:
                if lado == 'izq':
                    zona[y, :max(0, min(w, lim))] = True
                else:
                    zona[y, max(0, min(w, lim)):] = True
    if cc.get('zona'):
        pols = cc['zona'] if isinstance(cc['zona'][0][0], (list, tuple)) else [cc['zona']]
        for pol in pols:
            zona |= dentro_poligono(h, w, pol)
    for pol in cc.get('conservar', []):
        zona &= ~dentro_poligono(h, w, pol)
    return zona


def ruido_fijo(h, w, semilla):
    """Ruido uniforme en [-1, 1] reproducible (misma semilla → mismos píxeles)."""
    return np.random.default_rng(semilla).random((h, w)) * 2 - 1


def vecinos(m):
    """Cantidad de vecinos (8) en True de cada píxel."""
    k = np.ones((3, 3), int)
    k[1, 1] = 0
    return ndimage.convolve(m.astype(int), k, mode='constant')


def color_craneo(u, v, r, ang, cc, pal, cfg, semilla):
    """Color de cada píxel del cráneo pelado (sin contorno), estilo pixel art del atlas."""
    h, w = u.shape
    L = normalizar(cc.get('luz', cfg.get('luz', [0.45, -0.75, 0.5])))
    nx, ny, nz = normal_imagen(u, v, ang)
    difusa = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    Hv = normalizar(L + np.array([0, 0, 1.0]))
    espec = np.clip(nx * Hv[0] + ny * Hv[1] + nz * Hv[2], 0, 1) ** cfg.get('brilloExp', 30)
    # tono: la luz del personaje, el borde más oscuro (oclusión) y un poco de ruido para que
    # tenga la misma textura granulada que la cara (las bandas lisas delatan el parche)
    ruido = ruido_fijo(h, w, semilla)
    t = difusa - 0.20 * suave(0.80, 1.0, r) + cfg.get('ruido', 0.07) * ruido
    t = t + cc.get('tono', 0.0)
    rampa = pal['rampa']
    umbrales = cc.get('umbrales', cfg.get('umbrales', [0.10, 0.26, 0.44, 0.70, 0.93]))
    idx = np.clip(np.digitize(t, umbrales), 0, len(rampa) - 1)
    color = rampa[idx]
    # sombra apenas azulada de pelo al ras: los costados (abajo del domo) y la nuca, del lado
    # opuesto a la cara; arriba no se ve porque la tapa el brillo
    f = cc.get('frente', 1)
    atras = suave(-0.05, 0.65, -u * f)
    costado = suave(-0.25, 0.35, v)
    borde = suave(0.55, 0.92, r)
    ras = np.clip(atras * costado * 1.1 + atras * borde * 0.6, 0, 1)
    ras = ras * cc.get('ras', cfg.get('ras', 1.0))
    color = mezclar(color, pal['azul'], ras[..., None] * cfg.get('rasFuerza', 0.30))
    # brillo de la coronilla: un racimo chico + un píxel casi blanco
    b1 = espec > cc.get('brillo1', cfg.get('brillo1', 0.62))
    b2 = espec > cc.get('brillo2', cfg.get('brillo2', 0.93))
    color[b1] = pal['brillo1']
    color[b2] = pal['brillo2']
    return color


def pintar_cuadro(rgba, cc, pal, cfg, semilla=1):
    """Pela la cabeza de UN cuadro del atlas. Devuelve el RGBA nuevo (mismo tamaño)."""
    h, w = rgba.shape[:2]
    alfa = rgba[..., 3] > 0
    zona = zona_de_cuadro(h, w, cc)
    ang = cc['craneo'][4]
    u, v, r = marco_cabeza(h, w, cc['craneo'])
    # la apertura 2x2 saca los píxeles sueltos de las puntas de la elipse (el «pezón» de un
    # píxel arriba del domo que delata la rasterización)
    craneo = ndimage.binary_opening(r <= 1.0, structure=np.ones((2, 2), bool))
    pinta = craneo & zona
    nuevo_alfa = (alfa & ~zona) | pinta
    for pol in cc.get('piel_extra', []):  # cuello / nuca que el pelo tapaba
        extra = dentro_poligono(h, w, pol) & zona & ~pinta
        pinta |= extra
        nuevo_alfa |= extra
    rgb = rgba[..., :3].astype(float)
    lum = rgb.mean(-1)

    # restos oscuros (sombra del flequillo, una punta de pelo) rodeados por el cráneo nuevo:
    # se pintan con el cráneo. Sólo los que quedaron casi encerrados (≥ 6 de 8 vecinos).
    for _ in range(2):
        resto = craneo & alfa & ~pinta & (lum < 90) & (vecinos(pinta) >= 6)
        pinta |= resto
        nuevo_alfa |= resto

    out = rgba.astype(float).copy()
    color = color_craneo(u, v, r, ang, cc, pal, cfg, semilla)
    # empalme con la cara: el píxel pintado que toca piel conservada se acerca a ese tono
    piel_cara = alfa & ~pinta & es_piel(rgba[..., :3])
    suma = np.zeros((h, w, 3))
    cuenta = np.zeros((h, w))
    # vecinos con borde (sin np.roll: daría la vuelta y la fila 0 «vería» los pies)
    pp = np.pad(piel_cara, 1)
    pc = np.pad(rgb, ((1, 1), (1, 1), (0, 0)))
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        m = pp[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
        c = pc[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
        suma += c * m[..., None]
        cuenta += m
    toca = pinta & (cuenta > 0)
    prom = suma[toca] / cuenta[toca][:, None]
    color[toca] = color[toca] * 0.5 + prom * 0.5
    out[..., :3][pinta] = color[pinta]
    out[..., 3][pinta] = 255

    # limpieza cerca de la zona: puntas de contorno que quedaron colgando (≤ 1 vecino) y
    # manchitas sueltas del pelo viejo
    cerca = ndimage.binary_dilation(zona, iterations=3)
    oscuro = out[..., :3].mean(-1) < 75
    for _ in range(4):
        n4 = ndimage.convolve(nuevo_alfa.astype(int), np.array([[0, 1, 0], [1, 0, 1], [0, 1, 0]]),
                              mode='constant')
        punta = nuevo_alfa & ~pinta & cerca & oscuro & (n4 <= 1)
        if not punta.any():
            break
        nuevo_alfa &= ~punta
    lab, n = ndimage.label(nuevo_alfa, structure=np.ones((3, 3)))
    if n > 1:
        tam = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        for k in range(n):
            comp = lab == k + 1
            if tam[k] < 12 and (comp & cerca).any():
                nuevo_alfa &= ~comp

    # contorno de 1 px: borde del cráneo pintado contra lo transparente
    fuera = ~nuevo_alfa
    vecino_fuera = ndimage.binary_dilation(fuera, CRUZ) & nuevo_alfa
    borde_craneo = vecino_fuera & pinta
    # píxeles conservados que quedaron en el borde porque se fue el pelo de al lado
    destapado = alfa & ~nuevo_alfa
    borde_nuevo = ndimage.binary_dilation(destapado, CRUZ) & nuevo_alfa & ~pinta & cerca
    oscuro = out[..., :3].mean(-1) < 60
    for m in (borde_craneo, borde_nuevo & ~oscuro):
        out[..., :3][m] = pal['contorno']
    out[..., 3] = np.where(nuevo_alfa, 255, 0)
    out[..., :3][~nuevo_alfa] = 0
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


def empaquetar(piezas, ancho_max=1024, sep=2):
    """Acomoda las piezas en filas (estantes). Devuelve la imagen y las posiciones."""
    x = y = alto_fila = 0
    pos = []
    ancho = 0
    for p in piezas:
        h, w = p.shape[:2]
        if x + w > ancho_max:
            x = 0
            y += alto_fila + sep
            alto_fila = 0
        pos.append((x, y))
        x += w + sep
        alto_fila = max(alto_fila, h)
        ancho = max(ancho, x - sep)
    alto = y + alto_fila
    hoja = np.zeros((alto, ancho, 4), np.uint8)
    for (px, py), p in zip(pos, piezas):
        h, w = p.shape[:2]
        hoja[py:py + h, px:px + w] = p
    return hoja, pos


def huella(c, arr):
    """Identidad de un cuadro: tamaño, apoyo y hash de los píxeles."""
    import hashlib
    return [c['w'], c['h'], c['ax'], c['ay'], hashlib.md5(arr.tobytes()).hexdigest()[:10]]


def firma(arr, caja):
    """Firma chica de la región de la cabeza: alfa (1 bit) + luminancia (4 bits), en hex.

    Va dentro de la config («ref») para poder reubicar la entrada si el atlas cambia.
    """
    x0, y0, x1, y1 = caja
    reg = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
    h, w = arr.shape[:2]
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    reg[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = arr[sy0:sy1, sx0:sx1]
    alfa = (reg[..., 3] > 0).ravel()
    bits = np.packbits(alfa)
    lum = np.clip(reg[..., :3].astype(int).sum(-1) // 48, 0, 15).astype(int).ravel()
    return {'caja': list(caja), 'a': bits.tobytes().hex(), 'l': ''.join('%x' % v for v in lum)}


def leer_firma(f):
    x0, y0, x1, y1 = f['caja']
    n = (x1 - x0) * (y1 - y0)
    alfa = np.unpackbits(np.frombuffer(bytes.fromhex(f['a']), np.uint8))[:n].astype(bool)
    lum = np.array([int(ch, 16) for ch in f['l']], int)
    return alfa.reshape(y1 - y0, x1 - x0), lum.reshape(y1 - y0, x1 - x0)


def transformar_entrada(e, dx, dy, espejo=False):
    """Copia de una entrada de config espejada (en el ancho del cuadro original) y desplazada."""
    import copy
    e = copy.deepcopy(e)
    W = e['huella'][0]

    def px(x):
        return (W - x if espejo else x) + dx

    if e.get('craneo'):
        cx, cy, rx, ry, ang = e['craneo']
        e['craneo'] = [round(px(cx), 2), round(cy + dy, 2), rx, ry, -ang if espejo else ang]
    if e.get('columnas'):
        x0, lims = e['columnas']
        lims = [l if l <= 0 or l >= 999 else l + dy for l in lims]
        if espejo:
            x0, lims = W - (x0 + len(lims)), lims[::-1]
        e['columnas'] = [x0 + dx, lims]
    if e.get('filas'):
        filas = []
        for y0, lims, lado in e['filas']:
            if espejo:
                lims = [-999 if l >= 999 else (999 if l <= 0 else W - l) for l in lims]
                lado = 'izq' if lado == 'der' else 'der'
            lims = [l if abs(l) >= 999 else l + dx for l in lims]
            filas.append([y0 + dy, lims, lado])
        e['filas'] = filas
    for clave in ('zona', 'conservar', 'piel_extra'):
        if e.get(clave):
            pols = e[clave] if isinstance(e[clave][0][0], (list, tuple)) else [e[clave]]
            e[clave] = [[[px(x), y + dy] for x, y in pol] for pol in pols]
    if e.get('_vista'):
        x0, y0, x1, y1 = e['_vista']
        if espejo:
            x0, x1 = W - x1, W - x0
        e['_vista'] = [x0 + dx, y0 + dy, x1 + dx, y1 + dy]
    if espejo and 'frente' in e:
        e['frente'] = -e['frente']
    if espejo and e.get('luz'):
        e['luz'] = [-e['luz'][0]] + list(e['luz'][1:])
    return e


def alinear(cfg, arr, maxd=(24, 12)):
    """Reubica una entrada de config sobre un cuadro que cambió: prueba cada firma, derecha y
    espejada, con todos los corrimientos, y se queda con la que mejor calza."""
    h, w = arr.shape[:2]
    alfa_n = arr[..., 3] > 0
    lum_n = np.clip(arr[..., :3].astype(int).sum(-1) // 48, 0, 15).astype(int)
    mejor = (1e9, None)
    for e in cfg['cuadros']:
        if not e.get('ref'):
            continue
        a_r, l_r = leer_firma(e['ref'])
        x0, y0, x1, y1 = e['ref']['caja']
        W = e['huella'][0]
        for espejo in (False, True):
            if espejo:
                a_e, l_e, bx0 = a_r[:, ::-1], l_r[:, ::-1], W - x1
            else:
                a_e, l_e, bx0 = a_r, l_r, x0
            hh, ww = a_e.shape
            for dy in range(-maxd[1], maxd[1] + 1):
                for dx in range(-maxd[0], maxd[0] + 1):
                    X0, Y0 = bx0 + dx, y0 + dy
                    if X0 < -ww // 2 or Y0 < -hh // 2 or X0 > w - ww // 2 or Y0 > h - hh // 2:
                        continue
                    a_n = np.zeros((hh, ww), bool)
                    l_n = np.zeros((hh, ww), int)
                    sx0, sy0 = max(0, X0), max(0, Y0)
                    sx1, sy1 = min(w, X0 + ww), min(h, Y0 + hh)
                    if sx1 <= sx0 or sy1 <= sy0:
                        continue
                    a_n[sy0 - Y0:sy1 - Y0, sx0 - X0:sx1 - X0] = alfa_n[sy0:sy1, sx0:sx1]
                    l_n[sy0 - Y0:sy1 - Y0, sx0 - X0:sx1 - X0] = lum_n[sy0:sy1, sx0:sx1]
                    ambos = a_e & a_n
                    if ambos.sum() < 0.3 * a_e.sum():
                        continue
                    nota = (a_e != a_n).mean() + 0.5 * (np.abs(l_e - l_n)[ambos].mean() / 15)
                    if nota < mejor[0]:
                        mejor = (nota, (e, dx, dy, espejo))
    if mejor[1] is None or mejor[0] > 0.06:
        return None, mejor[0]
    e, dx, dy, espejo = mejor[1]
    return transformar_entrada(e, dx, dy, espejo), (mejor[0], dx, dy, espejo, e.get('_origen'))


def config_de_cuadro(cfg, c, arr):
    """Busca la config de un cuadro POR CONTENIDO, no por índice.

    El atlas lo regenera otro proceso y los cuadros pueden cambiar de lugar, de orden, de recorte
    o espejarse: cada entrada de cfg['cuadros'] guarda la huella del cuadro para el que se
    escribió y una firma de su cabeza. Devuelve (entrada, 'exacta' | 'alineada' | None):
    'alineada' = el cuadro cambió y la entrada se reubicó sola (corrimiento y/o espejo) por la
    firma; se aplica, con aviso, y conviene mirar la hoja de QA.
    """
    hu = huella(c, arr)
    for e in cfg['cuadros']:
        if e['huella'] == hu:
            return e, 'exacta'
    e, info = alinear(cfg, arr)
    if e is not None:
        e['_alineada'] = info
        return e, 'alineada'
    return None, None


def buscar_cuadro(datos, img, entrada, anims):
    """Encuentra en el atlas el cuadro de una entrada suelta (la de la gorra): primero por huella
    exacta, después reubicándola por la firma. Devuelve (rgba, entrada, 'anim[i]') o None."""
    cfg1 = {'cuadros': [entrada]}
    mejor = None
    for anim in anims:
        for i, c in enumerate(datos['animaciones'][anim]['cuadros']):
            a = recortar(img, c)
            if huella(c, a) == entrada['huella']:
                return a, entrada, f'{anim}[{i}]'
            e, info = alinear(cfg1, a)
            if e is not None and (mejor is None or info[0] < mejor[3][0]):
                mejor = (a, e, f'{anim}[{i}]', info)
    if mejor:
        print(f'AVISO: la gorra se reubicó en {mejor[2]} (nota {mejor[3][0]:.3f})', file=sys.stderr)
        return mejor[:3]
    return None


def recortar_gorra(datos, img, gcfg, pal):
    """La gorra de Chipi como sprite suelto, mirando a la derecha como los cuadros.

    gorra = tela de la zona (la misma definición que la zona de un cuadro): píxeles opacos y poco
    saturados (negro, gris del borde, el logo); nunca piel ni pelo. Se queda la mancha principal,
    se rellenan los huecos y el borde del corte (donde apoyaba en la cabeza) se cierra con el
    contorno oscuro. Devuelve (rgba, desfase centro_gorra - centro_cráneo en px del cuadro).
    """
    hallado = buscar_cuadro(datos, img, gcfg, [gcfg.get('anim', 'quieto')] + ['danio', 'ko'])
    if hallado is None:
        raise SystemExit('no encuentro el cuadro de la gorra: revisar «gorra» en la config')
    a, e, donde = hallado
    h, w = a.shape[:2]
    zona = zona_de_cuadro(h, w, e)
    rgb = a[..., :3].astype(int)
    sat = rgb.max(-1) - rgb.min(-1)
    lum = rgb.mean(-1)
    # tela neutra (negro, gris, el logo) o casi negra; la sombra rojiza de la frente y el pelo no
    tela = zona & (a[..., 3] > 0) & ((sat < gcfg.get('saturacionMax', 30)) | (lum < 32))
    lab, n = ndimage.label(tela, structure=np.ones((3, 3)))
    if n == 0:
        raise SystemExit('la zona de la gorra quedó vacía')
    tam = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    tela = ndimage.binary_fill_holes(lab == (int(np.argmax(tam)) + 1))
    out = a.copy()
    out[~tela] = 0
    # contorno: todo píxel del borde que no sea ya oscuro (sobre todo el corte de abajo)
    borde = tela & ndimage.binary_dilation(~tela, CRUZ)
    claro = out[..., :3].astype(int).mean(-1) >= 60
    out[..., :3][borde & claro] = pal['contorno']
    ys, xs = np.where(tela)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    recorte = out[y0:y1, x0:x1]
    cx, cy = e['craneo'][:2]
    desfase = [round((x0 + x1) / 2 - cx, 1), round((y0 + y1) / 2 - cy, 1)]
    print(f'gorra: de {donde}, {x1 - x0}x{y1 - y0} px')
    return recorte, desfase


def procesar_cuadros(pid, cfg):
    datos, img = cargar_atlas(pid)
    pal = paleta_sprites(datos, img, cfg)
    piezas, refs, avisos = [], [], []
    for anim in ('danio', 'ko'):
        for i, c in enumerate(datos['animaciones'][anim]['cuadros']):
            a = recortar(img, c)
            cc, como = config_de_cuadro(cfg, c, a)
            if cc is None:
                avisos.append(f'{pid} {anim}[{i}] {huella(c, a)}: sin config, queda CON pelo')
            elif como == 'alineada':
                nota, dx, dy, espejo, origen = cc['_alineada']
                avisos.append(f'{pid} {anim}[{i}]: el cuadro cambió; se reubicó la config de '
                              f'{origen} (dx={dx}, dy={dy}{", espejada" if espejo else ""}, '
                              f'nota {nota:.3f}). Revisar la hoja de QA.')
            if cc and cc.get('craneo'):
                a = pintar_cuadro(a, cc, pal, cfg, semilla=(100 if anim == 'ko' else 0) + i + 1)
            piezas.append(a)
            refs.append((anim, i, c, cc))
    for av in avisos:
        print('AVISO:', av, file=sys.stderr)
    return datos, img, pal, piezas, refs


# ─── Retrato y cara: la cabeza pelada en la fuente en alta ───────────────────


def poligonos(cfg, clave):
    v = cfg.get(clave)
    if not v:
        return []
    return v if isinstance(v[0][0], (list, tuple)) else [v]


def rampa_continua(muestras, n=48):
    """Color de piel en función de un tono 0..1 (percentiles de luminancia de la cara)."""
    lum = muestras.mean(1)
    orden = np.argsort(lum)
    m = muestras[orden].astype(float)
    # promedio por tramos de percentil: una rampa suave, sin el ruido de los píxeles sueltos
    cortes = np.linspace(0, len(m), n + 1).astype(int)
    tramos = np.array([m[a:b].mean(0) for a, b in zip(cortes[:-1], cortes[1:]) if b > a])
    tramos = ndimage.uniform_filter1d(tramos, 5, axis=0, mode='nearest')
    xs = np.linspace(0, 1, len(tramos))

    def color(t):
        t = np.clip(t, 0, 1)
        return np.stack([np.interp(t, xs, tramos[:, k]) for k in range(3)], -1)

    return color


def corregir_laplace(P, S, pinta, fijo):
    """Empalme sin costura: P + D, con D armónica en «pinta», D = S - P en los vecinos «fijo»
    (la frente que queda) y borde libre contra el contorno. Es el «seamless clone» de Pérez,
    pero sólo atado donde hay piel de verdad."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import spsolve
    h, w = pinta.shape
    idx = -np.ones((h, w), int)
    ys, xs = np.where(pinta)
    idx[ys, xs] = np.arange(len(ys))
    n = len(ys)
    filas, cols, vals = [], [], []
    b = np.zeros((n, 3))
    diag = np.full(n, 1e-4)  # regulariza manchas sin ningún vecino fijo (D → 0)
    G = S.astype(float) - P
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        yy, xx = ys + dy, xs + dx
        dentro = (yy >= 0) & (yy < h) & (xx >= 0) & (xx < w)
        yy_c, xx_c = np.clip(yy, 0, h - 1), np.clip(xx, 0, w - 1)
        vec_p = dentro & pinta[yy_c, xx_c]
        vec_f = dentro & fijo[yy_c, xx_c] & ~pinta[yy_c, xx_c]
        diag += vec_p + vec_f
        k = np.where(vec_p)[0]
        filas.append(k)
        cols.append(idx[yy_c[k], xx_c[k]])
        vals.append(-np.ones(len(k)))
        k = np.where(vec_f)[0]
        b[k] += G[yy_c[k], xx_c[k]]
    A = coo_matrix((np.concatenate(vals + [diag]),
                    (np.concatenate(filas + [np.arange(n)]), np.concatenate(cols + [np.arange(n)]))),
                   shape=(n, n)).tocsr()
    D = np.zeros((h, w, 3))
    sol = spsolve(A, b)
    D[ys, xs] = sol
    return D


def pintar_cabeza_grande(S, M, rc):
    """Pela la cabeza en la imagen fuente (RGB uint8, máscara bool). Devuelve (S2, M2, cambio)."""
    H, W = M.shape
    bx0, by0, bx1, by1 = rc['caja']
    s = S[by0:by1, bx0:bx1].astype(float)
    m = M[by0:by1, bx0:bx1].copy()
    h, w = m.shape
    off = (bx0, by0)
    zona = np.zeros((h, w), bool)
    for pol in poligonos(rc, 'zona'):
        zona |= dentro_poligono(h, w, pol, off=off)
    for pol in poligonos(rc, 'conservar'):
        zona &= ~dentro_poligono(h, w, pol, off=off)
    cx, cy, rx, ry, ang = rc['craneo']
    u, v, r = marco_cabeza(h, w, rc['craneo'], off=off)
    craneo = r <= 1.0
    # contorno grueso como el del dibujo, con el borde de afuera escalonado en bloques (pixel
    # art): el de adentro queda liso para que la piel no se vea serruchada
    T = rc.get('grosorContorno', 11)
    b = rc.get('bloque', 5)
    lejos = ndimage.distance_transform_edt(~craneo)
    lleno = craneo | (lejos <= T)
    gy, gx = (h + b - 1) // b, (w + b - 1) // b
    pad = np.zeros((gy * b, gx * b), bool)
    pad[:h, :w] = lleno
    celdas = pad.reshape(gy, b, gx, b).mean((1, 3)) > 0.5
    escalonado = np.kron(celdas, np.ones((b, b), bool))[:h, :w]
    silueta = craneo | (escalonado & (lejos <= T + b))
    pinta = craneo & zona
    contorno = silueta & ~craneo & zona
    m2 = (m & ~zona) | (silueta & zona)

    # sin gorra no hay sombra de visera: se aclara (en parte) la mitad de arriba de la cara,
    # con una ganancia que se apaga hacia la nariz. Multiplicar deja las cejas y los ojos oscuros.
    ac = rc.get('aclarar')
    if ac:
        reg = np.zeros((h, w), bool)
        for pol in poligonos(ac, 'region'):
            reg |= dentro_poligono(h, w, pol, off=off)
        reg &= m & ~zona
        yy = np.arange(h)[:, None] + by0
        peso = 1 - suave(ac['desde'], ac['hasta'], yy * np.ones((1, w)))
        peso = ndimage.gaussian_filter(peso * reg, 6) * reg
        g = 1 + (ac.get('ganancia', 1.25) - 1) * peso
        s = np.clip(s * g[..., None], 0, 255)

    # paleta: la piel de la propia cara (fuera de la zona), ordenada por luminancia
    cara = np.zeros((h, w), bool)
    for pol in poligonos(rc, 'muestraPiel'):
        cara |= dentro_poligono(h, w, pol, off=off)
    piel = cara & m & ~zona & es_piel(s.astype(np.uint8))
    color = rampa_continua(s[piel])
    L = normalizar(rc.get('luz', [-0.35, -0.65, 0.68]))
    nx, ny, nz = normal_imagen(u, v, ang)
    lamb = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    t0, t1 = rc.get('tonos', [0.18, 0.92])
    t = t0 + (t1 - t0) * lamb ** rc.get('gamma', 0.9)
    t = t - rc.get('oclusion', 0.18) * suave(0.80, 1.0, r)
    # variación lenta de la piel (el dibujo está pintado a mano, no es un degradé de vector)
    rng0 = np.random.default_rng(rc.get('semilla', 5) + 1)
    mancha = ndimage.gaussian_filter(rng0.standard_normal((h, w)), rc.get('manchaTam', 5.0))
    t = t + rc.get('mancha', 0.035) * mancha / (mancha.std() + 1e-6)
    P = color(t)

    # empalme con la frente que queda (Laplace atado sólo a la piel de verdad, y sólo a la piel
    # con luz: la sombra que dejaba la visera no tiene que oscurecer el domo)
    lum_s = s.mean(-1)
    fijo = m & ~zona & es_piel(s.astype(np.uint8)) & (lum_s > rc.get('fijoLum', 0))
    D = corregir_laplace(P, s, pinta, fijo)
    lim = rc.get('limiteEmpalme', 60)
    D = np.clip(D, -lim, lim)
    # la corrección se apaga lejos de la cara: el domo vuelve a su propia luz
    alcance = rc.get('empalmeAlcance')
    if alcance:
        D = D * np.exp(-ndimage.distance_transform_edt(~fijo) / alcance)[..., None]
    # fundido: unos px de la frente que queda se mezclan con la pintura continuada, así no hay
    # escalón de textura en el borde. Sólo piel clara: las cejas y los ojos no se tocan.
    F = rc.get('fundido', 6)
    dist, (iy, ix) = ndimage.distance_transform_edt(~pinta, return_indices=True)
    piel_s = es_piel(s.astype(np.uint8))
    banda = (dist > 0) & (dist <= F) & m & ~zona & piel_s & (lum_s > rc.get('fundidoLum', 125))
    alfa_f = ((1 - dist / (F + 1)) * 0.9)[..., None]
    Pext = P + D[iy, ix]
    fundir = banda[..., None] * alfa_f
    s = s * (1 - fundir) + Pext * fundir
    # lo oscuro que toca la pintura (el borde de arriba de una ceja que tapaba la visera) se
    # mezcla un poco, para que no quede cortado a regla; el contorno negro no se toca
    canto = (dist > 0) & (dist <= 1.5) & m & ~zona & ~piel_s & (lum_s > 35)
    k_c = rc.get('suavizarCanto', 0.35)
    s[canto] = s[canto] * (1 - k_c) + Pext[canto] * k_c
    P = P + D

    # pelo al ras: sombra apenas azulada fuera de la frente (más en los costados que arriba)
    frente = np.zeros((h, w), bool)
    for pol in poligonos(rc, 'frente'):
        frente |= dentro_poligono(h, w, pol, off=off)
    afuera = ndimage.distance_transform_edt(~frente)
    borde_frente = suave(0, rc.get('degradeNacimiento', 14), afuera)
    costados = suave(-0.2, 0.75, np.abs(u) * 0.8 + np.clip(v, -1, 1) * 0.6)
    arriba = 1 - suave(-0.9, -0.35, v)
    ras = borde_frente * np.clip(0.45 + 0.55 * costados - 0.25 * arriba, 0, 1)
    rng = np.random.default_rng(rc.get('semilla', 5))
    grano = ndimage.gaussian_filter(rng.standard_normal((h, w)), 0.9)
    grano = grano / (grano.std() + 1e-6)
    azul = np.array(rc.get('rasurado', [70, 82, 108]), float)
    fuerza = rc.get('rasFuerza', 0.26)
    k = np.clip(ras * fuerza * (1 + 0.35 * grano), 0, 0.6)[..., None]
    P = P * (1 - k) + azul * k

    # brillo en la coronilla: un lóbulo suave alargado siguiendo el domo y un destello chico,
    # ubicados en coordenadas del cráneo (si saliera de la luz, en esta pose caería en la frente)
    blanco = np.array(rc.get('brillo', [255, 244, 232]), float)
    bu, bv = rc.get('brilloEn', [-0.26, -0.70])
    su, sv = rc.get('brilloTam', [0.34, 0.15])
    d = ((u - bu) / su) ** 2 + ((v - bv) / sv) ** 2
    lobulo = (1 - suave(0.15, 1.0, d))[..., None] * rc.get('brilloFuerza', 0.55)
    P = P * (1 - lobulo) + blanco * lobulo
    du, dv = rc.get('destelloEn', [bu - 0.07, bv - 0.01])
    d2 = ((u - du) / (su * 0.32)) ** 2 + ((v - dv) / (sv * 0.42)) ** 2
    nucleo = (1 - suave(0.45, 1.0, d2))[..., None] * 0.85
    P = P * (1 - nucleo) + blanco * nucleo

    out = s.copy()
    out[pinta] = P[pinta]
    negro = np.array(rc.get('contorno', [8, 7, 8]), float)
    out[contorno] = negro
    # lo que se fue (pelo fuera del cráneo) queda negro: si algo se cuela al achicar, es contorno
    out[zona & ~m2] = negro
    S2 = S.copy()
    S2[by0:by1, bx0:bx1] = np.clip(np.round(out), 0, 255).astype(np.uint8)
    M2 = M.copy()
    M2[by0:by1, bx0:bx1] = m2
    cambio = np.zeros((H, W), bool)
    cambio[by0:by1, bx0:bx1] = zona | pinta | contorno
    return S2, M2, cambio


def tubo_retrato(S, M, bbox, tam, caja_cara):
    """El MISMO camino que extraer_sprites.procesar_retrato, con el recorte fijado al original."""
    img = Image.fromarray(np.dstack([S, (M * 255).astype(np.uint8)]))
    retrato = img.crop(tuple(bbox)).resize(tuple(tam), Image.LANCZOS)
    cara = img.crop(tuple(caja_cara))
    lado = max(cara.size)
    cuadrada = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
    cuadrada.alpha_composite(cara, ((lado - cara.width) // 2, (lado - cara.height) // 2))
    return retrato, cuadrada.resize((256, 256), Image.LANCZOS)


def procesar_retrato(pid, rc, qa=None):
    """retrato_rapado.webp y cara_rapado.webp: la cabeza se pela UNA vez en la fuente en alta y
    se pasa por el camino de extraer_sprites.py (máscara ISNet, recorte, LANCZOS) con el recorte
    del retrato original, así las dos quedan iguales al original fuera de la cabeza."""
    sys.path.insert(0, AQUI)
    import extraer_sprites as ex
    with open(os.path.join(CONFIGS, f'{pid}.json')) as f:
        r = json.load(f)['retrato']  # fuente, alto y caja de la cara: los del otro proceso
    fuente = os.path.normpath(os.path.join(CONFIGS, r['fuente']))
    S = np.asarray(Image.open(fuente).convert('RGB'))
    M = ex.limpiar(ex.mascara_isnet(Image.fromarray(S)) >= 0.5)
    img0 = Image.fromarray(np.dstack([S, (M * 255).astype(np.uint8)]))
    bbox = img0.getbbox()
    alto = int(r.get('alto', 720))
    ancho = round((bbox[2] - bbox[0]) * alto / (bbox[3] - bbox[1]))
    carpeta = os.path.join(PERSONAJES, pid)
    # ¿el retrato publicado sigue saliendo de este camino?
    ret0, cara0 = tubo_retrato(S, M, bbox, (ancho, alto), r['cara'])
    pub_r = np.asarray(Image.open(os.path.join(carpeta, 'retrato.webp')).convert('RGBA'))
    pub_c = np.asarray(Image.open(os.path.join(carpeta, 'cara.webp')).convert('RGBA'))
    iguales = (pub_r.shape[:2] == (alto, ancho)
               and (np.abs(pub_r[..., 3].astype(int) - np.asarray(ret0)[..., 3]) > 40).sum() < 50
               and (np.abs(pub_c[..., 3].astype(int) - np.asarray(cara0)[..., 3]) > 40).sum() < 50)
    S2, M2, cambio = pintar_cabeza_grande(S, M, rc)
    ret1, cara1 = tubo_retrato(S2, M2, bbox, (ancho, alto), r['cara'])
    if not iguales:
        # el otro proceso tocó el retrato por otro camino: se pega SÓLO la cabeza sobre el
        # publicado, para no pisarle nada fuera de la cabeza
        print(f'AVISO: {pid}: retrato/cara publicados no salen del camino de extraer_sprites; '
              'se pega sólo la cabeza', file=sys.stderr)
        zona_c = Image.fromarray((ndimage.binary_dilation(cambio, iterations=8) * 255).astype(np.uint8))
        for nombre, nuevo, pub, caja, tam in (
                ('retrato', ret1, pub_r, bbox, (ancho, alto)), ('cara', cara1, pub_c, r['cara'], (256, 256))):
            mz = zona_c.crop(tuple(caja))
            if nombre == 'cara':
                lado = max(mz.size)
                q = Image.new('L', (lado, lado), 0)
                q.paste(mz, ((lado - mz.width) // 2, (lado - mz.height) // 2))
                mz = q
            mz = np.asarray(mz.resize(tam, Image.BILINEAR)).astype(float)[..., None] / 255
            mezcla = np.asarray(nuevo).astype(float) * mz + pub.astype(float) * (1 - mz)
            if nombre == 'retrato':
                ret1 = Image.fromarray(np.round(mezcla).astype(np.uint8))
            else:
                cara1 = Image.fromarray(np.round(mezcla).astype(np.uint8))
    ret1.save(os.path.join(carpeta, 'retrato_rapado.webp'), 'WEBP', quality=90, method=6)
    cara1.save(os.path.join(carpeta, 'cara_rapado.webp'), 'WEBP', quality=90, method=6)
    print(f'{pid}: retrato_rapado.webp {ret1.size[0]}x{ret1.size[1]}, cara_rapado.webp 256x256'
          + ('' if iguales else ' (pegado sobre el publicado)'))
    if qa:
        hoja_retrato(pid, carpeta, qa)


def hoja_retrato(pid, carpeta, qa):
    """Original | pelado del retrato y de la cara, sobre oscuro y sobre gris."""
    os.makedirs(qa, exist_ok=True)
    for nombre, esc in (('retrato', 1), ('cara', 2)):
        o = Image.open(os.path.join(carpeta, f'{nombre}.webp')).convert('RGBA')
        p = Image.open(os.path.join(carpeta, f'{nombre}_rapado.webp')).convert('RGBA')
        o = o.resize((o.width * esc, o.height * esc), Image.LANCZOS)
        p = p.resize((p.width * esc, p.height * esc), Image.LANCZOS)
        W = o.width * 4 + 50
        lienzo = Image.new('RGBA', (W, o.height + 30), (0, 0, 0, 255))
        d = ImageDraw.Draw(lienzo)
        x = 10
        for fondo in ((24, 22, 28, 255), (128, 128, 128, 255)):
            for k, im in enumerate((o, p)):
                caja = Image.new('RGBA', im.size, fondo)
                caja.alpha_composite(im)
                lienzo.paste(caja, (x, 25))
                d.text((x + 4, 6), f'{nombre} {"orig" if k == 0 else "pelado"}', fill=(255, 220, 0, 255))
                x += im.width + 10
        lienzo.convert('RGB').save(os.path.join(qa, f'qa_{pid}_{nombre}.png'))


# ─── Programa ────────────────────────────────────────────────────────────────


def cargar_config(pid):
    with open(os.path.join(CONFIGS, f'rapado_{pid}.json')) as f:
        return json.load(f)


def json_compacto(obj, ind=0):
    """JSON legible: los cuadros (dicts chicos) y las listas de números en una sola línea."""
    sp = ' ' * ind
    plano = json.dumps(obj, ensure_ascii=False)

    def sin_dicts(o):
        return not isinstance(o, dict) and (not isinstance(o, list) or all(sin_dicts(v) for v in o))

    if not isinstance(obj, (dict, list)) or len(plano) <= 100 or (sin_dicts(obj) and len(plano) <= 400):
        return plano
    if isinstance(obj, dict):
        items = [f'{sp} {json.dumps(k, ensure_ascii=False)}: {json_compacto(v, ind + 1)}'
                 for k, v in obj.items()]
        return '{\n' + ',\n'.join(items) + '\n' + sp + '}'
    return '[\n' + ',\n'.join(f'{sp}  ' + json_compacto(v, ind + 2) for v in obj) + '\n' + sp + ' ]'


def generar(pid, qa=None):
    cfg = cargar_config(pid)
    datos, img, pal, piezas, refs = procesar_cuadros(pid, cfg)
    salida = os.path.join(PERSONAJES, pid)
    extras = {}
    if cfg.get('gorra'):
        gorra, centro_gorra = recortar_gorra(datos, img, cfg['gorra'], pal)
        piezas = piezas + [gorra]
    hoja, pos = empaquetar(piezas)
    animaciones = {'danio': {'cuadros': []}, 'ko': {'cuadros': []}}
    cabezas = {'danio': [], 'ko': []}
    for (anim, i, c, cc), (x, y) in zip(refs, pos):
        animaciones[anim]['cuadros'].append(
            {'x': x, 'y': y, 'w': c['w'], 'h': c['h'], 'ax': c['ax'], 'ay': c['ay']})
        cr = cc.get('craneo') if cc else None
        cabezas[anim].append([round(cr[0], 1), round(cr[1], 1)] if cr else None)
    if cfg.get('gorra'):
        x, y = pos[-1]
        h, w = gorra.shape[:2]
        # desfase (opcional para el render): centro de la gorra menos centro del cráneo, en px
        # del atlas y mirando a la derecha; con «cabezas» ubica la gorra justo sobre la cabeza
        extras['gorra'] = {'cuadros': [{'x': x, 'y': y, 'w': w, 'h': h, 'ax': w / 2, 'ay': h / 2}],
                           'desfase': centro_gorra}
    Image.fromarray(hoja).save(os.path.join(salida, 'rapado.png'), optimize=True)
    js = {'version': 1, 'imagen': 'rapado.png', 'animaciones': animaciones}
    if extras:
        js['extras'] = extras
    # Opcional para el render: centro del cráneo de cada cuadro en px del cuadro (mismo sistema
    # que ax/ay). Sirve para largar la gorra y los mechones desde la cabeza.
    js['cabezas'] = cabezas
    with open(os.path.join(salida, 'rapado.json'), 'w') as f:
        f.write(json_compacto(js) + '\n')
    print(f'{pid}: rapado.png {hoja.shape[1]}x{hoja.shape[0]}, {len(refs)} cuadros'
          + (', gorra' if extras else ''))
    if qa:
        hojas_qa(pid, img, refs, piezas, qa)
    if cfg.get('retrato'):
        procesar_retrato(pid, cfg['retrato'], qa)


def hojas_qa(pid, img, refs, piezas, carpeta, esc=4):
    """Original | pelado, cada cuadro x4, sobre fondo oscuro y sobre gris."""
    os.makedirs(carpeta, exist_ok=True)
    for anim in ('danio', 'ko'):
        filas = []
        for (a, i, c, cc), p in zip(refs, piezas):
            if a != anim:
                continue
            o = recortar(img, c)
            filas.append((i, o, p))
        for nombre, fondo in (('oscuro', (24, 22, 28, 255)), ('gris', (128, 128, 128, 255))):
            W = sum((o.shape[1] * 2 * esc + 3 * esc + 12) for _, o, _ in filas) + 12
            H = max(o.shape[0] for _, o, _ in filas) * esc + 34
            lienzo = Image.new('RGBA', (W, H), fondo)
            d = ImageDraw.Draw(lienzo)
            x = 12
            for i, o, p in filas:
                for k, arr in enumerate((o, p)):
                    im = Image.fromarray(arr)
                    im = im.resize((im.width * esc, im.height * esc), Image.NEAREST)
                    lienzo.alpha_composite(im, (x, 26))
                    d.text((x, 6), f'{anim}{i} {"orig" if k == 0 else "pelado"}', fill=(255, 220, 0, 255))
                    x += im.width + (esc * 3 if k == 0 else 12)
            lienzo.convert('RGB').save(os.path.join(carpeta, f'qa_{pid}_{anim}_{nombre}.png'))


def actualizar_huellas(pid):
    """Reescribe la config contra el atlas ACTUAL: a cada cuadro de danio/ko le busca su entrada
    (exacta o reubicada por la firma), la guarda ya corrida/espejada con la huella y la firma
    nuevas, en el orden del atlas. Las entradas que ya no corresponden a ningún cuadro se van."""
    ruta = os.path.join(CONFIGS, f'rapado_{pid}.json')
    cfg = cargar_config(pid)
    datos, img = cargar_atlas(pid)
    nuevas = []
    for anim in ('danio', 'ko'):
        for i, c in enumerate(datos['animaciones'][anim]['cuadros']):
            a = recortar(img, c)
            e, como = config_de_cuadro(cfg, c, a)
            if e is None:
                print(f'{pid} {anim}[{i}]: SIN config (hay que escribirla a mano)', file=sys.stderr)
                continue
            e = dict(e)
            e.pop('_alineada', None)
            e['_origen'] = f'{anim}{i}'
            e['huella'] = huella(c, a)
            if e.get('_vista'):
                e['ref'] = firma(a, e['_vista'])
            orden = ['_origen', 'huella', '_vista', 'craneo', 'columnas', 'filas', 'zona', 'conservar',
                     'piel_extra', 'frente', 'luz']
            e = {k: e[k] for k in orden if k in e} | {k: v for k, v in e.items() if k not in orden}
            nuevas.append(e)
            print(f'{pid} {anim}[{i}]: {como}')
    cfg['cuadros'] = nuevas
    with open(ruta, 'w') as f:
        f.write(json_compacto(cfg) + '\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('personajes', nargs='*', default=['simon', 'chipi'])
    ap.add_argument('--qa', help='carpeta para las hojas comparativas')
    ap.add_argument('--actualizar-huellas', action='store_true',
                    help='reescribe la config contra el atlas actual (después de que cambie) y sale')
    args = ap.parse_args()
    for pid in args.personajes:
        if args.actualizar_huellas:
            actualizar_huellas(pid)
        else:
            generar(pid, args.qa)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Extractor de sprites de Joaquín, Nahuel y Lucas para «Corte Final» (agente sprites, 30/oct/2026).
extraer_nahuel.py y extraer_lucas.py son envoltorios de una línea que llaman a este.

Uso (desde MonacoSmartBarber/, con el candado del modelo):
  OMP_NUM_THREADS=3 python3 scripts/juego/extraer_joaquin.py scripts/juego/personajes/joaquin.json \
      [--solo quieto,golpe] [--revision <carpeta>] [--retrato] [--sin-atlas]

Importa scripts/juego/extraer_sprites.py (compartido: NO se edita) y usa su separación por manchas,
su limpieza, su punto de apoyo, su empaquetado y sus tiras de revisión. Le suma lo que piden estas
hojas, que son JPG de WhatsApp con la plantilla de 18 paneles:

1. La máscara de cada panel se arma con VENTANAS. El fondo de estos paneles es un degradé oscuro
   con un foco de luz, y una inferencia de isnet sobre el panel entero se traga medio fondo (probado
   con el quieto de Joaquín y el de Lucas). Un recorte rellenado a lo ANCHO (2,5:1 con el color del
   borde, el modo "ancho" de extraer_chipi.py) sale limpio aun con la ropa negra de Lucas. Acá se
   infieren ventanas de ~0,8 × el alto del panel cada 1/3 de ventana y se mezclan con peso
   triangular: cada píxel lo decide sobre todo la ventana que lo tiene más al centro. Las alfas se
   guardan en el caché (.cache/<id>/alfas, por el hash del recorte): cambiar cortes o polígonos no
   vuelve a correr el modelo.
2. Las hojas de 18 paneles no tienen MÁQUINA ni 2.ª HERRAMIENTA. herramienta1 y herramienta2 son
   ALIAS en atlas.json: los mismos rectángulos del atlas que el remate del combo y que la patada
   (o el golpe pesado de la hoja), sin duplicar píxeles. Ver "alias".
3. Escala por fila o por cuadro ("escala"), para que el barbero no cambie de tamaño entre filas de
   la hoja que están dibujadas a otra escala.
4. El atlas se guarda en PNG optimizado o en WebP sin pérdida, el que pese menos (el render y
   generar_rapado.py cargan la imagen que diga atlas.json).
5. retrato.webp y cara.webp salen de un cuadro de la hoja (estos barberos no tienen foto de cuerpo
   entero): ampliados con LANCZOS sobre colores "sangrados" hacia afuera (sin halo), un poco de
   nitidez y el borde del alfa afinado.

Formato del JSON (coordenadas siempre en px de la HOJA):
  raíz
    personaje, hoja, salida       como en extraer_sprites.py
    limpiezas   [{"nota", "poligono": [[x,y],...], "modo"?: "fondo" | "inpaint", "radio"?, "color"?}]
                o por color: {"nota", "zona": forma, "regla": {...}, "dilatar"?: px}. Se pintan
                sobre una COPIA de la hoja antes de inferir (la franja del título detrás de una
                cabeza que salta, letras) y, salvo "inpaint" o "soloPintar", además se restan de la
                máscara.
    sinFondo    {"tol": 14, "piso"?: N} (por animación o por cuadro también; false lo apaga): saca
                el fondo que el modelo se tragó inundando desde el fondo seguro por los píxeles del
                color del fondo estimado. NO sirve con ropa del mismo negro que el fondo (Lucas).
    ventana     {"ancho": 0.8, "paso": 0.333, "relacion": 2.5} (por animación también)
    alias       {"herramienta1": {"de": "combo", "cuadros": [4,5,6,7], "impactos": [2]}, ...}
                "cuadros" = índices en la animación de origen (ya con su "usar"); sin "cuadros",
                todos. "impactos" = índices dentro del alias.
    retrato     {"anim": "quieto", "cuadro": 0, "alto": 720, "cara": [x0, y0, lado],
                "pelarOscuro": 1} (px del cuadro SIN achicar, que mira a la derecha; "espejo": true
                lo da vuelta; pelarOscuro = pasadas que sacan el borde casi negro del recorte).
  por animación (un nombre que empieza con "_" es OCULTO: se extrae y se empaqueta para que otra
  animación lo tome prestado, pero no va al atlas.json)
    region      [x0,y0,x1,y1] el panel sin la franja del título.
    y UNA forma de separar los cuadros:
      cuadros   N: por manchas (ES.separar_cuadros).
      cortes    [[xa,xb], ...]: costura de arriba abajo que cruza la menor cantidad de máscara dentro
                de cada rango (cuadros que se tocan).
      cajas     [[x0,y0,x1,y1], ...]: un cuadro por caja.
    inferencia  "caja" (con cajas): cada caja con su propia inferencia "ancho" en vez de las
                ventanas (mejor con movimiento, humo y energía; peor con piso oscuro: Lucas).
    umbral, usar, impactos, espejo, ancla, ajusteY, componentes, recorteAbajo  (como el compartido)
    escala      factor para todos sus cuadros (filas dibujadas más grandes o más chicas).
    prestados   [{"pos": 3, "de": "caer", "cuadro": 0}, ...]: inserta en la lista final cuadros de
                otra animación (el MISMO rectángulo del atlas: no se duplican píxeles).
    quitar, quitarOscuro, excluir, limite... también valen para toda la animación.
    porCuadro   {"i": {...}} (i = índice ANTES de "usar"):
      limite    [formas]: sólo queda lo que cae adentro (formas = cajas o polígonos).
      excluir   [formas]: se saca.
      incluir   [formas]: se agrega todo lo de adentro (huecos que el modelo dejó).
      agregar   [formas]: se agrega la máscara del panel aunque caiga del otro lado de la costura.
      quitar    [regla]: saca los píxeles que cumplen la regla de color (ver condicion()).
      quitarSaturados [{"zona": forma, "sat": 45, "lumMin": 50}]: saca lo de color (fuego, chispas,
                destellos) dentro de la zona.
      quitarOscuro {"lumMax": 30, "desde": 0.4}: saca la sombra negra encerrada entre las piernas
                inundando por lo oscuro desde afuera, sólo debajo de esa fracción del alto (Nahuel:
                fondo, pelo y contorno del mismo negro). Nunca en cuadros cabeza abajo.
      reinferir [x0,y0,x1,y1]: una inferencia "ancho" propia de esa caja reemplaza la del panel.
      unirCaja  [[x0,y0,x1,y1], ...]: otra inferencia por caja que se SUMA (máximo de las alfas).
      modelo    "u2net" en vez de isnet (cuadros acrobáticos donde isnet pierde las piernas).
      umbral, espejo, escala, ajusteY, ancla, componentes, cerrar
      anclaZona [formas]: el apoyo X sale sólo de esa parte.
      anclaDx   px que se suman al apoyo X (positivo = el dibujo se corre a la izquierda).
  efectos (sprites sueltos para atlas.efectos; pivote al centro)
    {"caja": [...], "relacion": 1.0, "limite"?, "excluir"?, "quitar"?, "quitarSaturados"?,
     "umbral"?, "componentes"?: "principal", "limpia"?: true (usa la hoja con limpiezas),
     "rotar"?: grados, "espejo"?: true}
    o por color, para objetos que el modelo no ve sobre estelas (el gorro, el pañal, la pelota):
    {"caja", "modo": "color", "regla": {...}, "limite": [forma], "cerrar"?: px, "anillo"?: px de
     contorno oscuro, "lumAnillo"?: 70}

Con --revision deja: revision_<anim>.png (las tiras del compartido: piso verde, apoyo rojo, alto
de referencia celeste), panel_<anim>.png (la máscara de cada cuadro sobre el panel, las costuras
en magenta y una grilla en coordenadas de la hoja), efecto_<nombre>.png y lamina_<id>.png (todos
los cuadros del atlas a escala sobre la línea del piso).
"""
import argparse
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

_AQUI = os.path.dirname(os.path.abspath(__file__))
_REPO = '/Users/ignaciobaldovino/MSB_FULL/MonacoSmartBarber/scripts/juego'
for _d in (_AQUI, _REPO):
    if os.path.exists(os.path.join(_d, 'extraer_sprites.py')):
        sys.path.insert(0, _d)
        break
import extraer_sprites as ES  # noqa: E402

# Sube si cambia cómo se calcula la alfa de una ventana (invalida el caché de alfas).
VERSION_ALFA = 1
COLORES = [(255, 70, 70), (70, 200, 255), (255, 210, 40), (120, 255, 120), (255, 120, 255),
           (255, 150, 60), (150, 150, 255), (60, 255, 210), (255, 255, 255), (200, 120, 60)]


# ─── Formas y colores ────────────────────────────────────────────────────────

def rasterizar(formas, origen, tam):
    """Cajas [x0,y0,x1,y1] o polígonos [[x,y],...] en coords de hoja → máscara bool (alto, ancho)."""
    m = Image.new('L', tam, 0)
    d = ImageDraw.Draw(m)
    ox, oy = origen
    for f in formas or []:
        if len(f) == 4 and all(isinstance(v, (int, float)) for v in f):
            x0, y0, x1, y1 = f
            d.rectangle([x0 - ox, y0 - oy, x1 - ox - 1, y1 - oy - 1], fill=255)
        else:
            d.polygon([(x - ox, y - oy) for x, y in f], fill=255)
    return np.asarray(m) > 0


def saturados(rgb, zona, sat=45, lumMin=50):
    """Píxeles de color (fuego, chispas, destellos) dentro de una zona."""
    a = np.asarray(rgb).astype(np.int16)
    mx = a.max(axis=2)
    s = mx - a.min(axis=2)
    return zona & (s >= sat) & (mx >= lumMin)


def condicion(rgb, regla, origen, tam):
    """Píxeles que cumplen una regla de color dentro de su "zona" (forma en coords de hoja; sin
    zona, todo). Condiciones (se cumplen TODAS): lumMin, lumMax (máximo de los canales), satMin,
    satMax (máximo − mínimo), rMenosGMin/Max, gMenosBMin/Max, bMenosRMin/Max."""
    a = np.asarray(rgb).astype(np.int16)
    zona = rasterizar([regla['zona']], origen, tam) if 'zona' in regla else np.ones(a.shape[:2], bool)
    r_, g_, b_ = a[..., 0], a[..., 1], a[..., 2]
    lum = a.max(axis=2)
    sat = lum - a.min(axis=2)
    pruebas = {
        'lumMin': lambda v: lum >= v, 'lumMax': lambda v: lum <= v,
        'satMin': lambda v: sat >= v, 'satMax': lambda v: sat <= v,
        'rMenosGMin': lambda v: (r_ - g_) >= v, 'rMenosGMax': lambda v: (r_ - g_) <= v,
        'gMenosBMin': lambda v: (g_ - b_) >= v, 'gMenosBMax': lambda v: (g_ - b_) <= v,
        'bMenosRMin': lambda v: (b_ - r_) >= v, 'bMenosRMax': lambda v: (b_ - r_) <= v,
    }
    for k, f in pruebas.items():
        if k in regla:
            zona = zona & f(regla[k])
    return zona


def aplicar_limpiezas(hoja, limpiezas):
    """Pinta sobre una COPIA de la hoja lo que no es el barbero. Devuelve (hoja, máscara pintada)."""
    sucio = np.zeros((hoja.height, hoja.width), bool)
    if not limpiezas:
        return hoja, sucio
    a = np.asarray(hoja).copy()
    for lim in limpiezas:
        if 'regla' in lim:
            # por color dentro de una zona (fuego, arcos, chispas): {"zona": forma, "regla": {...}}
            m = condicion(a, {**lim['regla'], 'zona': lim['zona']}, (0, 0), hoja.size)
        else:
            m = rasterizar([lim['poligono']], (0, 0), hoja.size)
        if lim.get('dilatar'):
            m = ndimage.binary_dilation(m, iterations=int(lim['dilatar']))
            if 'zona' in lim:
                m &= rasterizar([lim['zona']], (0, 0), hoja.size)
        if lim.get('modo') == 'inpaint':
            # se reconstruye con lo que lo rodea (un destello pintado ENCIMA del cuerpo)
            import cv2
            a = cv2.inpaint(a, m.astype(np.uint8) * 255, int(lim.get('radio', 4)), cv2.INPAINT_TELEA)
            continue
        if not m.any():
            continue
        if lim.get('color'):
            color = np.array(lim['color'], np.uint8)
        else:
            anillo = ndimage.binary_dilation(m, iterations=4) & ~m
            px = a[anillo]
            oscuros = px[px.max(axis=1) < 70]
            color = np.median(oscuros if len(oscuros) else px, axis=0).astype(np.uint8)
        a[m] = color
        if not lim.get('soloPintar'):
            sucio |= m
    return Image.fromarray(a), sucio


# ─── Máscaras ────────────────────────────────────────────────────────────────

_sesiones = {}


def mascara_modelo(img_rgb, modelo='isnet'):
    """isnet-general-use (el del compartido, idéntico) o u2net: en algún cuadro acrobático isnet
    pierde las piernas y u2net no (con más fondo, que limpia sinFondo)."""
    if modelo == 'isnet':
        return ES.mascara_isnet(img_rgb)
    from rembg import new_session, remove
    if modelo not in _sesiones:
        _sesiones[modelo] = new_session(modelo)
    escala = 4 if max(img_rgb.size) < 400 else (2 if max(img_rgb.size) < 900 else 1)
    up = img_rgb.resize((img_rgb.width * escala, img_rgb.height * escala), Image.LANCZOS)
    m = remove(up, session=_sesiones[modelo], only_mask=True).resize(img_rgb.size, Image.LANCZOS)
    return np.asarray(m).astype(np.float32) / 255.0


def alfa_ancha(hoja, caja, relacion=2.5, modelo='isnet'):
    """Alfa 0..1 de una caja rellenada hasta la relación ancho:alto pedida con el color de su borde
    (2,5 para un luchador; 1 = cuadrada, para un objeto suelto)."""
    x0, y0, x1, y1 = caja
    rec = hoja.crop((x0, y0, x1, y1))
    a = np.asarray(rec)
    borde = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    color = tuple(int(v) for v in np.median(borde, axis=0))
    w = max(int(round(rec.height * relacion)), rec.width)
    h = max(int(round(rec.width / relacion)), rec.height)
    lienzo = Image.new('RGB', (w, h), color)
    off = ((w - rec.width) // 2, (h - rec.height) // 2)
    lienzo.paste(rec, off)
    m = mascara_modelo(lienzo, modelo)
    return m[off[1]:off[1] + rec.height, off[0]:off[0] + rec.width]


def alfa_caja_cacheada(hoja, caja, relacion, modelo, carpeta):
    """alfa_ancha con caché en disco (por el hash del recorte), como las ventanas."""
    rec = hoja.crop(tuple(caja))
    huella = json.dumps([VERSION_ALFA, 'caja', list(caja), relacion, modelo]).encode()
    ruta = os.path.join(carpeta, 'caja_' + hashlib.sha1(rec.tobytes() + huella).hexdigest()[:20] + '.npy')
    if os.path.exists(ruta):
        return np.load(ruta)
    a = alfa_ancha(hoja, caja, relacion, modelo)
    os.makedirs(carpeta, exist_ok=True)
    np.save(ruta, a)
    return a


def alfa_ventanas(hoja, region, ventana, carpeta):
    """Alfa del panel: ventanas "ancho" superpuestas mezcladas con peso triangular (con caché)."""
    x0, y0, x1, y1 = region
    h, W = y1 - y0, x1 - x0
    rel = float(ventana.get('relacion', 2.5))
    ancho_v = min(W, max(24, int(round(h * float(ventana.get('ancho', 0.8))))))
    paso = max(6, int(round(ancho_v * float(ventana.get('paso', 1 / 3)))))
    rec = hoja.crop(tuple(region))
    huella = json.dumps([VERSION_ALFA, list(region), ancho_v, paso, rel]).encode()
    clave = hashlib.sha1(rec.tobytes() + huella).hexdigest()[:20]
    ruta = os.path.join(carpeta, f'alfa_{clave}.npy')
    if os.path.exists(ruta):
        return np.load(ruta)
    xs = list(range(x0, x1 - ancho_v + 1, paso)) or [x0]
    if xs[-1] + ancho_v < x1:
        xs.append(x1 - ancho_v)
    acc = np.zeros((h, W), np.float32)
    pesos = np.zeros((h, W), np.float32)
    for vx in xs:
        a = alfa_ancha(hoja, (vx, y0, vx + ancho_v, y1), rel)
        n = a.shape[1]
        t = np.arange(n, dtype=np.float32)
        c = (n - 1) / 2.0
        p = np.clip(1 - np.abs(t - c) / (c + 1), 0.02, 1)
        acc[:, vx - x0:vx - x0 + n] += a * p[None, :]
        pesos[:, vx - x0:vx - x0 + n] += p[None, :]
    alfa = acc / np.maximum(pesos, 1e-6)
    os.makedirs(carpeta, exist_ok=True)
    np.save(ruta, alfa)
    return alfa


def binarizar(alfa, umbral):
    b = alfa >= float(umbral)
    return ndimage.binary_opening(b, structure=np.ones((2, 2)))


def fondo_estimado(rgb, seguro, sigma=10.0):
    """Color del fondo en cada píxel, interpolado desde los píxeles que seguro son fondo
    (convolución normalizada): el fondo de estos paneles es un degradé suave."""
    a = np.asarray(rgb).astype(np.float32)
    peso = seguro.astype(np.float32)
    out = np.zeros_like(a)
    den = ndimage.gaussian_filter(peso, sigma)
    for k in range(3):
        out[..., k] = ndimage.gaussian_filter(a[..., k] * peso, sigma)
    est = out / np.maximum(den, 1e-6)[..., None]
    # donde no hay fondo seguro cerca, una pasada más ancha
    falta = den < 0.02
    if falta.any():
        den2 = ndimage.gaussian_filter(peso, sigma * 4)
        for k in range(3):
            est[..., k] = np.where(falta, ndimage.gaussian_filter(a[..., k] * peso, sigma * 4) / np.maximum(den2, 1e-6), est[..., k])
    return est


def sin_fondo(rgb, M, alfa, tol=14, seguro=0.15, anillo=2, sigma=10.0, piso=0):
    """Saca de la máscara el fondo que el modelo se tragó (oscuro entre las piernas, detrás del
    cuerpo en los cuadros con movimiento): inunda desde el fondo seguro por los píxeles que tienen
    el color del fondo estimado (a menos de `tol`). El contorno negro del dibujo y el pelo o el
    cinturón son más oscuros que el fondo y frenan la inundación; al final se devuelve el anillo de
    contorno oscuro pegado a lo que quedó.
    piso = N: las N filas de abajo de la región que tienen color de fondo también son semilla (la
    sombra encerrada entre los pies llega al piso, pero el modelo la tomó como parte del cuerpo)."""
    a = np.asarray(rgb).astype(np.float32)
    fondo_seg = alfa < seguro
    est = fondo_estimado(rgb, fondo_seg, sigma)
    dif = np.abs(a - est).max(axis=2)
    parecido = dif < tol
    semillas = fondo_seg.copy()
    if piso:
        semillas[-int(piso):, :] |= parecido[-int(piso):, :]
    alcanzado = ndimage.binary_propagation(semillas, structure=np.ones((3, 3)), mask=semillas | parecido)
    limpio = M & ~alcanzado
    if anillo > 0:
        lum = a.max(axis=2)
        oscuro = lum < (est.max(axis=2) - 6)
        for _ in range(int(anillo)):
            limpio = limpio | (ndimage.binary_dilation(limpio) & M & oscuro)
    return limpio


def quitar_oscuro(rgb, M, lumMax=30, desde=0.35, anillo=1):
    """Para fondos casi negros (Nahuel: el fondo, el contorno y el pelo son el mismo negro, y ni el
    modelo ni sinFondo separan la sombra encerrada entre las piernas): inunda por los píxeles
    oscuros (lum <= lumMax) desde los oscuros que quedan AFUERA de la máscara, sólo debajo de la
    fracción `desde` del alto del cuadro (así no toca el pelo), y devuelve `anillo` px de contorno."""
    lum = np.asarray(rgb).astype(np.int16).max(axis=2)
    oscuro = lum <= int(lumMax)
    ys, _ = np.nonzero(M)
    if not len(ys):
        return M
    zona = np.zeros_like(M)
    zona[int(ys.min() + float(desde) * (ys.max() - ys.min())):, :] = True
    semillas = zona & oscuro & ~M
    alcanzado = ndimage.binary_propagation(semillas, structure=np.ones((3, 3)), mask=zona & oscuro)
    limpio = M & ~alcanzado
    for _ in range(int(anillo)):
        limpio = limpio | (ndimage.binary_dilation(limpio) & M & oscuro)
    return limpio


def costura(M, xa, xb):
    """Camino de arriba abajo (±1 px por fila) entre xa y xb que cruza la menor cantidad de máscara
    (el mismo criterio que extraer_chipi.py)."""
    xa, xb = max(0, xa), min(M.shape[1], xb)
    sub = M[:, xa:xb].astype(np.float32)
    h, w = sub.shape
    costo = sub * 10.0 + 0.01
    acc = costo.copy()
    atras = np.zeros((h, w), np.int8)
    for y in range(1, h):
        prev = acc[y - 1]
        izq = np.r_[np.inf, prev[:-1]] + 0.004
        der = np.r_[prev[1:], np.inf] + 0.004
        pila = np.vstack([izq, prev, der])
        k = np.argmin(pila, axis=0)
        acc[y] = costo[y] + pila[k, np.arange(w)]
        atras[y] = k - 1
    x = int(np.argmin(acc[-1]))
    camino = np.zeros(h, int)
    for y in range(h - 1, -1, -1):
        camino[y] = x
        if y > 0:
            x = x + int(atras[y][x])
    return camino + xa


# ─── Cuadros ─────────────────────────────────────────────────────────────────

def escalar_cuadro(c, s):
    """Reescala un cuadro (filas de la hoja dibujadas a otro tamaño). Bordes duros como el resto."""
    if c is None or abs(s - 1) < 1e-6:
        return c
    im = c['img']
    c['img_orig'] = im  # el retrato puede salir del cuadro sin achicar (más detalle)
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    chica = im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    a = np.asarray(chica).copy()
    a[..., 3] = np.where(a[..., 3] >= 110, 255, 0).astype(np.uint8)
    c['img'] = Image.fromarray(a)
    c['ax'] = round(c['ax'] * w / im.width, 1)
    c['ay'] = round(c['ay'] * h / im.height, 1)
    return c


def opciones(anim, i):
    return {**anim, **((anim.get('porCuadro') or {}).get(str(i)) or {})}


def extraer_animacion(hoja, sucio, nombre, anim, cfg, carpeta_alfas):
    """Devuelve (cuadros, debug) de una animación. Los cuadros ya vienen con "usar" aplicado."""
    region = [int(v) for v in anim['region']]
    x0, y0, x1, y1 = region
    ventana = {**(cfg.get('ventana') or {}), **(anim.get('ventana') or {})}
    alfa = alfa_ventanas(hoja, region, ventana, carpeta_alfas)
    umbral = float(anim.get('umbral', 0.5))
    sucio_r = sucio[y0:y1, x0:x1]
    M = binarizar(alfa, umbral) & ~sucio_r
    abajo = int(anim.get('recorteAbajo', 0))
    if abajo > 0:
        M[-abajo:, :] = False
    h, w = M.shape
    rgb = hoja.crop(tuple(region))
    M_crudo = M
    sf = anim.get('sinFondo', cfg.get('sinFondo'))
    if sf:
        M = sin_fondo(rgb, M, alfa, **(sf if isinstance(sf, dict) else {}))
    cams = []
    if 'cortes' in anim:
        cams = [costura(M, int(xa) - x0, int(xb) - x0) for xa, xb in anim['cortes']]
        xs = np.arange(w)[None, :]
        lados = []
        for i in range(len(cams) + 1):
            izq = cams[i - 1] if i > 0 else np.full(h, -1)
            der = cams[i] if i < len(cams) else np.full(h, w + 1)
            lados.append((xs >= izq[:, None]) & (xs < der[:, None]))
    elif 'cajas' in anim:
        lados = [rasterizar([c], (x0, y0), (w, h)) for c in anim['cajas']]
    else:
        lados = ES.separar_cuadros(M, int(anim['cuadros']))
        if len(lados) != int(anim['cuadros']):
            print(f"  AVISO {nombre}: se esperaban {anim['cuadros']} cuadros y se separaron {len(lados)}",
                  file=sys.stderr)
    cuadros, mascaras = [], []
    for i, lado in enumerate(lados):
        o = opciones(anim, i)
        oi = (anim.get('porCuadro') or {}).get(str(i)) or {}
        # Caja con inferencia propia: "reinferir" del cuadro, o cada caja con "inferencia": "caja".
        # Un recorte centrado en el barbero le da al modelo un sujeto claro (en los cuadros con
        # movimiento y humo, la ventana lo cortaba y se tragaba el fondo).
        caja_inf = o.get('reinferir')
        if caja_inf is None and anim.get('inferencia') == 'caja' and 'cajas' in anim:
            caja_inf = anim['cajas'][i]
        alfa_i = alfa
        if caja_inf is not None:
            bx0, by0, bx1, by1 = [int(v) for v in caja_inf]
            a2 = alfa_caja_cacheada(hoja, (bx0, by0, bx1, by1), float(ventana.get('relacion', 2.5)),
                                    o.get('modelo', 'isnet'), carpeta_alfas)
            alfa_i = alfa.copy()  # afuera de la caja manda la de ventanas (para estimar el fondo)
            cx0, cy0 = max(bx0, x0), max(by0, y0)
            cx1, cy1 = min(bx1, x1), min(by1, y1)
            alfa_i[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0] = a2[cy0 - by0:cy1 - by0, cx0 - bx0:cx1 - bx0]
        for caja_u in o.get('unirCaja') or []:
            # otra inferencia por caja que se SUMA (máximo de las alfas): una caja angosta conserva
            # la pierna de apoyo y una más ancha alcanza el pie de la patada
            ux0, uy0, ux1, uy1 = [int(v) for v in caja_u]
            a3 = alfa_caja_cacheada(hoja, (ux0, uy0, ux1, uy1), float(ventana.get('relacion', 2.5)),
                                    o.get('modelo', 'isnet'), carpeta_alfas)
            alfa_i = alfa_i.copy() if alfa_i is alfa else alfa_i
            cx0, cy0 = max(ux0, x0), max(uy0, y0)
            cx1, cy1 = min(ux1, x1), min(uy1, y1)
            sub = alfa_i[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]
            alfa_i[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0] = np.maximum(sub, a3[cy0 - uy0:cy1 - uy0, cx0 - ux0:cx1 - ux0])
            caja_inf = caja_inf if caja_inf is not None else caja_u
        sfi = oi.get('sinFondo', sf)
        if caja_inf is not None or 'umbral' in oi or isinstance(oi.get('sinFondo'), dict):
            Mi = binarizar(alfa_i, o.get('umbral', umbral)) & ~sucio_r
            if abajo > 0:
                Mi[-abajo:, :] = False
            if sfi:
                Mi = sin_fondo(rgb, Mi, alfa_i, **(sfi if isinstance(sfi, dict) else {}))
            Mi = Mi & lado
        elif sfi is False:
            Mi = M_crudo & lado
        else:
            Mi = M & lado
        if o.get('incluir'):
            Mi = Mi | (rasterizar(o['incluir'], (x0, y0), (w, h)) & lado)
        if o.get('agregar'):
            Mi = Mi | (M & rasterizar(o['agregar'], (x0, y0), (w, h)))
        if o.get('limite'):
            Mi = Mi & rasterizar(o['limite'], (x0, y0), (w, h))
        if o.get('excluir'):
            Mi = Mi & ~rasterizar(o['excluir'], (x0, y0), (w, h))
        for q in o.get('quitarSaturados') or []:
            Mi = Mi & ~saturados(rgb, rasterizar([q['zona']], (x0, y0), (w, h)),
                                 q.get('sat', 45), q.get('lumMin', 50))
        for regla in o.get('quitar') or []:
            Mi = Mi & ~condicion(rgb, regla, (x0, y0), (w, h))
        if o.get('quitarOscuro'):
            qo = o['quitarOscuro']
            Mi = quitar_oscuro(rgb, ES.limpiar(Mi, o.get('componentes', 'principal')), **(qo if isinstance(qo, dict) else {}))
        if o.get('cerrar'):
            r = int(o['cerrar'])
            Mi = Mi | (ndimage.binary_closing(Mi, structure=np.ones((2 * r + 1, 2 * r + 1))) & lado)
        Mi = ES.limpiar(Mi, o.get('componentes', 'principal'))
        c = ES.cuadro_desde_mascara(rgb, Mi, o, (x0, y0))
        if c is None:
            print(f'  {nombre}[{i}]: vacío, se omite', file=sys.stderr)
            continue
        zona = o.get('anclaZona')
        if zona:
            solo = Mi & rasterizar(zona, (x0, y0), (w, h))
            ys, xs_ = np.nonzero(solo)
            if len(xs_):
                sub = solo[ys.min():ys.max() + 1, xs_.min():xs_.max() + 1]
                ax = ES.ancla_x(sub, o.get('ancla', 'torso')) + (xs_.min() + x0 - c['origen'][0])
                if o.get('espejo'):
                    ax = c['img'].width - ax
                c['ax'] = round(float(ax), 1)
        if o.get('anclaDx'):
            c['ax'] = round(c['ax'] + float(o['anclaDx']), 1)
        c = escalar_cuadro(c, float(o.get('escala', 1) or 1))
        c['indice'] = i
        cuadros.append(c)
        mascaras.append((i, Mi))
    usar = anim.get('usar')
    if usar:
        cuadros = [cuadros[k] for k in usar if k < len(cuadros)]
    return cuadros, {'region': region, 'rgb': rgb, 'M': M, 'cams': cams, 'mascaras': mascaras}


def extraer_efecto(hoja, hoja_orig, ef):
    fuente = hoja if ef.get('limpia') else hoja_orig
    x0, y0, x1, y1 = [int(v) for v in ef['caja']]
    w, h = x1 - x0, y1 - y0
    rgb = fuente.crop((x0, y0, x1, y1))
    if ef.get('modo') == 'color':
        # objetos que el modelo no ve (el gorro en vuelo sobre las estelas): por color, con los
        # huecos tapados y un anillo de contorno oscuro pegado
        M = condicion(rgb, {**ef['regla'], 'zona': ef.get('zona', ef['caja'])}, (x0, y0), (w, h))
        r = int(ef.get('cerrar', 1))
        if r > 0:
            M = ndimage.binary_closing(M, structure=np.ones((2 * r + 1, 2 * r + 1)))
        M = ndimage.binary_fill_holes(M)
        if ef.get('anillo'):
            lum = np.asarray(rgb).astype(np.int16).max(axis=2)
            for _ in range(int(ef['anillo'])):
                M = M | (ndimage.binary_dilation(M) & (lum < int(ef.get('lumAnillo', 70))))
    else:
        alfa = alfa_ancha(fuente, (x0, y0, x1, y1), float(ef.get('relacion', 1.0)))
        M = binarizar(alfa, ef.get('umbral', 0.5))
    if ef.get('incluir'):
        M = M | rasterizar(ef['incluir'], (x0, y0), (w, h))
    if ef.get('limite'):
        M = M & rasterizar(ef['limite'], (x0, y0), (w, h))
    if ef.get('excluir'):
        M = M & ~rasterizar(ef['excluir'], (x0, y0), (w, h))
    for q in ef.get('quitarSaturados') or []:
        M = M & ~saturados(rgb, rasterizar([q['zona']], (x0, y0), (w, h)), q.get('sat', 45), q.get('lumMin', 50))
    for regla in ef.get('quitar') or []:
        M = M & ~condicion(rgb, regla, (x0, y0), (w, h))
    M = ES.limpiar(M, ef.get('componentes', 'principal'))
    ys, xs = np.nonzero(M)
    if not len(xs):
        return None
    rgba = np.dstack([np.asarray(rgb), (M * 255).astype(np.uint8)])
    img = Image.fromarray(np.ascontiguousarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]), 'RGBA')
    if ef.get('espejo'):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if ef.get('rotar'):
        img = img.rotate(float(ef['rotar']), resample=Image.NEAREST, expand=True)
        bb = img.getbbox()
        img = img.crop(bb) if bb else img
    return {'img': img, 'ax': img.width / 2.0, 'ay': img.height / 2.0, 'origen': [x0 + int(xs.min()), y0 + int(ys.min())]}


# ─── Retrato y cara ──────────────────────────────────────────────────────────

def sangrar(img):
    """RGBA con el color del borde extendido a los píxeles transparentes (así ampliar no deja halo)."""
    a = np.asarray(img).copy()
    opaco = a[..., 3] >= 128
    if opaco.all() or not opaco.any():
        return img
    _, (iy, ix) = ndimage.distance_transform_edt(~opaco, return_indices=True)
    a[..., :3] = a[iy, ix, :3]
    return Image.fromarray(a, 'RGBA')


def ampliar(img, w, h, nitidez=(1.6, 70, 2)):
    """LANCZOS sin halo: color sangrado, alfa aparte y con el borde afinado, y un poco de nitidez."""
    s = sangrar(img)
    rgb = s.convert('RGB').resize((w, h), Image.LANCZOS)
    if nitidez:
        r, p, t = nitidez
        rgb = rgb.filter(ImageFilter.UnsharpMask(radius=r, percent=p, threshold=t))
    alfa = img.split()[3].resize((w, h), Image.LANCZOS)
    a = np.asarray(alfa).astype(np.float32) / 255.0
    a = np.clip((a - 0.5) * 1.8 + 0.5, 0, 1)
    out = rgb.convert('RGBA')
    out.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    return out


def hacer_retrato(r, cuadros, salida, revision=None):
    """"cara" = [x0, y0, lado] en px del cuadro SIN achicar (si la animación lleva "escala")."""
    c = cuadros[r.get('anim', 'quieto')][int(r.get('cuadro', 0))]
    img = (c['img_orig'] if c.get('img_orig') is not None else c['img']).convert('RGBA')
    if r.get('espejo'):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    pelar = int(r.get('pelarOscuro', 1))
    if pelar > 0:
        # el borde del recorte arrastra 1 px del fondo casi negro de la hoja: ampliado ×6 se ve
        # como un contorno grueso. Se pelan los píxeles oscuros del borde (no los de adentro).
        a = np.asarray(img).copy()
        lum = a[..., :3].max(axis=2)
        for _ in range(pelar):
            M = a[..., 3] >= 128
            borde = M & ~ndimage.binary_erosion(M)
            a[..., 3] = np.where(borde & (lum < 45), 0, a[..., 3])
        img = Image.fromarray(a)
    bb = img.getbbox()
    img = img.crop(bb)
    alto = int(r.get('alto', 720))
    ancho = round(img.width * alto / img.height)
    ret = ampliar(img, ancho, alto)
    ret.save(os.path.join(salida, 'retrato.webp'), 'WEBP', quality=90, method=6)
    if r.get('cara'):
        cx0, cy0, lado = [int(v) for v in r['cara']]
        cuadrada = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
        cuadrada.alpha_composite(img.crop((max(0, cx0), max(0, cy0), min(img.width, cx0 + lado), min(img.height, cy0 + lado))),
                                 (max(0, -cx0), max(0, -cy0)))
        cara = ampliar(cuadrada, 256, 256)
        cara.save(os.path.join(salida, 'cara.webp'), 'WEBP', quality=90, method=6)
    if revision:
        ver = Image.new('RGBA', (ret.width + 300, max(ret.height, 256)), (58, 60, 70, 255))
        ver.alpha_composite(ret, (0, 0))
        if r.get('cara'):
            ver.alpha_composite(Image.open(os.path.join(salida, 'cara.webp')).convert('RGBA'), (ret.width + 30, 0))
        ver.convert('RGB').save(os.path.join(revision, 'retrato_y_cara.png'))
    print('retrato y cara listos')


# ─── Revisión ────────────────────────────────────────────────────────────────

def guardar_panel(dbg, ruta, esc=2):
    """El panel con la máscara final de cada cuadro (resto atenuado en verde), costuras y grilla.
    Cada cuadro lleva su índice ANTES de "usar" (el que usan porCuadro y las costuras)."""
    rgb = np.asarray(dbg['rgb']).copy()
    x0, y0, x1, y1 = dbg['region']
    h, w = rgb.shape[:2]
    alguno = np.zeros((h, w), bool)
    for _, Mi in dbg['mascaras']:
        alguno |= Mi
    v = rgb.copy()
    v[~alguno] = (v[~alguno] * 0.35 + np.array([0, 120, 0]) * 0.65).astype(np.uint8)
    for i, Mi in dbg['mascaras']:
        borde = Mi & ~ndimage.binary_erosion(Mi)
        v[borde] = COLORES[i % len(COLORES)]
    for cam in dbg['cams']:
        v[np.arange(h), np.clip(cam, 0, w - 1)] = (255, 0, 255)
    img = Image.fromarray(v).resize((w * esc, h * esc), Image.NEAREST)
    d = ImageDraw.Draw(img)
    for gx in range(((x0 + 9) // 10) * 10, x1, 10):
        px = (gx - x0) * esc
        d.line([(px, 0), (px, 3 if gx % 50 else 10)], fill=(255, 255, 0))
        if gx % 50 == 0:
            d.text((px + 2, 10), str(gx), fill=(255, 255, 0))
    for gy in range(((y0 + 9) // 10) * 10, y1, 10):
        py = (gy - y0) * esc
        d.line([(0, py), (3 if gy % 50 else 10, py)], fill=(0, 255, 255))
        if gy % 50 == 0:
            d.text((12, py - 5), str(gy), fill=(0, 255, 255))
    for i, Mi in dbg['mascaras']:
        ys, xs = np.nonzero(Mi)
        if len(xs):
            d.text((int(xs.mean()) * esc, int(ys.min()) * esc + 2), str(i), fill=COLORES[i % len(COLORES)])
    img.save(ruta)


def guardar_detalle(dbg, carpeta, nombre, esc=4, margen=10):
    """Cada cuadro ampliado sobre su recorte del panel (lo que queda afuera, atenuado en verde) con
    una grilla cada 10 px en coordenadas de la HOJA: para medir limite/excluir/incluir."""
    rgb = np.asarray(dbg['rgb'])
    x0, y0 = dbg['region'][:2]
    for i, Mi in dbg['mascaras']:
        ys, xs = np.nonzero(Mi)
        if not len(xs):
            continue
        a0, a1 = max(0, ys.min() - margen), min(rgb.shape[0], ys.max() + margen + 1)
        b0, b1 = max(0, xs.min() - margen), min(rgb.shape[1], xs.max() + margen + 1)
        v = rgb[a0:a1, b0:b1].copy()
        m = Mi[a0:a1, b0:b1]
        v[~m] = (v[~m] * 0.45 + np.array([0, 150, 0]) * 0.55).astype(np.uint8)
        img = Image.fromarray(v).resize(((b1 - b0) * esc, (a1 - a0) * esc), Image.NEAREST)
        d = ImageDraw.Draw(img)
        ox, oy = x0 + b0, y0 + a0
        for gx in range(((ox + 9) // 10) * 10, ox + (b1 - b0), 10):
            px = (gx - ox) * esc
            d.line([(px, 0), (px, img.height)], fill=(255, 0, 255) if gx % 50 == 0 else (70, 120, 220))
            d.text((px + 2, 2), str(gx), fill=(255, 255, 0))
        for gy in range(((oy + 9) // 10) * 10, oy + (a1 - a0), 10):
            py = (gy - oy) * esc
            d.line([(0, py), (img.width, py)], fill=(255, 0, 255) if gy % 50 == 0 else (70, 120, 220))
            d.text((2, py + 2), str(gy), fill=(0, 255, 255))
        img.save(os.path.join(carpeta, f'detalle_{nombre}_{i}.png'))


def lamina(atlas_json, imagen, ruta, titulo=''):
    """Todos los cuadros del atlas a escala 1:1, cada animación sobre su línea de piso."""
    anims = atlas_json['animaciones']
    ref = atlas_json['alturaReferencia']
    nombres = [k for k in ES.CLAVES if k in anims]
    filas = []
    for k in nombres:
        cs = anims[k]['cuadros']
        izq = max(c['ax'] for c in cs)
        der = max(c['w'] - c['ax'] for c in cs)
        alto = max(c['ay'] for c in cs)
        bajo = max(c['h'] - c['ay'] for c in cs)
        filas.append((k, cs, izq, der, alto, bajo))
    col_w = 1060
    columnas = [filas[:10], filas[10:]]
    alto_cols = []
    for col in columnas:
        alto_cols.append(sum(int(f[4] + f[5]) + 26 for f in col))
    H = max(alto_cols) + 40
    lienzo = Image.new('RGBA', (col_w * 2 + 20, H), (54, 56, 66, 255))
    d = ImageDraw.Draw(lienzo)
    d.text((10, 8), f'{titulo}  alturaReferencia={ref}px  (celeste = alto de referencia, verde = piso, rojo = apoyo)',
           fill=(255, 255, 255))
    for ci, col in enumerate(columnas):
        y = 30
        ox = ci * (col_w + 20)
        for k, cs, izq, der, alto, bajo in col:
            base = int(y + alto + 4)
            d.text((ox + 6, base - 14), k, fill=(255, 230, 120))
            imp = set(anims[k].get('impactos') or [])
            d.line([(ox + 90, base), (ox + col_w, base)], fill=(0, 220, 0))
            d.line([(ox + 90, base - ref), (ox + col_w, base - ref)], fill=(0, 190, 255))
            x = ox + 96 + izq
            paso = izq + der + 8
            for i, c in enumerate(cs):
                sp = imagen.crop((c['x'], c['y'], c['x'] + c['w'], c['y'] + c['h']))
                lienzo.alpha_composite(sp, (int(x - c['ax']), int(base - c['ay'])))
                d.line([(int(x), base - 4), (int(x), base + 4)], fill=(255, 60, 60))
                d.text((int(x) - 3, base + 4), ('*' if i in imp else '') + str(i), fill=(255, 120, 120) if i in imp else (200, 200, 200))
                x += paso
                if x > ox + col_w - 10:
                    break
            y = int(base + bajo + 22)
    lienzo.convert('RGB').save(ruta)


# ─── Principal ───────────────────────────────────────────────────────────────

def ruta(base, p):
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(base, p))


def armar_con_prestados(propios, nombre, prestados):
    """La lista final de una animación con cuadros PRESTADOS de otra: el mismo rectángulo del atlas
    (no se duplican píxeles). prestados = [{"pos": 2, "de": "caer", "cuadro": 0}, ...]: se insertan
    en orden, "pos" es la posición en la lista final; "cuadro" es el índice en la animación de
    origen ya con su "usar"."""
    lista = list(propios[nombre])
    for p in sorted(prestados, key=lambda p: p['pos']):
        src = propios.get(p['de']) or []
        if p['cuadro'] >= len(src):
            print(f'AVISO: {nombre} pide {p["de"]}[{p["cuadro"]}], que no existe', file=sys.stderr)
            continue
        lista.insert(min(int(p['pos']), len(lista)), dict(src[p['cuadro']]))
    return lista


def guardar_imagen_atlas(atlas_img, salida):
    """PNG optimizado o WebP sin pérdida: queda el que pese menos (y se borra el otro)."""
    png = os.path.join(salida, 'atlas.png')
    webp = os.path.join(salida, 'atlas.webp')
    atlas_img.save(png, optimize=True)
    atlas_img.save(webp, 'WEBP', lossless=True, quality=100, method=6)
    tp, tw = os.path.getsize(png), os.path.getsize(webp)
    if tw < tp:
        os.remove(png)
        return 'atlas.webp', tw, tp
    os.remove(webp)
    return 'atlas.png', tp, tw


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--solo', default='')
    ap.add_argument('--revision', default='')
    ap.add_argument('--sin-atlas', action='store_true')
    ap.add_argument('--retrato', action='store_true')
    ap.add_argument('--detalle', default='', help='animaciones con un recorte ampliado por cuadro (con --revision)')
    args = ap.parse_args(argv)
    os.environ.setdefault('OMP_NUM_THREADS', '3')

    config = os.path.abspath(args.config)
    base = os.path.dirname(config)
    with open(config) as f:
        cfg = json.load(f)
    hoja_orig = Image.open(ruta(base, cfg['hoja'])).convert('RGB')
    hoja, sucio = aplicar_limpiezas(hoja_orig, cfg.get('limpiezas'))
    salida = ruta(base, cfg['salida'])
    os.makedirs(salida, exist_ok=True)
    rev = args.revision or None
    if rev:
        os.makedirs(rev, exist_ok=True)
        if cfg.get('limpiezas'):
            hoja.save(os.path.join(rev, 'hoja_limpia.jpg'), quality=92)

    carpeta_cache = os.path.join(base, '.cache', cfg['personaje'])
    carpeta_cuadros = os.path.join(carpeta_cache, 'cuadros')
    carpeta_alfas = os.path.join(carpeta_cache, 'alfas')
    os.makedirs(carpeta_cuadros, exist_ok=True)
    cache = os.path.join(carpeta_cache, 'cuadros.json')
    solo = [s for s in args.solo.split(',') if s]
    previos = {}
    if os.path.exists(cache):
        with open(cache) as f:
            previos = json.load(f)
    if not solo:
        previos = {}

    resultado, debugs = {}, {}
    for nombre, anim in cfg['animaciones'].items():
        if solo and nombre not in solo:
            continue
        lista, dbg = extraer_animacion(hoja, sucio, nombre, anim, cfg, carpeta_alfas)
        resultado[nombre] = {'cuadros': lista, 'impactos': anim.get('impactos', [])}
        debugs[nombre] = dbg
        print(f'{nombre}: {len(lista)} cuadros  altos {[c["img"].height for c in lista]}')
    efectos = {}
    for nombre, ef in (cfg.get('efectos') or {}).items():
        if solo and nombre not in solo and ('efecto:' + nombre) not in solo:
            continue
        c = extraer_efecto(hoja, hoja_orig, ef)
        if c:
            efectos[nombre] = [c]
        print(f'efecto {nombre}: {"listo " + str(c["img"].size) if c else "VACÍO"}')

    # Caché con el formato del compartido (cuadros sueltos + apoyo), para rehacer sólo una parte.
    pares = list(resultado.items()) + [('efecto:' + k, {'cuadros': v, 'impactos': []}) for k, v in efectos.items()]
    for nombre, r in pares:
        prefijo = nombre.replace(':', '_') + '_'
        for archivo in os.listdir(carpeta_cuadros):
            if archivo.startswith(prefijo) and archivo[len(prefijo):-4].isdigit():
                os.remove(os.path.join(carpeta_cuadros, archivo))
        entradas = []
        for i, c in enumerate(r['cuadros']):
            archivo = f'{prefijo}{i}.png'
            c['img'].save(os.path.join(carpeta_cuadros, archivo))
            e = {'archivo': archivo, 'ax': c['ax'], 'ay': c['ay'], 'origen': c.get('origen')}
            if c.get('img_orig') is not None:
                e['original'] = f'{prefijo}{i}_original.png'
                c['img_orig'].save(os.path.join(carpeta_cuadros, e['original']))
            entradas.append(e)
        previos[nombre] = {'cuadros': entradas, 'impactos': r['impactos']}
    validos = set(cfg['animaciones']) | {'efecto:' + k for k in (cfg.get('efectos') or {})}
    previos = {k: v for k, v in previos.items() if k in validos}
    with open(cache, 'w') as f:
        json.dump(previos, f)

    def cargar(nombre):
        out = []
        for e in previos[nombre]['cuadros']:
            img = Image.open(os.path.join(carpeta_cuadros, e['archivo'])).convert('RGBA')
            c = {'img': img, 'ax': e['ax'], 'ay': e['ay']}
            if e.get('original') and os.path.exists(os.path.join(carpeta_cuadros, e['original'])):
                c['img_orig'] = Image.open(os.path.join(carpeta_cuadros, e['original'])).convert('RGBA')
            out.append(c)
        return out

    todos_cuadros = {k: cargar(k) for k in previos}
    ref = todos_cuadros['quieto'][0]['img'].height if todos_cuadros.get('quieto') else 0
    if rev:
        detalle = [s for s in args.detalle.split(',') if s]
        for nombre, r in resultado.items():
            ES.tira_revision(nombre, r['cuadros'], rev, ref)
            guardar_panel(debugs[nombre], os.path.join(rev, f'panel_{nombre}.png'))
            if nombre in detalle or 'todas' in detalle:
                guardar_detalle(debugs[nombre], rev, nombre)
        for nombre, lista in efectos.items():
            lista[0]['img'].save(os.path.join(rev, f'efecto_{nombre}.png'))
        for alias, a in (cfg.get('alias') or {}).items():
            if a['de'] in todos_cuadros:
                src = todos_cuadros[a['de']]
                idx = a.get('cuadros') or list(range(len(src)))
                ES.tira_revision(alias, [src[i] for i in idx if i < len(src)], rev, ref)

    if args.sin_atlas:
        return

    todos, indice = [], {}
    for nombre in previos:
        indice[nombre] = []
        for c in todos_cuadros[nombre]:
            indice[nombre].append(len(todos))
            todos.append(c)
    ancho, alto, pos = ES.empaquetar(todos)
    atlas_img = Image.new('RGBA', (max(1, ancho), max(1, alto)), (0, 0, 0, 0))
    for c, (x, y) in zip(todos, pos):
        atlas_img.alpha_composite(c['img'], (x, y))
    archivo_img, peso, peso_otro = guardar_imagen_atlas(atlas_img, salida)

    def cuadro_json(i):
        c, (x, y) = todos[i], pos[i]
        return {'x': x, 'y': y, 'w': c['img'].width, 'h': c['img'].height, 'ax': c['ax'], 'ay': c['ay']}

    anims, efs = {}, {}
    for nombre, idxs in indice.items():
        bloque = {'cuadros': [cuadro_json(i) for i in idxs]}
        if nombre.startswith('efecto:'):
            efs[nombre.split(':', 1)[1]] = bloque
        else:
            bloque['impactos'] = previos[nombre].get('impactos', [])
            anims[nombre] = bloque
    propios = {k: [dict(c) for c in v['cuadros']] for k, v in anims.items()}
    for nombre, anim in cfg['animaciones'].items():
        if nombre in anims and anim.get('prestados'):
            anims[nombre]['cuadros'] = armar_con_prestados(propios, nombre, anim['prestados'])
    for alias, a in (cfg.get('alias') or {}).items():
        src = anims.get(a['de'])
        if not src:
            print(f'AVISO: el alias {alias} apunta a {a["de"]}, que no está', file=sys.stderr)
            continue
        idx = a.get('cuadros') or list(range(len(src['cuadros'])))
        anims[alias] = {'cuadros': [dict(src['cuadros'][i]) for i in idx if i < len(src['cuadros'])],
                        'impactos': list(a.get('impactos', []))}
    faltan = [k for k in ES.CLAVES if k not in anims]
    if faltan:
        print('AVISO: faltan animaciones:', ', '.join(faltan), file=sys.stderr)
    for k, an in anims.items():
        for i in an.get('impactos', []):
            if i >= len(an['cuadros']):
                print(f'AVISO: {k} tiene impacto {i} fuera de rango ({len(an["cuadros"])} cuadros)', file=sys.stderr)
    salida_json = {
        'version': 1,
        'personaje': cfg['personaje'],
        'imagen': archivo_img,
        'alturaReferencia': anims['quieto']['cuadros'][0]['h'] if 'quieto' in anims else ref,
        'animaciones': {k: anims[k] for k in ES.CLAVES if k in anims},
        'efectos': efs,
    }
    with open(os.path.join(salida, 'atlas.json'), 'w') as f:
        json.dump(salida_json, f, separators=(',', ':'))
    print(f'atlas {ancho}x{alto}, {len(todos)} cuadros, {archivo_img} {peso // 1024} KB '
          f'(el otro formato pesaba {peso_otro // 1024} KB) → {salida}')
    if rev:
        # Las tiras de lo que el juego va a dibujar (con alias y prestados), recortadas del atlas.
        for k, an in salida_json['animaciones'].items():
            lista = [{'img': atlas_img.crop((c['x'], c['y'], c['x'] + c['w'], c['y'] + c['h'])),
                      'ax': c['ax'], 'ay': c['ay']} for c in an['cuadros']]
            ES.tira_revision('final_' + k, lista, rev, salida_json['alturaReferencia'])
        lamina(salida_json, atlas_img, os.path.join(rev, f'lamina_{cfg["personaje"]}.png'), cfg['personaje'])
    if args.retrato and cfg.get('retrato'):
        hacer_retrato(cfg['retrato'], todos_cuadros, salida, rev)


if __name__ == '__main__':
    main()

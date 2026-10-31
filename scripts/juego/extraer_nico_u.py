#!/usr/bin/env python3
"""
Extractor de sprites de «Corte Final» para la tanda del 30/oct/2026: Nico U., Fabri y Luciano.
`extraer_fabri.py` y `extraer_luciano.py` sólo llaman a este main(): el motor vive acá.

NO edita las herramientas compartidas: importa scripts/juego/extraer_sprites.py (ES: inferencia,
separación por manchas, apoyo, empaquetado, tiras de revisión) y usa las funciones puras de
scripts/juego/extraer_chipi.py (CH: formas, inferencia «ancho», máscaras de depuración, nubes).

Uso (desde MonacoSmartBarber/; el modelo, con el candado de la Mac):
  TURNO=ml $SP/herramientas/turno.sh env OMP_NUM_THREADS=3 python3 scripts/juego/extraer_nico_u.py \
      scripts/juego/personajes/nico_u.json --revision <carpeta> [--solo a,b] [--mascaras] [--retrato]
  (con --solo sólo rehace esas animaciones o efectos; el resto sale del caché, que vive en
  scripts/juego/personajes/.cache/<id> y no se versiona)

Qué deja en public/juego/personajes/<id>/: atlas.json + atlas.png o atlas.webp (el que pese menos,
los dos sin pérdida: el render carga lo que diga atlas.json), y con --retrato retrato.webp y cara.webp.
Con --revision: revision_<anim>.png (cada cuadro sobre la misma línea de piso: verde = piso,
celeste = alturaReferencia, rojo = apoyo X), lamina.png (todo el personaje a escala), efecto_*.png,
hoja_limpia.png y, con --mascaras, la máscara de cada cuadro sobre la hoja (mascara_<anim>_<i>.png).

Formato del JSON (rutas relativas al JSON; coordenadas SIEMPRE en px de la hoja):
  raíz
    personaje, hoja, salida     como en extraer_sprites.py
    porDefecto     opciones que valen para todas las animaciones (cada una las puede pisar)
    limpiezas     [{"nota", "poligono": [[x,y],...] | caja, "color"?: [r,g,b]}]: se pintan con el
                   fondo sobre una copia de la hoja ANTES de inferir (siluetas del rival, chispas,
                   humo) y además se restan de toda máscara.
    retrato        {"caja": [...], "espejo": true, "alto": 720, "cara": [x0,y0,x1,y1], "nitidez": 90,
                    + ediciones}: el cuadro que hace de retrato (no hay foto de cuerpo entero).
  por animación
    panel+cuadros  UNA inferencia sobre el panel (sin la franja del título) y separación por manchas
                   (ES.separar_cuadros), como el modo por defecto del extractor, pero cada cuadro admite
                   ediciones. "cortes": [[xa, xb], ...] la reemplaza por costuras (CH.costura); un corte
                   también puede ser una polilínea [[x, y], [x, y], ...] dibujada a mano (cuadros cuyas
                   piernas se meten debajo del anterior), y "auto" busca los huecos solo.
    variantes      [[dx0, dy0, dx1, dy1], ...]: la máscara del panel es la UNIÓN de inferencias con
                   recortes apenas corridos (isnet es inestable con estas hojas: 2 px de borde cambian
                   el resultado). Lo que la unión suma de fondo lo saca "fondoLiso".
    margenX        px de los costados del panel que no cuentan (la barra oscura del borde)
    cajas          un cuadro por caja, cada uno con su propia inferencia ("inferencia": "ancho" | "caja")
    umbral, recorteAbajo, componentes, ancla, ajusteY, espejo, usar, impactos   (del compartido)
    escala         factor de los cuadros (una fila dibujada más grande o más chica que el resto)
    pintar         [regla, ...]: ANTES de inferir, pinta sobre una copia de la hoja los píxeles de cada
                   regla (arcos de golpe, chispas, humo, estelas, fogonazos, vainas) con el color del
                   fondo o con "color": [r,g,b]. Regla = {"zona": caja o polígono, "excepto": formas,
                   condiciones: lumMin/lumMax (máx. de RGB), satMin/satMax, azulMin/azulMax (B-R),
                   rojoMin (R-B), verdeMin (G-máx(R,B)), bgMin (B-G: chispa rosa vs piel), rMin…bMax,
                   stdMax (lo blando: humo y estelas, no las suelas), protegerRojo (px alrededor del rojo
                   de las zapatillas), areaMax (sólo manchas chicas), crecer (px)}. Ojo: pintar con un
                   azul oscuro liso abre un puente para «fondoLiso»; para tapar algo SOBRE la ropa,
                   un negro no azulado ([27, 24, 24]).
    excluirPanel   formas que se sacan de la máscara del panel antes de separar (el rival, humo)
    apoyoX         (por cuadro) apoyo X a mano, en px de la hoja
    porCuadro      {"i": {...}} (i = mancha i de izquierda a derecha, ANTES de "usar"): cualquier
                   edición o "escala", "ajusteY", "espejo", "ancla", y "caja" + "inferencia"
                   ("ancho" | "caja") para que ese cuadro salga de su propia inferencia.
    ediciones (por animación o por cuadro; la del cuadro reemplaza a la de la animación):
      fondoLiso      true | {"std", "azul", "lumMax"} | [varias pasadas]: saca el fondo liso y azulado
                     que el modelo se tragó (la «sombra» entre las piernas), inundando desde el fondo
                     verdadero
      quitarLiso     [{"zona", "std": 6, "azul": 4, "lumMax": 90}]: lo mismo pero SÓLO dentro de la
                     zona y sembrando también desde sus dos filas de abajo: el fondo encerrado entre
                     las piernas que fondoLiso no alcanza (la franja del piso tiene textura y corta
                     la inundación). Va después de fondoLiso y antes de incluir
      incluir        formas que se agregan enteras
      agregar        formas: se agrega lo que la máscara del PANEL tiene ahí (un pie que la
                     separación le dio al vecino)
      crecer         {"zonas": [cajas], "dif": 34}: dentro de las zonas la máscara crece hacia los
                     píxeles que se despegan del fondo (herramientas finas que el modelo pierde)
      limite         sólo se conserva lo que cae adentro
      excluir        se saca
      quitarSaturados [{"zona", "sat", "lumMin"}] saca lo de color (chispas, fuego, humo teñido)
      recortarClaro  {"pasos", "lumMin", "lumMax", "sat"} pela del borde el gris claro (polvo)
      sinFondo       {"oscuro", "cierre", "margen"} (CH.quitar_fondo)
      rellenar       tapa huecos internos de menos de N px;  cerrar: radio de un cierre
      anclaZona      formas: el apoyo X sale sólo de esa parte (sin la moto, sin el bombo)
    sumar          [["danio", 4], ...]: suma al final cuadros de otra animación (mismos rectángulos).
                   La otra puede ser una animación AUXILIAR con nombre «_algo» (no está en CLAVES):
                   sus cuadros entran al atlas pero su nombre no va al atlas.json. Sirve para un
                   cuadro que necesita su propio panel (Fabri: el cierre de la Curación tiene la
                   cabeza arriba del panel de su fila).
    alias          {"de": "combo", "usar": [5, 6, 7], "impactos": [2]}: la animación usa LOS MISMOS
                   rectángulos del atlas que otra (hojas de 18 paneles: herramienta1 = remate del
                   combo, herramienta2 = la patada). No duplica píxeles.
  efectos
    "objeto"       un objeto recortado (inferencia "caja" | "ancho" + ediciones), pivote al centro,
                   "espejo" para que mire a la derecha
    "luz" / "nube" los del compartido y de CH
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

_AQUI = os.path.dirname(os.path.abspath(__file__))
_REPO = '/Users/ignaciobaldovino/MSB_FULL/MonacoSmartBarber'
for _d in (_AQUI, os.path.join(_REPO, 'scripts', 'juego')):
    if os.path.exists(os.path.join(_d, 'extraer_sprites.py')) and os.path.exists(os.path.join(_d, 'extraer_chipi.py')):
        sys.path.insert(0, _d)
        break
import extraer_sprites as ES  # noqa: E402
import extraer_chipi as CH  # noqa: E402

CLAVES = ES.CLAVES
_estado = {'sucio': None, 'debug': None}


# ─── escala por fila ─────────────────────────────────────────────────────────

_cdm_original = ES.cuadro_desde_mascara


def cuadro_desde_mascara(recorte_rgb, binaria, opts, origen):
    """El del compartido + "escala" (la fila de una hoja dibujada a otro tamaño)."""
    c = _cdm_original(recorte_rgb, binaria, opts, origen)
    s = float(opts.get('escala', 1) or 1)
    if c is None or abs(s - 1) < 1e-6:
        return c
    im = c['img']
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    a = np.asarray(im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')).copy()
    # bordes duros como el resto de los cuadros (el render dibuja sin suavizado)
    a[..., 3] = np.where(a[..., 3] >= 120, 255, 0).astype(np.uint8)
    c['img'] = Image.fromarray(a)
    c['ax'] = round(c['ax'] * w / im.width, 1)
    c['ay'] = round(c['ay'] * h / im.height, 1)
    return c


ES.cuadro_desde_mascara = cuadro_desde_mascara


# ─── ediciones de máscara ────────────────────────────────────────────────────

def _fondo_de(rgb, M):
    seguro = ~ndimage.binary_dilation(M, iterations=3)
    if seguro.sum() >= 50:
        return np.median(rgb[seguro].reshape(-1, 3), axis=0)
    borde = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return np.median(borde, axis=0)


def std_local(rgb, r=2):
    """Desvío estándar del color en una ventana (2r+1)²: el fondo de estas hojas es liso."""
    f = rgb.astype(np.float32)
    k = 2 * r + 1
    m = ndimage.uniform_filter(f, (k, k, 1))
    m2 = ndimage.uniform_filter(f * f, (k, k, 1))
    return np.sqrt(np.maximum(m2 - m * m, 0)).mean(axis=2)


def quitar_fondo_liso(rgb, Mi, M, std=2.5, azul=4, lumMax=70, abrir=1):
    """Saca de la máscara el fondo que el modelo se tragó (la «sombra» oscura entre las piernas y
    debajo del cuerpo): píxeles lisos, oscuros y azulados (el fondo de la hoja es #141a1f, la ropa
    es gris neutra y con textura) que se alcanzan desde el fondo verdadero sin cruzar el contorno
    del dibujo (el contorno tiene borde, no es liso, y frena la inundación)."""
    f = rgb.astype(np.float32)
    S = std_local(f)
    liso = (S < std) & ((f[..., 2] - f[..., 0]) >= azul) & (f.max(axis=2) < lumMax)
    semillas = liso & ~M
    # la base del panel también es fondo: entre los pies, el fondo sólo se alcanza por abajo
    semillas[-2:, :] |= liso[-2:, :]
    alcanzado = ndimage.binary_propagation(semillas, structure=np.ones((3, 3)), mask=liso)
    out = Mi & ~alcanzado
    if abrir:
        # el fleco de 1 px que queda donde estaba el fondo
        quedan = ndimage.binary_opening(out, structure=np.ones((3, 3)))
        borde = out & ~quedan & ndimage.binary_dilation(alcanzado, iterations=2)
        out &= ~borde
    return out


def quitar_liso_en_zona(rgb, Mi, zona, q):
    """El fondo liso y azulado que quedó encerrado entre las piernas (la «sombra» del piso) y que
    «fondoLiso» no alcanza porque la franja del piso del panel tiene textura y corta la inundación:
    DENTRO de la zona se saca lo liso (desvío 5x5 < std), azulado (B-R >= azul) y oscuro (máx RGB <
    lumMax) que se alcanza desde el afuera de la máscara o desde las dos filas de abajo de la zona.
    La ropa negra tiene textura y no es azulada: frena la inundación."""
    f = rgb.astype(np.float32)
    liso = zona & (std_local(f) < float(q.get('std', 6))) & ((f[..., 2] - f[..., 0]) >= float(q.get('azul', 4))) \
        & (f.max(axis=2) < float(q.get('lumMax', 90)))
    semillas = liso & ~Mi
    filas = np.nonzero(zona.any(axis=1))[0]
    if len(filas):
        semillas[filas.max() - 1:filas.max() + 1] |= liso[filas.max() - 1:filas.max() + 1]
    return Mi & ~ndimage.binary_propagation(semillas, structure=np.ones((3, 3)), mask=liso)


def editar(Mi, M, o, origen, tam, rgb):
    """Aplica las ediciones de un cuadro (formas en px de la hoja) sobre su máscara local."""
    def R(formas):
        return CH.rasterizar(formas, origen, tam)

    Mi = Mi.copy()
    if o.get('agregar'):
        Mi |= M & R(o['agregar'])
    crecer = o.get('crecer')
    if crecer:
        fondo = _fondo_de(rgb.astype(np.float32), Mi)
        dist = np.sqrt(((rgb.astype(np.float32) - fondo) ** 2).sum(axis=2))
        cand = R(crecer['zonas']) & (dist > float(crecer.get('dif', 34)))
        Mi = ndimage.binary_propagation(Mi, structure=np.ones((3, 3)), mask=Mi | cand)
    fl = o.get('fondoLiso')
    for paso in (fl if isinstance(fl, list) else [fl] if fl else []):
        # una lista = varias pasadas (p. ej. el fondo oscuro y la sombra del piso, más clara y azulada)
        Mi = quitar_fondo_liso(rgb, Mi, M, **(paso if isinstance(paso, dict) else {}))
    for q in o.get('quitarLiso') or []:
        Mi = quitar_liso_en_zona(rgb, Mi, R([q['zona']]), q)
    if o.get('incluir'):
        Mi |= R(o['incluir'])
    if o.get('sinFondo'):
        Mi = CH.quitar_fondo(rgb, Mi, **o['sinFondo'])
    if o.get('limite'):
        Mi &= R(o['limite'])
    if o.get('excluir'):
        Mi &= ~R(o['excluir'])
    for q in o.get('quitarSaturados') or []:
        Mi &= ~CH.saturados(rgb, R([q['zona']]), q.get('sat', 45), q.get('lumMin', 50))
    if o.get('recortarClaro'):
        Mi = CH.recortar_claro(rgb, Mi, **o['recortarClaro'])
    radio = int(o.get('cerrar', 0))
    if radio > 0:
        Mi = ndimage.binary_closing(Mi, structure=np.ones((2 * radio + 1, 2 * radio + 1), bool))
        if o.get('excluir'):
            Mi &= ~R(o['excluir'])
    tope = int(o.get('rellenar', 0))
    if tope > 0:
        huecos = ndimage.binary_fill_holes(Mi) & ~Mi
        et, n = ndimage.label(huecos)
        if n:
            areas = ndimage.sum(huecos, et, range(1, n + 1))
            Mi |= np.isin(et, [i + 1 for i, a in enumerate(areas) if a < tope])
    return Mi


def mascara_propia(hoja, o, origen, tam):
    """La inferencia de UN cuadro (su caja), llevada a las coordenadas del panel."""
    x0, y0, x1, y1 = (int(v) for v in o['caja'])
    inf = o.get('inferencia', 'ancho')
    if inf == 'caja':
        m = CH.mascara_caja(hoja, (x0, y0, x1, y1), o)
    else:
        m = CH.mascara_ancha(hoja, (x0, y0, x1, y1), float(o.get('relacion', 2.5)), float(o.get('umbral', 0.5)))
    out = np.zeros((tam[1], tam[0]), bool)
    ox, oy = origen
    ix0, iy0 = max(x0, ox), max(y0, oy)
    ix1, iy1 = min(x1, ox + tam[0]), min(y1, oy + tam[1])
    if ix1 > ix0 and iy1 > iy0:
        out[iy0 - oy:iy1 - oy, ix0 - ox:ix1 - ox] = m[iy0 - y0:iy1 - y0, ix0 - x0:ix1 - x0]
    return out


def cortes_auto(M, n, x0):
    """Rangos [xa, xb] para las costuras entre n figuras: alrededor de cada hueco entre manchas
    (columnas con poca máscara) cerca de donde caería el corte si los cuadros fueran parejos."""
    h, w = M.shape
    perfil = ndimage.uniform_filter1d(M.sum(axis=0).astype(np.float32), 5)
    cortes = []
    desde = 0
    for i in range(1, n):
        esperado = int(w * i / n)
        r = int(w / (2 * n))
        a, b = max(desde + 8, esperado - r), min(w - 8, esperado + r)
        if b <= a:
            a, b = esperado - 4, esperado + 4
        c = a + int(np.argmin(perfil[a:b]))
        cortes.append([x0 + c - 6, x0 + c + 7])
        desde = c
    return cortes


def camino_polilinea(puntos, h, x0, y0):
    """Un corte dibujado a mano: [[x, y], ...] en px de la hoja, de arriba abajo. Entre puntos se
    interpola; arriba del primero y abajo del último sigue vertical."""
    ys = np.array([p[1] for p in puntos], np.float32) - y0
    xs = np.array([p[0] for p in puntos], np.float32) - x0
    orden = np.argsort(ys)
    return np.round(np.interp(np.arange(h), ys[orden], xs[orden])).astype(int)


def partir_por_costuras(M, cortes, x0, y0=0):
    h, w = M.shape
    costuras = []
    for c in cortes:
        if len(c) > 2 or isinstance(c[0], (list, tuple)):
            costuras.append(camino_polilinea(c, h, x0, y0))
        else:
            costuras.append(CH.costura(M, int(c[0]) - x0, int(c[1]) - x0))
    xs = np.arange(w)[None, :]
    partes = []
    for i in range(len(costuras) + 1):
        izq = costuras[i - 1] if i > 0 else np.full(h, -1)
        der = costuras[i] if i < len(costuras) else np.full(h, w + 1)
        partes.append(M & (xs >= izq[:, None]) & (xs < der[:, None]))
    return partes


def apoyo_zona(c, Mi, zona, origen, tam, ancla, escala=1.0):
    """Recalcula el apoyo X con sólo una parte del cuadro (el barbero sin la moto o el bombo)."""
    solo = Mi & CH.rasterizar(zona, origen, tam)
    ys, xs = np.nonzero(solo)
    if not len(xs):
        return
    sub = solo[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    ax = (ES.ancla_x(sub, ancla) + (xs.min() + origen[0] - c['origen'][0])) * float(escala or 1)
    if c.get('espejado'):
        ax = c['img'].width - ax
    c['ax'] = round(float(ax), 1)


def mascara_panel(hoja, panel, umbral, variantes=None):
    """Máscara del panel = UNIÓN de inferencias con recortes apenas distintos ([dx0, dy0, dx1, dy1]
    sobre el panel). Sobre estas hojas isnet es inestable: correr el borde 2 px le hacía perder el
    torso entero de la patada. Lo que la unión suma de fondo lo saca después «fondoLiso»."""
    x0, y0, x1, y1 = panel
    M = np.zeros((y1 - y0, x1 - x0), bool)
    for dx0, dy0, dx1, dy1 in (variantes or [[0, 0, 0, 0]]):
        rx0, ry0 = max(0, x0 + dx0), max(0, y0 + dy0)
        rx1, ry1 = min(hoja.width, x1 + dx1), min(hoja.height, y1 + dy1)
        Mv = CH.mascara_region(hoja, [rx0, ry0, rx1, ry1], umbral)
        ix0, iy0, ix1, iy1 = max(x0, rx0), max(y0, ry0), min(x1, rx1), min(y1, ry1)
        M[iy0 - y0:iy1 - y0, ix0 - x0:ix1 - x0] |= Mv[iy0 - ry0:iy1 - ry0, ix0 - rx0:ix1 - rx0]
    return M


def condicion_color(arr, regla):
    """Píxeles que cumplen las condiciones de color de una regla (todas a la vez)."""
    r_, g_, b_ = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = arr.max(axis=2)
    sat = (lum - arr.min(axis=2)) / np.maximum(lum, 1)
    cond = np.ones(arr.shape[:2], bool)
    if 'lumMin' in regla:
        cond &= lum >= regla['lumMin']
    if 'lumMax' in regla:
        cond &= lum <= regla['lumMax']
    if 'satMin' in regla:
        cond &= sat >= regla['satMin']
    if 'satMax' in regla:
        cond &= sat <= regla['satMax']
    if 'azulMin' in regla:
        cond &= (b_ - r_) >= regla['azulMin']
    if 'azulMax' in regla:
        cond &= (b_ - r_) <= regla['azulMax']
    if 'rojoMin' in regla:
        cond &= (r_ - b_) >= regla['rojoMin']
    if 'verdeMin' in regla:
        cond &= (g_ - np.maximum(r_, b_)) >= regla['verdeMin']
    if 'bgMin' in regla:
        # rosa/rojo de una chispa (B ≥ G) contra la piel (B bastante menor que G)
        cond &= (b_ - g_) >= regla['bgMin']
    for canal, arr_c in (('r', r_), ('g', g_), ('b', b_)):
        if canal + 'Min' in regla:
            cond &= arr_c >= regla[canal + 'Min']
        if canal + 'Max' in regla:
            cond &= arr_c <= regla[canal + 'Max']
    return cond


def pintar_hoja(hoja, reglas):
    """Copia de la hoja con los píxeles de cada regla pintados del color del fondo ANTES de inferir:
    los arcos de golpe, el humo o el rayo que el modelo confunde con el cuerpo. Una regla es
    {"zona": caja o polígono, "excepto": formas, condiciones de color (lumMin, lumMax, satMin,
    satMax, azulMin, azulMax, rojoMin, verdeMin, bgMin, stdMax, rMin/rMax, gMin/gMax, bMin/bMax,
    protegerRojo, areaMax),
    "crecer": px, "color": [r,g,b]}."""
    a = np.asarray(hoja).astype(np.float32).copy()
    for regla in reglas:
        zona = CH.rasterizar([regla['zona']], (0, 0), hoja.size)
        if regla.get('excepto'):
            zona &= ~CH.rasterizar(regla['excepto'], (0, 0), hoja.size)
        ys, xs = np.nonzero(zona)
        if not len(xs):
            continue
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = a[y0:y1, x0:x1]
        cond = zona[y0:y1, x0:x1] & condicion_color(sub, regla)
        if 'stdMax' in regla:
            # humo y estelas son blandos; las suelas y contornos, líneas finas con mucho borde
            cond &= std_local(sub, 1) <= regla['stdMax']
        if regla.get('protegerRojo'):
            # las zapatillas blancas tienen detalles rojos: lo blanco pegado a lo rojo no es humo
            rojo = ((sub[..., 0] - sub[..., 2]) >= 60) & (sub[..., 0] >= 120)
            cond &= ~ndimage.binary_dilation(rojo, iterations=int(regla['protegerRojo']))
        if 'areaMax' in regla:
            # sólo las manchas chicas (vainas, chispitas): la piel del mismo color es una mancha grande
            et, n = ndimage.label(cond, structure=np.ones((3, 3)))
            if n:
                areas = ndimage.sum(cond, et, range(1, n + 1))
                cond = np.isin(et, [i + 1 for i, a in enumerate(areas) if a <= regla['areaMax']])
        if regla.get('crecer'):
            cond = ndimage.binary_dilation(cond, iterations=int(regla['crecer'])) & zona[y0:y1, x0:x1]
        if regla.get('color'):
            color = np.array(regla['color'], np.float32)
        else:
            S = std_local(sub)
            liso = (S < 3) & ~cond & (sub.max(axis=2) < 60)
            color = np.median(sub[liso], axis=0) if liso.sum() > 20 else np.array([18, 21, 26], np.float32)
        sub[cond] = color
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def cuadros_panel(hoja, anim, nombre):
    if anim.get('pintar'):
        hoja = pintar_hoja(hoja, anim['pintar'])
        if _estado['debug']:
            x0, y0, x1, y1 = (int(v) for v in anim['panel'])
            hoja.crop((x0, y0, x1, y1)).save(os.path.join(_estado['debug'], f'pintado_{nombre}.png'))
    x0, y0, x1, y1 = (int(v) for v in anim['panel'])
    origen, tam = (x0, y0), (x1 - x0, y1 - y0)
    rgb_img = hoja.crop((x0, y0, x1, y1))
    rgb = np.asarray(rgb_img)
    M = mascara_panel(hoja, (x0, y0, x1, y1), float(anim.get('umbral', 0.5)), anim.get('variantes'))
    if _estado['sucio'] is not None:
        M &= ~_estado['sucio'][y0:y1, x0:x1]
    abajo = int(anim.get('recorteAbajo', 0))
    if abajo > 0:
        M[-abajo:, :] = False
    if anim.get('excluirPanel'):
        M &= ~CH.rasterizar(anim['excluirPanel'], origen, tam)
    margen = int(anim.get('margenX', 0))
    if margen > 0:
        # la barra oscura de los bordes del panel (el modelo a veces la pega al cuadro de la punta)
        M[:, :margen] = False
        M[:, -margen:] = False
    if anim.get('cajas'):
        # un cuadro por caja, cada uno con su propia inferencia (paneles donde el modelo se confunde)
        partes = []
        for i, caja in enumerate(anim['cajas']):
            o = {**anim, **(anim.get('porCuadro') or {}).get(str(i), {}), 'caja': caja}
            p = mascara_propia(hoja, o, origen, tam) & CH.rasterizar([caja], origen, tam)
            if _estado['sucio'] is not None:
                p &= ~_estado['sucio'][y0:y1, x0:x1]
            partes.append(p)
    else:
        n = int(anim['cuadros'])
        if anim.get('cortes') == 'auto':
            cortes = cortes_auto(M, n, x0)
            print(f'  {nombre}: cortes {cortes}')
            partes = partir_por_costuras(M, cortes, x0, y0)
        elif anim.get('cortes'):
            partes = partir_por_costuras(M, anim['cortes'], x0, y0)
        else:
            partes = ES.separar_cuadros(M, n)
        if len(partes) != n:
            print(f'  AVISO {nombre}: se esperaban {n} cuadros y se separaron {len(partes)}', file=sys.stderr)
    salida = []
    for i, Mi in enumerate(partes):
        extra = (anim.get('porCuadro') or {}).get(str(i), {})
        o = {**anim, **extra}
        if extra.get('caja') and not anim.get('cajas'):
            Mi = mascara_propia(hoja, o, origen, tam)
            if _estado['sucio'] is not None:
                Mi &= ~_estado['sucio'][y0:y1, x0:x1]
        Mi = editar(Mi, M, o, origen, tam, rgb)
        Mi = ES.limpiar(Mi, o.get('componentes', 'principal'))
        if _estado['debug']:
            CH.guardar_mascara_debug(rgb_img, Mi, origen, os.path.join(_estado['debug'], f'mascara_{nombre}_{i}.png'))
        c = ES.cuadro_desde_mascara(rgb_img, Mi, o, origen)
        if c is None:
            print(f'  {nombre}[{i}]: vacío, se omite', file=sys.stderr)
            continue
        c['espejado'] = bool(o.get('espejo'))
        if o.get('anclaZona'):
            apoyo_zona(c, Mi, o['anclaZona'], origen, tam, o.get('ancla', 'torso'), o.get('escala', 1))
        if o.get('apoyoX') is not None:
            # apoyo X a mano, en px de la hoja (un cuadro donde el torso no sirve de referencia)
            c['ax'] = round((float(o['apoyoX']) - c['origen'][0]) * float(o.get('escala', 1) or 1), 1)
            if c['espejado']:
                c['ax'] = round(c['img'].width - c['ax'], 1)
        salida.append(c)
    return salida


def extraer_animacion(hoja, anim, nombre):
    if 'panel' in anim:
        lista = cuadros_panel(hoja, anim, nombre)
    else:
        # modo «cajas» o «mascara + cortes» del extractor de Chipi, tal cual
        CH._debug['carpeta'], CH._debug['nombre'] = _estado['debug'], nombre
        lista = CH.extraer_animacion(hoja, anim, _estado['debug'], nombre)
    usar = anim.get('usar')
    if usar:
        lista = [lista[i] for i in usar if i < len(lista)]
    return lista


# ─── efectos ─────────────────────────────────────────────────────────────────

def efecto_objeto(hoja, ef, nombre):
    x0, y0, x1, y1 = (int(v) for v in ef['caja'])
    origen, tam = (x0, y0), (x1 - x0, y1 - y0)
    rgb_img = hoja.crop((x0, y0, x1, y1))
    rgb = np.asarray(rgb_img)
    M = mascara_propia(hoja, {**ef, 'inferencia': ef.get('inferencia', 'caja')}, origen, tam)
    if _estado['sucio'] is not None:
        M &= ~_estado['sucio'][y0:y1, x0:x1]
    M = editar(M, M, ef, origen, tam, rgb)
    M = ES.limpiar(M, ef.get('componentes', 'principal'))
    if _estado['debug']:
        CH.guardar_mascara_debug(rgb_img, M, origen, os.path.join(_estado['debug'], f'mascara_efecto_{nombre}.png'))
    c = ES.cuadro_desde_mascara(rgb_img, M, {'ancla': 'caja', 'espejo': ef.get('espejo', False)}, origen)
    if c is None:
        return None
    if ef.get('rotar'):
        c['img'] = c['img'].rotate(float(ef['rotar']), resample=Image.NEAREST, expand=True)
    c['ax'] = c['img'].width / 2.0
    c['ay'] = c['img'].height / 2.0
    return c


def extraer_efecto(hoja, hoja_orig, ef, nombre):
    modo = ef.get('modo', 'objeto')
    if modo == 'luz':
        return ES.efecto_luz(hoja_orig if ef.get('original') else hoja, ef['caja'])
    if modo == 'nube':
        return CH.efecto_nube(hoja_orig, ef)
    return efecto_objeto(hoja, ef, nombre)


# ─── atlas ───────────────────────────────────────────────────────────────────

def _limpiar_rgb(img):
    """RGB en 0 donde el alfa es 0: el atlas comprime mucho mejor y nada cambia al dibujarlo."""
    a = np.asarray(img.convert('RGBA')).copy()
    a[a[..., 3] == 0, :3] = 0
    return Image.fromarray(a)


def armar_atlas(cfg, salida, carpeta_cuadros, previos):
    todos, indice = [], {}
    for nombre, r in previos.items():
        indice[nombre] = []
        for e in r['cuadros']:
            img = _limpiar_rgb(Image.open(os.path.join(carpeta_cuadros, e['archivo'])))
            indice[nombre].append(len(todos))
            todos.append({'img': img, 'ax': e['ax'], 'ay': e['ay']})
    ancho, alto, pos = ES.empaquetar(todos)
    atlas = Image.new('RGBA', (max(1, ancho), max(1, alto)), (0, 0, 0, 0))
    for c, (x, y) in zip(todos, pos):
        atlas.alpha_composite(c['img'], (x, y))

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
    for nombre, anim in cfg['animaciones'].items():
        al = anim.get('alias')
        if not al:
            continue
        fuente = anims.get(al['de'])
        if not fuente:
            print(f'AVISO: el alias {nombre} apunta a {al["de"]}, que no está', file=sys.stderr)
            continue
        usar = al.get('usar') or list(range(len(fuente['cuadros'])))
        anims[nombre] = {'cuadros': [dict(fuente['cuadros'][k]) for k in usar], 'impactos': list(al.get('impactos', []))}
    for nombre, anim in cfg['animaciones'].items():
        # "sumar": [["danio", 4], ...] agrega al final cuadros de OTRA animación (mismos rectángulos)
        for de, k in anim.get('sumar') or []:
            if nombre in anims and de in anims and k < len(anims[de]['cuadros']):
                anims[nombre]['cuadros'].append(dict(anims[de]['cuadros'][k]))
    anims = {k: anims[k] for k in CLAVES if k in anims}
    faltan = [k for k in CLAVES if k not in anims]
    if faltan:
        print('AVISO: faltan animaciones:', ', '.join(faltan), file=sys.stderr)

    # PNG optimizado y WebP sin pérdida: queda el más liviano (el render carga lo que diga el JSON)
    ruta_png = os.path.join(salida, 'atlas.png')
    ruta_webp = os.path.join(salida, 'atlas.webp')
    atlas.save(ruta_png, optimize=True)
    atlas.save(ruta_webp, 'WEBP', lossless=True, quality=100, method=6, exact=False)
    p, w = os.path.getsize(ruta_png), os.path.getsize(ruta_webp)
    if w < 0.9 * p:
        imagen = 'atlas.webp'
        os.remove(ruta_png)
    else:
        imagen = 'atlas.png'
        os.remove(ruta_webp)
    ref = anims['quieto']['cuadros'][0]['h'] if 'quieto' in anims else None
    datos = {
        'version': 1,
        'personaje': cfg['personaje'],
        'imagen': imagen,
        'alturaReferencia': ref,
        'animaciones': anims,
        'efectos': efs,
    }
    with open(os.path.join(salida, 'atlas.json'), 'w') as f:
        json.dump(datos, f, separators=(',', ':'))
    print(f'atlas {ancho}x{alto}, {len(todos)} cuadros, {imagen} ({min(p, w) / 1024:.0f} KB; png {p / 1024:.0f} KB, webp {w / 1024:.0f} KB)')
    return datos, atlas


# ─── revisión ────────────────────────────────────────────────────────────────

def lamina(datos, atlas, ruta, columnas=2):
    """Todo el personaje a escala: cada animación en un renglón, los cuadros parados sobre el mismo
    piso (verde), la altura de referencia en celeste y el apoyo X de cada cuadro en rojo."""
    ref = datos['alturaReferencia'] or 120
    anims = [(k, datos['animaciones'][k]) for k in CLAVES if k in datos['animaciones']]
    filas = []
    for k, a in anims:
        cs = a['cuadros']
        alto = int(max(max(c['ay'] for c in cs), max(c['h'] for c in cs), ref) + 24)
        ancho = 96 + sum(int(max(c['ax'], c['w'] - c['ax']) * 2 + 10) for c in cs)
        filas.append((k, a, alto, ancho))
    por_col = (len(filas) + columnas - 1) // columnas
    cols = [filas[i * por_col:(i + 1) * por_col] for i in range(columnas)]
    anchos = [max(f[3] for f in col) for col in cols if col]
    altos = [sum(f[2] for f in col) for col in cols if col]
    L = Image.new('RGBA', (sum(anchos) + 20 * columnas, max(altos)), (58, 60, 66, 255))
    d = ImageDraw.Draw(L)
    x_col = 0
    for col, ancho_col in zip(cols, anchos):
        y = 0
        for k, a, alto, _ in col:
            piso = y + alto - 12
            d.line([(x_col, piso), (x_col + ancho_col, piso)], fill=(0, 220, 0, 255))
            d.line([(x_col + 92, piso - ref), (x_col + ancho_col, piso - ref)], fill=(0, 190, 255, 255))
            d.text((x_col + 4, y + 4), k, fill=(255, 255, 0, 255))
            if a.get('impactos'):
                d.text((x_col + 4, y + 18), 'imp ' + ','.join(map(str, a['impactos'])), fill=(255, 140, 140, 255))
            x = x_col + 96
            for i, c in enumerate(a['cuadros']):
                mitad = int(max(c['ax'], c['w'] - c['ax']) + 5)
                cx = x + mitad
                spr = atlas.crop((c['x'], c['y'], c['x'] + c['w'], c['y'] + c['h']))
                L.alpha_composite(spr, (int(round(cx - c['ax'])), int(round(piso - c['ay']))))
                col_ap = (255, 60, 60, 255) if i not in a.get('impactos', []) else (255, 230, 0, 255)
                d.line([(cx, piso - 4), (cx, piso + 6)], fill=col_ap, width=2)
                d.text((cx - 3, piso + 1), str(i), fill=(220, 220, 220, 255))
                x += mitad * 2
            y += alto
        x_col += ancho_col + 20
    L.convert('RGB').save(ruta)


# ─── retrato y cara ──────────────────────────────────────────────────────────

def _alfa_suave(hoja, caja, relacion=2.5):
    """Alfa 0..1 de isnet para UN cuadro, rellenado a lo ancho como CH.mascara_ancha."""
    x0, y0, x1, y1 = caja
    rec = hoja.crop((x0, y0, x1, y1))
    a = np.asarray(rec)
    borde = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    color = tuple(int(v) for v in np.median(borde, axis=0))
    w = max(int(rec.height * relacion), rec.width)
    lienzo = Image.new('RGB', (w, rec.height), color)
    off = (w - rec.width) // 2
    lienzo.paste(rec, (off, 0))
    m = ES.mascara_isnet(lienzo)
    return m[:, off:off + rec.width]


def _escalar_limpio(rgb, alfa, tam, nitidez):
    """Agranda RGB y alfa sin halo: el color se extiende hacia afuera desde el borde (el fondo nunca
    se mezcla), LANCZOS, un poco de nitidez, y el borde del alfa se afina después de agrandar."""
    _, (iy, ix) = ndimage.distance_transform_edt(alfa < 0.5, return_indices=True)
    ext = rgb[iy, ix]
    img = Image.fromarray(ext.astype(np.uint8)).resize(tam, Image.LANCZOS)
    if nitidez:
        img = img.filter(ImageFilter.UnsharpMask(radius=2.2, percent=int(nitidez), threshold=2))
    a = Image.fromarray((alfa * 255).astype(np.uint8)).resize(tam, Image.LANCZOS)
    a = np.asarray(a).astype(np.float32) / 255.0
    # borde nítido pero suave (≈ 2 px de transición): smoothstep alrededor de 0,5
    t = np.clip((a - 0.32) / 0.36, 0, 1)
    a = t * t * (3 - 2 * t)
    # 4 canales uint8 → RGBA (el parámetro «mode» de fromarray se va en Pillow 13)
    return Image.fromarray(np.ascontiguousarray(np.dstack([np.asarray(img), (a * 255).astype(np.uint8)])))


def hacer_retrato(hoja, cfg, salida, carpeta_rev):
    r = cfg['retrato']
    x0, y0, x1, y1 = (int(v) for v in r['caja'])
    origen, tam = (x0, y0), (x1 - x0, y1 - y0)
    rgb = np.asarray(hoja.crop((x0, y0, x1, y1)))
    alfa = _alfa_suave(hoja, (x0, y0, x1, y1), float(r.get('relacion', 2.5)))
    if _estado['sucio'] is not None:
        alfa = alfa * ~_estado['sucio'][y0:y1, x0:x1]
    b = editar(alfa >= 0.5, alfa >= 0.5, r, origen, tam, rgb)
    b = ES.limpiar(b, 'principal')
    zona = ndimage.binary_dilation(b, iterations=1)
    alfa = np.where(zona, np.maximum(alfa, b * 0.999), 0).astype(np.float32)
    ys, xs = np.nonzero(alfa > 0.02)
    cy0, cy1, cx0, cx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb_c, alfa_c = rgb[cy0:cy1, cx0:cx1], alfa[cy0:cy1, cx0:cx1]
    if r.get('espejo', True):
        rgb_c, alfa_c = rgb_c[:, ::-1], alfa_c[:, ::-1]
    alto = int(r.get('alto', 720))
    ancho = round(rgb_c.shape[1] * alto / rgb_c.shape[0])
    cuerpo = _escalar_limpio(rgb_c, alfa_c, (ancho, alto), r.get('nitidez', 90))
    cuerpo.save(os.path.join(salida, 'retrato.webp'), 'WEBP', quality=90, method=6)
    if r.get('cara'):
        # la cara sale del MISMO recorte (en px de la hoja), cuadrada, y con la misma orientación
        fx0, fy0, fx1, fy1 = (int(v) for v in r['cara'])
        lado = max(fx1 - fx0, fy1 - fy0)
        ox, oy = fx0 - x0, fy0 - y0
        rc = np.zeros((lado, lado, 3), np.uint8)
        ac = np.zeros((lado, lado), np.float32)
        sx0, sy0 = max(0, ox), max(0, oy)
        sx1, sy1 = min(tam[0], ox + lado), min(tam[1], oy + lado)
        rc[sy0 - oy:sy1 - oy, sx0 - ox:sx1 - ox] = rgb[sy0:sy1, sx0:sx1]
        ac[sy0 - oy:sy1 - oy, sx0 - ox:sx1 - ox] = alfa[sy0:sy1, sx0:sx1]
        if r.get('espejo', True):
            rc, ac = rc[:, ::-1], ac[:, ::-1]
        cara = _escalar_limpio(rc, ac, (256, 256), r.get('nitidezCara', r.get('nitidez', 90)))
        cara.save(os.path.join(salida, 'cara.webp'), 'WEBP', quality=90, method=6)
    if carpeta_rev:
        fondo = Image.new('RGBA', (cuerpo.width + 300, max(cuerpo.height, 256)), (70, 72, 78, 255))
        fondo.alpha_composite(cuerpo, (0, 0))
        if r.get('cara'):
            fondo.alpha_composite(Image.open(os.path.join(salida, 'cara.webp')).convert('RGBA'), (cuerpo.width + 22, 0))
        fondo.convert('RGB').save(os.path.join(carpeta_rev, 'retrato_y_cara.png'))
    print('retrato listo')


# ─── main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--solo', default='')
    ap.add_argument('--revision', default='')
    ap.add_argument('--mascaras', action='store_true', help='guarda la máscara de cada cuadro sobre la hoja')
    ap.add_argument('--sin-atlas', action='store_true')
    ap.add_argument('--retrato', action='store_true')
    args = ap.parse_args()

    config = os.path.abspath(args.config)
    base = os.path.dirname(config)
    with open(config) as f:
        cfg = json.load(f)
    hoja_orig = Image.open(ES.ruta(base, cfg['hoja'])).convert('RGB')
    hoja = CH.aplicar_limpiezas(hoja_orig, cfg.get('limpiezas'))
    _estado['sucio'] = CH.mascara_limpiezas(hoja.size, cfg.get('limpiezas'))
    CH._limpiezas['mascara'] = _estado['sucio']
    salida = ES.ruta(base, cfg['salida'])
    os.makedirs(salida, exist_ok=True)
    if args.revision:
        os.makedirs(args.revision, exist_ok=True)
        hoja.save(os.path.join(args.revision, 'hoja_limpia.png'))
        if args.mascaras:
            _estado['debug'] = args.revision

    # --solo a,b rehace sólo esas animaciones/efectos («retrato» = sólo el retrato); el resto, del caché
    solo = [s for s in args.solo.split(',') if s]
    carpeta_cache = os.path.join(base, '.cache', cfg['personaje'])
    carpeta_cuadros = os.path.join(carpeta_cache, 'cuadros')
    os.makedirs(carpeta_cuadros, exist_ok=True)
    cache = os.path.join(carpeta_cache, 'cuadros.json')
    previos = {}
    if solo and os.path.exists(cache):
        with open(cache) as f:
            previos = json.load(f)

    resultado = {}
    hacer_todo = not solo
    for nombre, anim in cfg['animaciones'].items():
        if anim.get('alias'):
            continue
        if not hacer_todo and nombre not in solo:
            continue
        anim = {**(cfg.get('porDefecto') or {}), **anim}
        lista = extraer_animacion(hoja, anim, nombre)
        resultado[nombre] = {'cuadros': lista, 'impactos': anim.get('impactos', [])}
        print(f'{nombre}: {len(lista)} cuadros')
    efectos = {}
    for nombre, ef in (cfg.get('efectos') or {}).items():
        if not hacer_todo and nombre not in solo:
            continue
        c = extraer_efecto(hoja, hoja_orig, ef, nombre)
        if c:
            efectos[nombre] = [c]
        print(f'efecto {nombre}: {"listo" if c else "VACÍO"}')

    ref = None
    if 'quieto' in resultado and resultado['quieto']['cuadros']:
        ref = int(resultado['quieto']['cuadros'][0]['img'].height)
    elif 'quieto' in previos:
        ref = int(Image.open(os.path.join(carpeta_cuadros, previos['quieto']['cuadros'][0]['archivo'])).height)
    if args.revision:
        for nombre, r in resultado.items():
            ES.tira_revision(nombre, r['cuadros'], args.revision, ref or 0)
        for nombre, lista in efectos.items():
            lista[0]['img'].save(os.path.join(args.revision, f'efecto_{nombre}.png'))

    pares = list(resultado.items()) + [('efecto:' + k, {'cuadros': v, 'impactos': []}) for k, v in efectos.items()]
    if hacer_todo:
        for archivo in os.listdir(carpeta_cuadros):
            if archivo.endswith('.png'):
                os.remove(os.path.join(carpeta_cuadros, archivo))
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
    validos = {k for k, a in cfg['animaciones'].items() if not a.get('alias')} | {'efecto:' + k for k in (cfg.get('efectos') or {})}
    previos = {k: v for k, v in previos.items() if k in validos}
    # los impactos salen siempre del JSON (se pueden corregir sin volver a recortar)
    for k, a in cfg['animaciones'].items():
        if k in previos:
            previos[k]['impactos'] = a.get('impactos', [])
    with open(cache, 'w') as f:
        json.dump(previos, f)

    if (args.retrato or 'retrato' in solo) and cfg.get('retrato'):
        hacer_retrato(hoja, cfg, salida, args.revision or None)
    if args.sin_atlas:
        return
    datos, atlas = armar_atlas(cfg, salida, carpeta_cuadros, previos)
    if args.revision:
        lamina(datos, atlas, os.path.join(args.revision, 'lamina.png'))
        for nombre, a in cfg['animaciones'].items():
            if a.get('alias') and nombre in datos['animaciones']:
                lista = []
                for c in datos['animaciones'][nombre]['cuadros']:
                    lista.append({'img': atlas.crop((c['x'], c['y'], c['x'] + c['w'], c['y'] + c['h'])), 'ax': c['ax'], 'ay': c['ay']})
                ES.tira_revision(nombre, lista, args.revision, datos['alturaReferencia'] or 0)


if __name__ == '__main__':
    os.environ.setdefault('OMP_NUM_THREADS', '3')
    main()

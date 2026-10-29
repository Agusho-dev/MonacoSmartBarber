#!/usr/bin/env python3
"""
Extractor de Chipi para «Corte Final». Envuelve scripts/juego/extraer_sprites.py (compartido: NO se
edita, se importa) y le suma lo que pide la hoja de Chipi, que viene cargada de efectos pintados
(arcos de golpe, destellos, polvo, la explosión del sillón, la nube del spray) y de cuadros que se
tocan entre sí. El extractor compartido ignora estas claves: correrlo solo sobre chipi.json da un
atlas peor y pisa el bueno.

Claves extra del JSON (coordenadas siempre en px de la hoja):
  raíz
    limpiezas      [{"nota", "poligono": [[x,y],...], "color"?: [r,g,b]}] se pintan con el fondo
                   sobre una COPIA de la hoja antes de inferir (arcos, chorros, destellos que no
                   tapan al personaje) y además se restan de la máscara.
  por animación
    mascara+cortes UNA inferencia sobre la región "mascara" y los cuadros salen de partirla por
                   costuras (camino de arriba abajo que cruza la menor cantidad de máscara) dentro
                   de cada rango [xa, xb] de "cortes". Sirve cuando los cuadros se tocan.
    inferencia     "region" (la de arriba) | "ancho" (cada cuadro rellenado a lo ANCHO, 2.5:1, con el
                   color del borde: así el modelo respeta el hueco entre las piernas y no se traga
                   los arcos) | "caja" (la del extractor, rellenada a cuadrado). Por cuadro:
                   fuentePorCuadro {"i": "ancho" | "union_ancho" | "caja" | "union"}.
    unirCaja       {"i": [x0,y0,x1,y1]} suma la inferencia por caja de ese cuadro.
    incluir        {"i": [formas]} agrega píxeles (formas = cajas [x0,y0,x1,y1] o polígonos).
    agregar        {"i": [formas]} agrega la máscara de la región aunque caiga del otro lado de la
                   costura (un pie compartido).
    limite         {"i": [formas]} sólo se conserva lo que cae dentro.
    excluir        {"i": [formas]} se saca.
    quitarSaturados {"i": [{"zona": polígono, "sat": 45, "lumMin": 50}]} saca lo de color (polvo,
                   fuego, brillos) dentro de la zona; el barbero es negro, gris o piel.
    recortarClaro  {"pasos", "lumMin", "lumMax", "sat"} pela del borde los grises claros (polvo).
    sinFondo       {"oscuro", "cierre", "margen"} saca lo que se alcanza desde el fondo sin cruzar
                   el contorno oscuro del dibujo (por cuadro: sinFondoPorCuadro).
    anclaZona      {"i": [formas]} el apoyo X sale sólo de esa parte (Chipi sin el sillón).
    espejoPorCuadro {"i": true} espeja un cuadro suelto (el KO tirado con la cabeza al revés).
    usar           (del compartido) admite repetir índices: caer = [0,0,0,4,5].
  efectos
    modo "objeto"  como un cuadro (acepta inferencia, limite, excluir, quitarSaturados,
                   recortarClaro); el pivote queda al centro.
    modo "luz"     el del compartido; "original": true lo toma de la hoja sin limpiezas.
    modo "nube"    alfa por brillo contra un fondo FIJO ("fondo": [r,g,b]); "quitar" = polígonos que
                   se rellenan clonando la nube corrida "clonar": [dx, ...] px (lo que no alcanza,
                   por inpaint), con costura suave ("costura": sigma, "dilatarHueco": px) y borde
                   elíptico ("forma": "elipse", "suave": px).

Uso (desde MonacoSmartBarber/, ~25 s con el modelo ya bajado):
  OMP_NUM_THREADS=3 python3 <este>.py scripts/juego/personajes/chipi.json \
      --revision <carpeta> [--solo a,b] [--retrato] [--sin-atlas]
Sin --solo rehace todo el caché (scripts/juego/personajes/.cache/chipi, no se versiona). El atlas lo
arma el main() del extractor compartido con lo cacheado, así atlas.json tiene exactamente su
formato. Con --revision deja las tiras revision_*.png, la máscara de cada cuadro sobre la hoja
(mascara_<anim>_<i>.png, con grilla en coordenadas de la hoja), las costuras y la hoja limpia.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

# El extractor compartido: al lado de este archivo si se lo copia a scripts/juego/, o en el repo.
_AQUI = os.path.dirname(os.path.abspath(__file__))
_REPO = '/Users/ignaciobaldovino/MSB_FULL/MonacoSmartBarber'
for _d in (_AQUI, os.path.join(_REPO, 'scripts', 'juego')):
    if os.path.exists(os.path.join(_d, 'extraer_sprites.py')):
        sys.path.insert(0, _d)
        break
import extraer_sprites as ES  # noqa: E402

_mascaras = {}
_debug = {}
_limpiezas = {}


def rasterizar(formas, origen, tam):
    """Formas (cajas [x0,y0,x1,y1] o polígonos [[x,y],...]) en coords de hoja → máscara bool local."""
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


def aplicar_limpiezas(hoja, limpiezas):
    if not limpiezas:
        return hoja
    a = np.asarray(hoja).copy()
    for lim in limpiezas:
        pol = lim['poligono'] if isinstance(lim, dict) else lim
        m = rasterizar([pol], (0, 0), hoja.size)
        if isinstance(lim, dict) and lim.get('modo') == 'inpaint':
            # se reconstruye con lo que lo rodea (un destello pintado ENCIMA del cuerpo)
            import cv2
            a = cv2.inpaint(a, m.astype(np.uint8) * 255, int(lim.get('radio', 4)), cv2.INPAINT_TELEA)
            continue
        if isinstance(lim, dict) and lim.get('color'):
            color = np.array(lim['color'], np.uint8)
        else:
            anillo = ndimage.binary_dilation(m, iterations=4) & ~m
            px = a[anillo]
            oscuros = px[px.max(axis=1) < 70]
            color = np.median(oscuros if len(oscuros) else px, axis=0).astype(np.uint8)
        a[m] = color
    return Image.fromarray(a)


def mascara_region(hoja, region, umbral):
    clave = (id(hoja), tuple(region), float(umbral))
    if clave not in _mascaras:
        x0, y0, x1, y1 = region
        alfa = ES.mascara_isnet(hoja.crop((x0, y0, x1, y1)))
        b = alfa >= umbral
        b = ndimage.binary_opening(b, structure=np.ones((2, 2)))
        _mascaras[clave] = b
    return _mascaras[clave]


def mascara_ancha(hoja, caja, relacion=2.5, umbral=0.5):
    """Inferencia de UN cuadro rellenado a lo ANCHO (relación ancho:alto) con el color del borde.
    Así el modelo lo ve como en el modo panel: respeta el hueco entre las piernas y no se traga
    los arcos; rellenado a cuadrado, en cambio, devuelve una mancha (probado el 29/oct/2026)."""
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
    return m[:, off:off + rec.width] >= umbral


def mascara_limpiezas(tam, limpiezas):
    formas = [lim['poligono'] if isinstance(lim, dict) else lim for lim in (limpiezas or [])
              if not (isinstance(lim, dict) and lim.get('modo') == 'inpaint')]
    if not formas:
        return np.zeros((tam[1], tam[0]), bool)
    return rasterizar(formas, (0, 0), tam)


def mascara_caja(hoja, caja, opts):
    """La inferencia por cuadro del extractor (relleno a cuadrado), recortada a la caja exacta."""
    pad = int(opts.get('pad', 6))
    x0, y0, x1, y1 = caja
    x0p, y0p = max(0, x0 - pad), max(0, y0 - pad)
    x1p, y1p = min(hoja.width, x1 + pad), min(hoja.height, y1 + pad)
    alfa = ES.mascara_isnet(hoja.crop((x0p, y0p, x1p, y1p)), cuadrar=True)
    b = alfa >= float(opts.get('umbral', 0.5))
    return b[y0 - y0p:y1 - y0p, x0 - x0p:x1 - x0p]


def quitar_fondo(rgb, binaria, oscuro=14, cierre=1, margen=2, semillaMax=None):
    """Saca de la máscara lo que se alcanza desde el fondo (lo que toca el borde de la caja fuera de la
    máscara) caminando por píxeles que NO son contorno oscuro. El contorno del dibujo frena la
    inundación; el polvo, el humo y el fondo pegado entre las piernas no tienen contorno."""
    lum = rgb.astype(np.int16).max(axis=2)
    osc = lum < oscuro
    barrera = ndimage.binary_dilation(osc, iterations=cierre) if cierre > 0 else osc
    transitable = ~barrera
    # semillas: el fondo de verdad = componentes de ~máscara que tocan el borde de la caja
    afuera_m, n = ndimage.label(~binaria, structure=np.ones((3, 3)))
    borde = np.zeros_like(binaria)
    borde[0, :] = borde[-1, :] = True
    borde[:, 0] = borde[:, -1] = True
    ids = np.unique(afuera_m[borde & ~binaria])
    ids = ids[ids > 0]
    semillas = np.isin(afuera_m, ids) & transitable
    if semillaMax is not None:
        semillas &= lum <= semillaMax
    et, _ = ndimage.label(transitable)
    ids = np.unique(et[semillas])
    ids = ids[ids > 0]
    fuera = np.isin(et, ids)
    # recupera el anillo que tapó la dilatación de la barrera, sin cruzar píxeles oscuros
    for _ in range(max(0, cierre + margen)):
        fuera = fuera | (ndimage.binary_dilation(fuera) & ~osc)
    return binaria & ~fuera


def cuadro_de_caja(hoja, anim, i, caja):
    x0, y0, x1, y1 = (int(v) for v in caja)
    rec = hoja.crop((x0, y0, x1, y1))
    defecto = anim.get('inferencia') or ('region' if anim.get('mascara') else 'caja')
    fuente = (anim.get('fuentePorCuadro') or {}).get(str(i), defecto)
    partes = []
    if fuente == 'ancho':
        partes.append(mascara_ancha(hoja, (x0, y0, x1, y1), float(anim.get('relacion', 2.5)),
                                    float(anim.get('umbral', 0.5))))
    if fuente in ('region', 'union'):
        rx0, ry0, rx1, ry1 = anim['mascara']
        mr = mascara_region(hoja, anim['mascara'], float(anim.get('umbral', 0.5)))
        sub = np.zeros((y1 - y0, x1 - x0), bool)
        ix0, iy0, ix1, iy1 = max(x0, rx0), max(y0, ry0), min(x1, rx1), min(y1, ry1)
        if ix1 > ix0 and iy1 > iy0:
            sub[iy0 - y0:iy1 - y0, ix0 - x0:ix1 - x0] = mr[iy0 - ry0:iy1 - ry0, ix0 - rx0:ix1 - rx0]
        partes.append(sub)
    if fuente in ('caja', 'union'):
        partes.append(mascara_caja(hoja, (x0, y0, x1, y1), anim))
    binaria = partes[0]
    for p in partes[1:]:
        binaria = binaria | p
    sucio = _limpiezas.get('mascara')
    if sucio is not None:
        binaria = binaria & ~sucio[y0:y1, x0:x1]
    inc = (anim.get('incluir') or {}).get(str(i))
    if inc:
        binaria = binaria | rasterizar(inc, (x0, y0), rec.size)
    sf = anim.get('sinFondo')
    sfc = (anim.get('sinFondoPorCuadro') or {}).get(str(i), None)
    if sfc is False:
        sf = None
    elif isinstance(sfc, dict):
        sf = {**(sf or {}), **sfc}
    if sf:
        binaria = quitar_fondo(np.asarray(rec), binaria, **sf)
    exc = (anim.get('excluir') or {}).get(str(i))
    if exc:
        binaria = binaria & ~rasterizar(exc, (x0, y0), rec.size)
    lim = (anim.get('limite') or {}).get(str(i))
    if lim:
        binaria = binaria & rasterizar(lim, (x0, y0), rec.size)
    for q in (anim.get('quitarSaturados') or {}).get(str(i)) or []:
        binaria = binaria & ~saturados(np.asarray(rec), rasterizar([q['zona']], (x0, y0), rec.size),
                                       q.get('sat', 45), q.get('lumMin', 50))
    claro = anim.get('recortarClaro')
    if claro:
        binaria = recortar_claro(np.asarray(rec), binaria, **(claro if isinstance(claro, dict) else {}))
    abajo = int(anim.get('recorteAbajo', 0))
    if abajo > 0:
        binaria[-abajo:, :] = False
    binaria = ES.limpiar(binaria, anim.get('componentes', 'principal'))
    if _debug.get('carpeta'):
        guardar_mascara_debug(rec, binaria, (x0, y0), os.path.join(_debug['carpeta'], f"mascara_{_debug['nombre']}_{i}.png"))
    c = ES.cuadro_desde_mascara(rec, binaria, anim, (x0, y0))
    zona = (anim.get('anclaZona') or {}).get(str(i))
    if c is not None and zona:
        # el apoyo X sale sólo del barbero (sin el sillón que tiene en las manos): si no, el
        # torso «salta» hacia el objeto entre cuadros del mismo movimiento
        solo = binaria & rasterizar(zona, (x0, y0), rec.size)
        ys, xs = np.nonzero(solo)
        if len(xs):
            sub = solo[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
            ax = ES.ancla_x(sub, anim.get('ancla', 'torso')) + (xs.min() + x0 - c['origen'][0])
            c['ax'] = round(float(ax), 1)
    return c


def costura(M, xa, xb):
    """Camino de arriba abajo (x por fila, ±1 px por fila) entre xa y xb que cruza la menor
    cantidad de máscara: separa dos cuadros que se tocan por donde menos se tocan."""
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


def opcion_cuadro(anim, clave, i):
    v = anim.get(clave) or {}
    return v.get(str(i)) if isinstance(v, dict) else None


def cuadros_por_cortes(hoja, anim, carpeta_debug=None, nombre=''):
    """Una inferencia sobre la región; los cuadros salen de partirla por costuras."""
    rx0, ry0, rx1, ry1 = anim['mascara']
    M = mascara_region(hoja, anim['mascara'], float(anim.get('umbral', 0.5)))
    h, w = M.shape
    rgb = hoja.crop((rx0, ry0, rx1, ry1))
    costuras = [costura(M, int(xa) - rx0, int(xb) - rx0) for xa, xb in anim['cortes']]
    xs = np.arange(w)[None, :]
    salida = []
    modo = anim.get('inferencia', 'region')
    sucio = _limpiezas['mascara'][ry0:ry1, rx0:rx1] if _limpiezas.get('mascara') is not None else None
    for i in range(len(costuras) + 1):
        izq = costuras[i - 1] if i > 0 else np.full(h, -1)
        der = costuras[i] if i < len(costuras) else np.full(h, w + 1)
        lado = (xs >= izq[:, None]) & (xs < der[:, None])
        fuente = opcion_cuadro(anim, 'fuentePorCuadro', i) or modo
        if fuente in ('ancho', 'union_ancho'):
            cols = np.nonzero(lado.any(axis=0))[0]
            sx0, sx1 = max(0, int(cols.min()) - 2), min(w, int(cols.max()) + 3)
            ma = mascara_ancha(hoja, (rx0 + sx0, ry0, rx0 + sx1, ry1), float(anim.get('relacion', 2.5)),
                               float(anim.get('umbral', 0.5)))
            tmp = np.zeros_like(M)
            tmp[:, sx0:sx1] = ma
            Mi = tmp & lado
            if fuente == 'union_ancho':
                Mi = Mi | (M & lado)
        else:
            Mi = M & lado
        if sucio is not None:
            Mi = Mi & ~sucio
        caja = opcion_cuadro(anim, 'unirCaja', i)
        if caja:
            x0, y0, x1, y1 = caja
            mc = mascara_caja(hoja, caja, anim)
            tmp = np.zeros_like(M)
            tmp[y0 - ry0:y1 - ry0, x0 - rx0:x1 - rx0] = mc
            Mi = Mi | (tmp & lado)
        inc = opcion_cuadro(anim, 'incluir', i)
        if inc:
            Mi = Mi | (rasterizar(inc, (rx0, ry0), (w, h)) & lado)
        agr = opcion_cuadro(anim, 'agregar', i)
        if agr:
            # píxeles de la máscara de la región dentro del polígono, aunque caigan del otro lado de
            # la costura (un pie que dos cuadros vecinos comparten en la hoja)
            Mi = Mi | (M & rasterizar(agr, (rx0, ry0), (w, h)))
        lim = opcion_cuadro(anim, 'limite', i)
        if lim:
            Mi = Mi & rasterizar(lim, (rx0, ry0), (w, h))
        exc = opcion_cuadro(anim, 'excluir', i)
        if exc:
            Mi = Mi & ~rasterizar(exc, (rx0, ry0), (w, h))
        for q in opcion_cuadro(anim, 'quitarSaturados', i) or []:
            Mi = Mi & ~saturados(np.asarray(rgb), rasterizar([q['zona']], (rx0, ry0), (w, h)),
                                 q.get('sat', 45), q.get('lumMin', 50))
        claro = anim.get('recortarClaro')
        if claro:
            Mi = recortar_claro(np.asarray(rgb), Mi, **(claro if isinstance(claro, dict) else {}))
        Mi = ES.limpiar(Mi, anim.get('componentes', 'principal'))
        opts_i = anim
        if opcion_cuadro(anim, 'espejoPorCuadro', i) is not None:
            # un cuadro suelto dibujado al revés (p. ej. el KO tirado con la cabeza del otro lado)
            opts_i = {**anim, 'espejo': bool(opcion_cuadro(anim, 'espejoPorCuadro', i))}
        c = ES.cuadro_desde_mascara(rgb, Mi, opts_i, (rx0, ry0))
        if c is not None:
            salida.append(c)
            if carpeta_debug:
                guardar_mascara_debug(rgb, Mi, (rx0, ry0), os.path.join(carpeta_debug, f'mascara_{nombre}_{i}.png'))
    if carpeta_debug:
        v = np.asarray(rgb).copy()
        v[~M] = (v[~M] * 0.3 + np.array([0, 140, 0]) * 0.7).astype(np.uint8)
        for cam in costuras:
            v[np.arange(h), np.clip(cam, 0, w - 1)] = (255, 0, 255)
        img = Image.fromarray(v)
        esc = 3 if w * 3 <= 2400 else 2
        img.resize((w * esc, h * esc), Image.NEAREST).save(os.path.join(carpeta_debug, f'costuras_{nombre}.png'))
    return salida


def guardar_mascara_debug(rgb, M, origen, ruta, esc=5, paso=10):
    """El cuadro sobre su recorte de la hoja: lo que queda afuera en verde; grilla en coords de hoja."""
    ys, xs = np.nonzero(M)
    if len(xs) == 0:
        return
    a = np.asarray(rgb)
    y0, y1 = max(0, ys.min() - 6), min(a.shape[0], ys.max() + 7)
    x0, x1 = max(0, xs.min() - 6), min(a.shape[1], xs.max() + 7)
    v = a[y0:y1, x0:x1].copy()
    m = M[y0:y1, x0:x1]
    v[~m] = (v[~m] * 0.35 + np.array([0, 150, 0]) * 0.65).astype(np.uint8)
    img = Image.fromarray(v).resize(((x1 - x0) * esc, (y1 - y0) * esc), Image.NEAREST)
    d = ImageDraw.Draw(img)
    ox, oy = origen[0] + x0, origen[1] + y0
    for gx in range(((ox + paso - 1) // paso) * paso, ox + (x1 - x0), paso):
        px = (gx - ox) * esc
        d.line([(px, 0), (px, img.height)], fill=(255, 0, 255) if gx % 50 == 0 else (90, 160, 255))
        d.text((px + 2, 2), str(gx), fill=(255, 255, 0))
    for gy in range(((oy + paso - 1) // paso) * paso, oy + (y1 - y0), paso):
        py = (gy - oy) * esc
        d.line([(0, py), (img.width, py)], fill=(255, 0, 255) if gy % 50 == 0 else (90, 160, 255))
        d.text((2, py + 2), str(gy), fill=(0, 255, 255))
    img.save(ruta)


def saturados(rgb, zona, sat=45, lumMin=50):
    """Píxeles de color (polvo, fuego, destellos) dentro de una zona: el barbero es negro, gris o piel,
    y la piel nunca cae en las zonas donde se usa esto."""
    a = rgb.astype(np.int16)
    mx = a.max(axis=2)
    s = mx - a.min(axis=2)
    return zona & (s >= sat) & (mx >= lumMin)


def recortar_claro(rgb, M, pasos=2, lumMin=50, lumMax=185, sat=18):
    """Pela del borde de la máscara los píxeles gris claro sin saturación (polvo, humo)."""
    a = rgb.astype(np.int16)
    lum = a.max(axis=2)
    s = lum - a.min(axis=2)
    gris = (lum >= lumMin) & (lum <= lumMax) & (s < sat)
    for _ in range(pasos):
        borde = M & ~ndimage.binary_erosion(M)
        M = M & ~(borde & gris)
    return M


def extraer_animacion(hoja, anim, carpeta_debug=None, nombre=''):
    _debug['carpeta'], _debug['nombre'] = carpeta_debug, nombre
    if 'cortes' in anim and 'mascara' in anim:
        lista = cuadros_por_cortes(hoja, anim, carpeta_debug, nombre)
    elif 'cajas' in anim:
        lista = []
        for i, caja in enumerate(ES.cajas_de(anim)):
            c = cuadro_de_caja(hoja, anim, i, caja)
            if c is None:
                print(f'  cuadro {i}: vacío, se omite', file=sys.stderr)
                continue
            lista.append(c)
    else:
        lista = ES.cuadros_de_panel(hoja, anim)
        for k, caja in (anim.get('cajasPorCuadro') or {}).items():
            c = ES.recortar_cuadro(hoja, caja, anim)
            if c is not None and int(k) < len(lista):
                lista[int(k)] = c
    usar = anim.get('usar')
    if usar:
        lista = [lista[i] for i in usar if i < len(lista)]
    return lista


def rampa(n, suave):
    if suave <= 0:
        return np.ones(n, np.float32)
    t = np.minimum(np.arange(n), np.arange(n)[::-1]).astype(np.float32)
    r = np.clip(t / suave, 0, 1)
    return r * r * (3 - 2 * r)


def efecto_nube(hoja_orig, ef):
    """Brillo sobre un fondo oscuro FIJO → sprite con alfa; huecos rellenados clonando la nube."""
    x0, y0, x1, y1 = ef['caja']
    rec = np.asarray(hoja_orig.crop((x0, y0, x1, y1))).astype(np.float32)
    fondo = np.array(ef.get('fondo', [22, 25, 30]), np.float32)
    dif = np.clip(rec - fondo, 0, None)
    alfa = np.clip(dif.max(axis=2) / np.maximum(1.0, 255.0 - fondo.max()), 0, 1)
    hueco = rasterizar(ef.get('quitar'), (x0, y0), (x1 - x0, y1 - y0))
    if ef.get('dilatarHueco'):
        hueco = ndimage.binary_dilation(hueco, iterations=int(ef['dilatarHueco']))
    if hueco.any() and ef.get('poisson'):
        # clonado con mezcla de gradientes (cv2.seamlessClone): el parche de nube de al lado entra
        # sin costuras. Un parche por polígono, con su propio desplazamiento.
        import cv2
        d8 = np.clip(dif, 0, 255).astype(np.uint8)
        a8 = np.dstack([np.clip(alfa * 255, 0, 255).astype(np.uint8)] * 3)
        alto, ancho = hueco.shape
        for k, pol in enumerate(ef['quitar']):
            mh = rasterizar([pol], (x0, y0), (x1 - x0, y1 - y0))
            mh = ndimage.binary_dilation(mh, iterations=2)
            ys, xs = np.nonzero(mh)
            dx = int(ef['clonar'][k] if isinstance(ef.get('clonar'), list) and k < len(ef['clonar']) else 70)
            if xs.min() + dx < 1 or xs.max() + dx > ancho - 2:
                continue
            # margen espejado: seamlessClone falla en silencio si la máscara toca el borde
            P = 12
            pad = ((P, P), (P, P), (0, 0))
            dd = np.pad(d8, pad, mode='reflect')
            aa = np.pad(a8, pad, mode='reflect')
            src_d = np.roll(dd, -dx, axis=1)
            src_a = np.roll(aa, -dx, axis=1)
            m8 = np.pad(mh.astype(np.uint8) * 255, P)
            cx = int((xs.min() + xs.max() + 1) // 2) + P
            cy = int((ys.min() + ys.max() + 1) // 2) + P
            dd = cv2.seamlessClone(src_d, dd, m8, (cx, cy), cv2.NORMAL_CLONE)
            aa = cv2.seamlessClone(src_a, aa, m8, (cx, cy), cv2.NORMAL_CLONE)
            d8 = dd[P:-P, P:-P]
            a8 = aa[P:-P, P:-P]
        dif = d8.astype(np.float32)
        alfa = a8[..., 0].astype(np.float32) / 255.0
        hueco = np.zeros_like(hueco)
    if hueco.any():
        dxs = ef.get('clonar', [60, -60, 120, -120])
        alto, ancho = hueco.shape
        relleno_a = alfa.copy()
        relleno_d = dif.copy()
        pendiente = hueco.copy()
        for dx in dxs:
            ys, xs = np.nonzero(pendiente)
            xs2 = xs + int(dx)
            ok = (xs2 >= 0) & (xs2 < ancho)
            ys, xs, xs2 = ys[ok], xs[ok], xs2[ok]
            ok = ~hueco[ys, xs2]
            ys, xs, xs2 = ys[ok], xs[ok], xs2[ok]
            relleno_a[ys, xs] = alfa[ys, xs2]
            relleno_d[ys, xs] = dif[ys, xs2]
            pendiente[ys, xs] = False
        if pendiente.any():
            # lo que el clonado no alcanzó se rellena por difusión (cv2.inpaint), como niebla
            import cv2
            m8 = pendiente.astype(np.uint8) * 255
            a8 = np.clip(relleno_a * 255, 0, 255).astype(np.uint8)
            relleno_a = cv2.inpaint(a8, m8, 6, cv2.INPAINT_TELEA).astype(np.float32) / 255.0
            d8 = np.clip(relleno_d, 0, 255).astype(np.uint8)
            relleno_d = cv2.inpaint(d8, m8, 6, cv2.INPAINT_TELEA).astype(np.float32)
        # costura suave: mezcla con un borde difuminado del hueco
        sigma = float(ef.get('costura', 2.0))
        peso = ndimage.gaussian_filter(hueco.astype(np.float32), sigma)
        peso = np.maximum(peso, hueco.astype(np.float32))
        alfa = alfa * (1 - peso) + relleno_a * peso
        dif = dif * (1 - peso[..., None]) + relleno_d * peso[..., None]
        alfa = np.clip(alfa, 0, 1)
    suave = float(ef.get('suave', 10))
    if ef.get('forma') == 'elipse':
        # superelipse con borde suave: la nube termina redondeada, no en un rectángulo
        hh, ww = alfa.shape
        yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
        u = (xx - (ww - 1) / 2) / (ww / 2)
        v = (yy - (hh - 1) / 2) / (hh / 2)
        r = (np.abs(u) ** 3 + np.abs(v) ** 3) ** (1 / 3)
        borde = suave / (min(hh, ww) / 2)
        t = np.clip((1 - r) / max(borde, 1e-3), 0, 1)
        alfa = alfa * (t * t * (3 - 2 * t))
    else:
        alfa = alfa * rampa(alfa.shape[0], suave)[:, None] * rampa(alfa.shape[1], suave)[None, :]
    alfa = np.where(alfa < float(ef.get('minimo', 0.04)), 0, alfa)
    # des-premultiplica contra el fondo para que el color quede limpio sobre cualquier arena
    color = np.clip(fondo + dif / np.maximum(alfa[..., None], 1e-3), 0, 255)
    if ef.get('tinte'):
        t = np.array(ef['tinte'], np.float32)
        lum = color.mean(axis=2, keepdims=True) / 255.0
        color = np.clip(color * (1 - float(ef.get('tinteFuerza', 0.25))) + t * lum * float(ef.get('tinteFuerza', 0.25)), 0, 255)
    rgba = np.dstack([color, alfa * 255]).astype(np.uint8)
    img = Image.fromarray(rgba)
    bb = img.getbbox()
    img = img.crop(bb) if bb else img
    return {'img': img, 'ax': img.width / 2.0, 'ay': img.height / 2.0, 'origen': [x0, y0]}


def extraer_efecto(hoja, hoja_orig, ef):
    modo = ef.get('modo')
    if modo == 'luz':
        return ES.efecto_luz(hoja_orig if ef.get('original') else hoja, ef['caja'])
    if modo == 'nube':
        return efecto_nube(hoja_orig, ef)
    opts = {**ef, 'componentes': ef.get('componentes', 'todos'), 'ancla': 'caja'}
    avanzadas = ('mascara', 'sinFondo', 'excluir', 'incluir', 'limite', 'quitarSaturados', 'inferencia')
    if any(k in ef for k in avanzadas):
        if 'mascara' not in ef and 'inferencia' not in ef:
            opts['fuentePorCuadro'] = {'0': 'caja'}
        for k in ('excluir', 'incluir', 'sinFondoPorCuadro', 'limite', 'quitarSaturados'):
            if isinstance(ef.get(k), list):
                opts[k] = {'0': ef[k]}
        c = cuadro_de_caja(hoja, opts, 0, ef['caja'])
    else:
        c = ES.recortar_cuadro(hoja, ef['caja'], opts)
    if c:
        c['ay'] = c['img'].height / 2.0
        c['ax'] = c['img'].width / 2.0
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--solo', default='')
    ap.add_argument('--revision', default='')
    ap.add_argument('--sin-atlas', action='store_true')
    ap.add_argument('--retrato', action='store_true')
    args = ap.parse_args()

    config = os.path.abspath(args.config)
    base = os.path.dirname(config)
    with open(config) as f:
        cfg = json.load(f)
    hoja_orig = Image.open(ES.ruta(base, cfg['hoja'])).convert('RGB')
    hoja = aplicar_limpiezas(hoja_orig, cfg.get('limpiezas'))
    _limpiezas['mascara'] = mascara_limpiezas(hoja.size, cfg.get('limpiezas'))
    if args.revision:
        os.makedirs(args.revision, exist_ok=True)
        hoja.save(os.path.join(args.revision, 'hoja_limpia.png'))

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
    for nombre, anim in cfg['animaciones'].items():
        if solo and nombre not in solo:
            continue
        lista = extraer_animacion(hoja, anim, args.revision or None, nombre)
        resultado[nombre] = {'cuadros': lista, 'impactos': anim.get('impactos', [])}
        print(f'{nombre}: {len(lista)} cuadros')
    efectos = {}
    for nombre, ef in (cfg.get('efectos') or {}).items():
        if solo and nombre not in solo:
            continue
        _debug['carpeta'], _debug['nombre'] = args.revision or None, 'efecto_' + nombre
        c = extraer_efecto(hoja, hoja_orig, ef)
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

    # Guarda en el caché del extractor compartido, con su mismo formato.
    if not solo:
        for archivo in os.listdir(carpeta_cuadros):
            if archivo.endswith('.png'):
                os.remove(os.path.join(carpeta_cuadros, archivo))
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
            entradas.append({'archivo': archivo, 'ax': c['ax'], 'ay': c['ay']})
        previos[nombre] = {'cuadros': entradas, 'impactos': r['impactos']}
    # Lo que ya no está en el JSON se va del caché (si no, quedaría en el atlas).
    validos = set(cfg['animaciones']) | {'efecto:' + k for k in (cfg.get('efectos') or {})}
    previos = {k: v for k, v in previos.items() if k in validos}
    with open(cache, 'w') as f:
        json.dump(previos, f)
    # Orígenes de cada cuadro en la hoja (para revisar a mano); van al caché, que no se versiona.
    ruta_origenes = os.path.join(carpeta_cache, 'origenes.json')
    origenes = {}
    if os.path.exists(ruta_origenes):
        with open(ruta_origenes) as f:
            origenes = json.load(f)
    for nombre, r in pares:
        for i, c in enumerate(r['cuadros']):
            origenes[f"{nombre.replace(':', '_')}_{i}"] = c.get('origen')
    with open(ruta_origenes, 'w') as f:
        json.dump(origenes, f)

    if args.sin_atlas:
        return
    sys.argv = [sys.argv[0], config, '--solo', '__ninguna__'] + (['--retrato'] if args.retrato else [])
    ES.main()


if __name__ == '__main__':
    main()

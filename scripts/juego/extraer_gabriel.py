#!/usr/bin/env python3
"""
Recorte de las hojas de 18 paneles de «Corte Final» (30/oct/2026): Gabriel, Guillermo y Rodrigo.

Los tres usan este motor; extraer_guillermo.py y extraer_rodrigo.py son atajos que lo llaman con su
JSON. Importa el extractor compartido scripts/juego/extraer_sprites.py SIN tocarlo (máscara de
isnet-general-use, separación por manchas, apoyo de cada cuadro, tira de revisión, empaquetado) y
le suma lo que piden estas hojas:

  - JPG de WhatsApp (1536x1024 / 1600x900) con 18 paneles: no hay paneles de herramienta.
    herramienta1 y herramienta2 son ALIAS: los MISMOS rectángulos del atlas que el remate del combo
    y la patada (sin duplicar píxeles). Así el botón MÁQUINA es su golpe pesado.
  - Fondo casi negro y ropa negra: por color no se puede. Funciona la inferencia POR CUADRO
    rellenado a lo ancho ("ancho"); en los parados conviene cruzarla con la del panel
    ("ancho&panel": cada una se come fondo en lugares distintos). Rodrigo (zapatillas blancas)
    pierde los pies con la del panel: "ancho" solo.
  - El rival que recibe (silueta oscura con brillo) y los efectos grandes (remolinos, graffiti,
    ondas, destellos, humo) se sacan: los dibuja el render. Los efectos de color se PINTAN con el
    fondo antes de inferir ("pintar") y se restan después ("quitarColor").
  - Las máscaras del modelo quedan en scripts/juego/personajes/.cache/<id>/mascaras (no se
    versiona): rehacer el atlas después de tocar el JSON tarda segundos y sólo infiere lo nuevo.
  - El atlas sale en WebP sin pérdida o PNG optimizado, el que pese menos (el render carga lo que
    diga atlas.json). Retrato y cara: del mejor cuadro, sin ruido del JPG, LANCZOS y nitidez.

Uso (desde MonacoSmartBarber/; el modelo, con el candado de la Mac):
  OMP_NUM_THREADS=3 python3 scripts/juego/extraer_gabriel.py scripts/juego/personajes/gabriel.json \
      [--revision <carpeta>] [--solo a,b] [--sin-atlas] [--retrato] [--detalle anim[:i],...]
--solo no arma el atlas (sólo revisa). Con --revision deja revision_<anim>.png (la tira del
compartido: pies sobre la línea verde, apoyo X en rojo, alto de «quieto» en celeste),
panel_<anim>.png (la máscara de cada cuadro sobre la hoja; violeta = lo que el modelo daba y se
sacó), lamina.png (todos los cuadros a escala sobre la misma línea de piso), lamina_efectos.png y
retrato_y_cara.png. --detalle deja cuadro_<anim>_<i>.png a 5x con la grilla de la hoja cada 10 px
(para escribir polígonos sin adivinar).

Formato del JSON (coordenadas en px de la HOJA; una "forma" es una caja [x0,y0,x1,y1] o un
polígono [[x,y],...]):
{
  "personaje", "hoja", "salida",
  "retrato": {"anim": "victoria", "cuadro": 0, "alto": 720,
              "cara": [x0,y0,x1,y1] (px del cuadro sin escalar) o {"lado": 40, "arriba": 2,
              "filas": 16, "dx": 0, "anim"?, "cuadro"?} (cuadrado arriba de la cabeza, centrado en
              sus primeras "filas"; puede salir de otro cuadro)},
  "reglas": {"<nombre>": [regla, ...]}   juegos de reglas de color reutilizables por nombre
  "animaciones": {
    "<anim>": {
      "cajas": [[x0,y0,x1,y1], ...]   un cuadro por caja (o "cuadros": n | "cortes": [x | [xa,xb]]
                                      para partir la región por manchas o por costuras)
      "region": [x0,y0,x1,y1]         zona de la inferencia "panel" (default: la de las cajas)
      "inferencia": "ancho" | "panel" | "caja" | "ancho&panel" | "brillo"   (brillo: objetos
                                      claros sobre el fondo, por luminancia: "lumMin", "dilatar")
      "inferenciaPorCuadro": {"i": modo}, "umbral": 0.5, "umbralPorCuadro": {"i": u}
      "usar": [i | [otra_anim, i], ...]   orden final; [otra, i] toma ESE cuadro de otra animación
                                      (el mismo rectángulo del atlas). Índices = cuadros extraídos.
      "alias": "combo" + "usar"       toda la animación sale de cuadros de otra (herramientas)
      "impactos": [...]               índices (después de "usar") de los cuadros que pegan
      "escala": f, "escalaPorCuadro": {"i": f}     filas dibujadas más grandes o más chicas
      "espejo", "espejoPorCuadro", "ancla", "ajusteY", "componentes"   (como en el compartido)
      Opciones de limpieza, por cuadro ({"i": valor}) o para todos (valor suelto), en este orden:
        "pintar": reglas         se pintan con el fondo ANTES de inferir (otra entrada de caché)
        "sumar": [{"modo", "zona"}]  agrega lo que otra inferencia ve dentro de la zona
        "limite": [formas] sólo lo de adentro · "excluir": [formas] se saca
        "agregar": [formas] la máscara del panel ahí · "incluir": [formas] se agrega tal cual
        "quitarColor": reglas    se sacan los píxeles que cumplen la regla
        "sombra": {"zona", "lumMax", "recuperar"}  lo oscuro pegado al piso que se alcanza desde
                                 el fondo (sombras pintadas bajo las zapatillas)
        "humo": {"zona", "lumMin", "lumMax", "satMax", "pasos"}  pela del borde lo gris claro
        "pegados": px            sólo las manchas a menos de px de la principal (pies del vecino)
        "excluirFinal", "incluirFinal" (se agrega tal cual DESPUÉS de quitarColor, sombra y humo:
                                 un tramo del cuerpo teñido por el efecto de al lado),
        "cerrar": radio, "rellenar": N px, "anclaZona": [formas] (apoyo X),
        "apoyoX": {"i": x} (apoyo X a mano en px de la hoja: los pies fijos en un ciclo)
      "injerto": {"donante": [anim, i], "escala": s, "cuadros": {"i": {"corte", "cabeza", "dx"}}}
                                 completa un primer plano cortado por el panel con las piernas
                                 de otro cuadro (Guillermo, especial 1)
    }
  },
  "efectos": {"<nombre>": {"caja", "inferencia", mismas opciones de limpieza, "rotar": grados}}
}
Una regla de color: {"zona"?, "satMin"/"satMax" (0..1), "lumMin"/"lumMax" (0..255), "tono": [h0,h1]
(grados; h0 > h1 da la vuelta), "bMenosRMin", "rMenosBMin", "gMenosRMin", "bMenosGMin",
"rMenosGMin", "suavizar": k (mide sobre el promedio k x k: el ruido del JPG en lo oscuro)}.
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
_REPO = '/Users/ignaciobaldovino/MSB_FULL/MonacoSmartBarber'
for _d in (_AQUI, os.path.join(_REPO, 'scripts', 'juego')):
    if os.path.exists(os.path.join(_d, 'extraer_sprites.py')):
        sys.path.insert(0, _d)
        break
import extraer_sprites as ES  # noqa: E402

CLAVES = ES.CLAVES
VERSION_MASCARAS = 'v1'


# ─── Formas y máscaras ─────────────────────────────────────────────────────────────────────────

def rasterizar(formas, origen, tam):
    """Formas en px de la hoja → máscara bool local de tamaño tam=(w, h) con origen (ox, oy)."""
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


def caja_de_formas(formas):
    xs, ys = [], []
    for f in formas:
        if len(f) == 4 and all(isinstance(v, (int, float)) for v in f):
            xs += [f[0], f[2]]
            ys += [f[1], f[3]]
        else:
            xs += [p[0] for p in f]
            ys += [p[1] for p in f]
    return [int(min(xs)), int(min(ys)), int(max(xs)) + 1, int(max(ys)) + 1]


class Hoja:
    """La hoja del dueño + las máscaras de isnet cacheadas en disco por región y modo."""

    def __init__(self, ruta, carpeta_cache):
        self.img = Image.open(ruta).convert('RGB')
        self.arr = np.asarray(self.img)
        with open(ruta, 'rb') as f:
            self.firma = hashlib.sha1(f.read()).hexdigest()[:12]
        self.carpeta = os.path.join(carpeta_cache, 'mascaras')
        os.makedirs(self.carpeta, exist_ok=True)
        self.mem = {}
        self.inferencias = 0

    def alfa(self, region, modo='panel', pintar=None):
        x0, y0, x1, y1 = (int(v) for v in region)
        clave = f'{VERSION_MASCARAS}_{self.firma}_{modo}_{x0}_{y0}_{x1}_{y1}'
        if pintar:
            clave += '_p' + hashlib.sha1(json.dumps(pintar, sort_keys=True).encode()).hexdigest()[:10]
        if clave in self.mem:
            return self.mem[clave]
        ruta = os.path.join(self.carpeta, clave + '.png')
        if os.path.exists(ruta):
            a = np.asarray(Image.open(ruta)).astype(np.float32) / 255.0
        else:
            a = self._inferir((x0, y0, x1, y1), modo, pintar)
            Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)).save(ruta)
            self.inferencias += 1
        self.mem[clave] = a
        return a

    def recorte(self, region, pintar=None):
        """Recorte RGB de la hoja; con "pintar", los píxeles de las reglas van con el color del fondo
        (efectos que el modelo confunde con el cuerpo: remolinos, graffiti, chispas)."""
        x0, y0, x1, y1 = region
        a = self.arr[y0:y1, x0:x1].copy()
        if pintar:
            lum = a.astype(np.float32).max(axis=2)
            oscuros = a[lum < 45]
            fondo = np.median(oscuros, axis=0) if len(oscuros) else np.array([16, 19, 23])
            for r in pintar:
                c = condicion_color(a, r, (x0, y0))
                a[c] = np.array(r.get('color', fondo), np.uint8)
        return Image.fromarray(a)

    def _inferir(self, region, modo, pintar=None):
        rec = self.recorte(region, pintar)
        w, h = rec.size
        if modo == 'caja':
            return ES.mascara_isnet(rec, cuadrar=True)
        if modo == 'ancho':
            return mascara_ancha(rec, 2.5)
        if w <= 3.2 * h:
            return ES.mascara_isnet(rec)
        # Panel muy ancho (los especiales ocupan toda la hoja): el modelo lo estiraría a 1024x1024
        # y aplastaría a cada barbero. Ventanas de 2,6:1 que se pisan, promediadas con más peso
        # en el centro de cada una.
        W = int(round(2.6 * h))
        S = int(round(W * 0.55))
        inicios = list(range(0, w - W + 1, S))
        if inicios[-1] != w - W:
            inicios.append(w - W)
        acc = np.zeros((h, w), np.float32)
        peso = np.zeros(w, np.float32)
        carpa = (0.15 + 0.85 * (1 - np.abs(np.linspace(-1, 1, W)))).astype(np.float32)
        for s in inicios:
            m = ES.mascara_isnet(rec.crop((s, 0, s + W, h)))
            acc[:, s:s + W] += m * carpa[None, :]
            peso[s:s + W] += carpa
        return acc / np.maximum(peso, 1e-6)[None, :]


def mascara_ancha(rec, relacion=2.5):
    """Un recorte rellenado a lo ANCHO (relación ancho:alto) con el color del borde: así el modelo
    respeta el hueco entre las piernas (rellenado a cuadrado devuelve una mancha)."""
    a = np.asarray(rec)
    borde = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    color = tuple(int(v) for v in np.median(borde, axis=0))
    w = max(int(rec.height * relacion), rec.width)
    lienzo = Image.new('RGB', (w, rec.height), color)
    off = (w - rec.width) // 2
    lienzo.paste(rec, (off, 0))
    m = ES.mascara_isnet(lienzo)
    return m[:, off:off + rec.width]


def costura(M, xa, xb):
    """Camino de arriba abajo (±1 px por fila) entre xa y xb que cruza la menor cantidad de máscara."""
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


def hsv(rgb):
    """Tono (grados), saturación (0..1) y luminancia (0..255) de un arreglo RGB uint8."""
    a = rgb.astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(axis=2), a.min(axis=2)
    d = mx - mn
    sat = np.where(mx > 0, d / np.maximum(mx, 1), 0)
    tono = np.zeros_like(mx)
    dd = np.maximum(d, 1e-6)
    tono = np.where(mx == r, ((g - b) / dd) % 6, tono)
    tono = np.where(mx == g, (b - r) / dd + 2, tono)
    tono = np.where(mx == b, (r - g) / dd + 4, tono)
    tono = np.where(d < 1e-6, 0, tono) * 60.0
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return tono, sat, lum


def condicion_color(rgb, r, origen):
    """Píxeles (de un recorte con ese origen en la hoja) que cumplen TODAS las condiciones de la regla:
    zona (forma), satMin/satMax (0..1), lumMin/lumMax (0..255), tono [h0,h1] (grados; h0 > h1 da la
    vuelta), bMenosRMin, rMenosBMin, gMenosRMin, bMenosGMin, rMenosGMin (diferencias de canal).
    "suavizar": k mide todo sobre el promedio de k x k (el ruido del JPG en lo oscuro: el azul marino
    de un remolino y la campera negra se separan por el promedio, no píxel a píxel)."""
    h, w = rgb.shape[:2]
    c = rasterizar([r['zona']], origen, (w, h)) if r.get('zona') else np.ones((h, w), bool)
    if r.get('suavizar'):
        k = int(r['suavizar'])
        rgb = np.clip(ndimage.uniform_filter(rgb.astype(np.float32), size=(k, k, 1)) + 0.5, 0, 255).astype(np.uint8)
    if any(k in r for k in ('satMin', 'satMax', 'lumMin', 'lumMax', 'tono')):
        tono, sat, lum = hsv(rgb)
        if 'satMin' in r:
            c &= sat >= r['satMin']
        if 'satMax' in r:
            c &= sat <= r['satMax']
        if 'lumMin' in r:
            c &= lum >= r['lumMin']
        if 'lumMax' in r:
            c &= lum <= r['lumMax']
        if 'tono' in r:
            h0, h1 = r['tono']
            c &= ((tono >= h0) & (tono <= h1)) if h0 <= h1 else ((tono >= h0) | (tono <= h1))
    a = rgb.astype(np.int16)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    if 'bMenosRMin' in r:
        c &= (B - R) >= r['bMenosRMin']
    if 'rMenosBMin' in r:
        c &= (R - B) >= r['rMenosBMin']
    if 'gMenosRMin' in r:
        c &= (G - R) >= r['gMenosRMin']
    if 'bMenosGMin' in r:
        c &= (B - G) >= r['bMenosGMin']
    if 'rMenosGMin' in r:
        c &= (R - G) >= r['rMenosGMin']
    return c


def expandir_reglas(cfg):
    """"pintar"/"quitarColor" pueden nombrar un juego de reglas de cfg["reglas"] (o una lista que mezcle
    nombres y reglas): se expanden una vez al cargar."""
    juegos = cfg.get('reglas') or {}

    def exp(v):
        if isinstance(v, str):
            return list(juegos[v])
        if isinstance(v, list):
            out = []
            for x in v:
                out += exp(x) if isinstance(x, str) else [x]
            return out
        return v

    for anim in list((cfg.get('animaciones') or {}).values()) + list((cfg.get('efectos') or {}).values()):
        for k in ('pintar', 'quitarColor'):
            v = anim.get(k)
            if isinstance(v, dict):
                anim[k] = {i: exp(x) for i, x in v.items()}
            elif v is not None:
                anim[k] = exp(v)


def por_cuadro(anim, clave, i):
    """Opción por cuadro ({"i": v}, claves numéricas) o para todos (cualquier otro valor, incluido
    un objeto como {"zona": ..., "lumMax": ...})."""
    v = anim.get(clave)
    if isinstance(v, dict) and v and all(str(k).isdigit() for k in v):
        return v.get(str(i))
    return v


# ─── Cuadros ───────────────────────────────────────────────────────────────────────────────────

def mascaras_de_anim(hoja, anim):
    """Máscaras bool de cada cuadro, todas del tamaño de la región (en orden de la hoja)."""
    if 'cajas' in anim and 'region' not in anim:
        region = caja_de_formas(anim['cajas'])
    else:
        region = [int(v) for v in anim['region']]
    rx0, ry0, rx1, ry1 = region
    w, h = rx1 - rx0, ry1 - ry0
    umbral = float(anim.get('umbral', 0.5))
    modo = anim.get('inferencia', 'panel')
    M = None
    fuentes = set((anim.get('inferenciaPorCuadro') or {}).values()) | {modo}
    por_panel = any('panel' in f for f in fuentes)
    if por_panel or 'cajas' not in anim or anim.get('agregar'):
        M = hoja.alfa(region, 'panel') >= umbral
        M = ndimage.binary_opening(M, structure=np.ones((2, 2)))
    partes = []
    if 'cajas' in anim:
        for i, caja in enumerate(anim['cajas']):
            x0, y0, x1, y1 = (int(v) for v in caja)
            fuente = (anim.get('inferenciaPorCuadro') or {}).get(str(i), modo)
            m = np.zeros((h, w), bool)
            if fuente == 'panel' and M is not None:
                m[max(0, y0 - ry0):y1 - ry0, max(0, x0 - rx0):x1 - rx0] = \
                    M[max(0, y0 - ry0):y1 - ry0, max(0, x0 - rx0):x1 - rx0]
            elif fuente == 'brillo':
                # objetos que brillan sobre el fondo oscuro (botellas, vasos): lo que se despega del
                # fondo por luminancia, con los huecos tapados y "dilatar" px de contorno oscuro
                _, _, lum = hsv(hoja.arr[y0:y1, x0:x1])
                sub = ndimage.binary_fill_holes(lum >= float(anim.get('lumMin', 50)))
                dil = int(anim.get('dilatar', 1))
                if dil > 0:
                    sub = ndimage.binary_dilation(sub, iterations=dil) & (lum >= float(anim.get('lumBorde', 8)))
                ix0, iy0, ix1, iy1 = max(x0, rx0), max(y0, ry0), min(x1, rx1), min(y1, ry1)
                m[iy0 - ry0:iy1 - ry0, ix0 - rx0:ix1 - rx0] = sub[iy0 - y0:iy1 - y0, ix0 - x0:ix1 - x0]
            else:
                # "ancho&panel": sólo lo que dan las dos inferencias (la del cuadro rellenado a lo
                # ancho se come a veces una franja de fondo al costado; la del panel, el piso entre
                # las piernas: casi nunca en el mismo lugar)
                base = fuente.split('&')[0]
                u = float((anim.get('umbralPorCuadro') or {}).get(str(i), umbral))
                pint = por_cuadro(anim, 'pintar', i)
                sub = hoja.alfa((x0, y0, x1, y1), base, pint) >= u
                sub = ndimage.binary_opening(sub, structure=np.ones((2, 2)))
                # la caja puede pasarse de la región: se pega sólo lo que cae adentro
                ix0, iy0, ix1, iy1 = max(x0, rx0), max(y0, ry0), min(x1, rx1), min(y1, ry1)
                m[iy0 - ry0:iy1 - ry0, ix0 - rx0:ix1 - rx0] = sub[iy0 - y0:iy1 - y0, ix0 - x0:ix1 - x0]
                if fuente.endswith('&panel') and M is not None:
                    m &= M
            # "sumar": {"i": [{"modo": "ancho"|"caja"|"panel", "zona": forma}]} agrega lo que otra
            # inferencia ve dentro de la zona (un pie que la elegida se comió)
            for sm in por_cuadro(anim, 'sumar', i) or []:
                zona = rasterizar([sm['zona']], (rx0, ry0), (w, h))
                if sm.get('modo', 'panel') == 'panel':
                    Mp = hoja.alfa(region, 'panel') >= umbral
                    m |= Mp & zona
                else:
                    sub = hoja.alfa((x0, y0, x1, y1), sm['modo']) >= umbral
                    tmp = np.zeros((h, w), bool)
                    ix0, iy0, ix1, iy1 = max(x0, rx0), max(y0, ry0), min(x1, rx1), min(y1, ry1)
                    tmp[iy0 - ry0:iy1 - ry0, ix0 - rx0:ix1 - rx0] = sub[iy0 - y0:iy1 - y0, ix0 - x0:ix1 - x0]
                    m |= tmp & zona
            partes.append(m)
    elif 'cortes' in anim:
        xs = np.arange(w)[None, :]
        caminos = []
        for c in anim['cortes']:
            if isinstance(c, (list, tuple)):
                caminos.append(costura(M, int(c[0]) - rx0, int(c[1]) - rx0))
            else:
                caminos.append(np.full(h, int(c) - rx0))
        for i in range(len(caminos) + 1):
            izq = caminos[i - 1] if i > 0 else np.full(h, -1)
            der = caminos[i] if i < len(caminos) else np.full(h, w + 1)
            partes.append(M & (xs >= izq[:, None]) & (xs < der[:, None]))
    else:
        partes = ES.separar_cuadros(M, int(anim['cuadros']))
        if len(partes) != int(anim['cuadros']):
            print(f"  AVISO: se esperaban {anim['cuadros']} cuadros y salieron {len(partes)}", file=sys.stderr)
    return region, M, partes


def limpiar_cuadro(hoja, anim, i, region, M, m):
    rx0, ry0, rx1, ry1 = region
    tam = (rx1 - rx0, ry1 - ry0)
    org = (rx0, ry0)
    rgb = hoja.arr[ry0:ry1, rx0:rx1]
    lim = por_cuadro(anim, 'limite', i)
    if lim:
        m = m & rasterizar(lim, org, tam)
    exc = por_cuadro(anim, 'excluir', i)
    if exc:
        m = m & ~rasterizar(exc, org, tam)
    agr = por_cuadro(anim, 'agregar', i)
    if agr and M is not None:
        m = m | (M & rasterizar(agr, org, tam))
    inc = por_cuadro(anim, 'incluir', i)
    if inc:
        m = m | rasterizar(inc, org, tam)
    reglas = por_cuadro(anim, 'quitarColor', i)
    if reglas:
        for r in reglas:
            m = m & ~condicion_color(rgb, r, org)
    sombra = por_cuadro(anim, 'sombra', i)
    if sombra:
        # sombra pintada en el piso pegada a las zapatillas: lo oscuro de la zona que se alcanza desde
        # el fondo caminando por lo oscuro se va; después se devuelve un anillo de "recuperar" px
        # alrededor de lo que quedó (el contorno negro de la suela)
        _, _, lum = hsv(rgb)
        zona = rasterizar([sombra['zona']], org, tam) if sombra.get('zona') else np.ones(m.shape, bool)
        oscuro = (lum <= sombra.get('lumMax', 40)) & zona
        camino = oscuro | ~m
        et, _ = ndimage.label(camino)
        # semillas: el fondo y lo oscuro de la fila de abajo de la zona (el piso entre las piernas
        # suele quedar encerrado por la máscara y sólo toca el borde de abajo del cuadro)
        abajo = np.zeros_like(m)
        filas = np.nonzero(zona.any(axis=1))[0]
        if len(filas):
            abajo[filas.max(), :] = True
        ids = np.unique(et[~m | (abajo & oscuro & zona)])
        ids = ids[ids > 0]
        fuera = np.isin(et, ids) & m & zona
        m2 = m & ~fuera
        rec = int(sombra.get('recuperar', 1))
        if rec > 0:
            m2 = m2 | (ndimage.binary_dilation(m2, iterations=rec) & m)
        m = m2
    humo = por_cuadro(anim, 'humo', i)
    if humo:
        _, sat, lum = hsv(rgb)
        gris = (lum >= humo.get('lumMin', 80)) & (lum <= humo.get('lumMax', 235)) & (sat <= humo.get('satMax', 0.2))
        if humo.get('zona'):
            gris &= rasterizar([humo['zona']], org, tam)
        for _ in range(int(humo.get('pasos', 3))):
            borde = m & ~ndimage.binary_erosion(m)
            m = m & ~(borde & gris)
    m = ES.limpiar(m, anim.get('componentes', 'principal'))
    peg = por_cuadro(anim, 'pegados', i)
    if peg is not None and m.any():
        # sólo se quedan las manchas a menos de "pegados" px de la principal (un pie del cuadro
        # vecino que entra en la caja no está pegado al cuerpo)
        et, n = ndimage.label(m, structure=np.ones((3, 3)))
        if n > 1:
            areas = ndimage.sum(m, et, range(1, n + 1))
            mayor = int(np.argmax(areas)) + 1
            cerca = ndimage.binary_dilation(et == mayor, iterations=int(peg) + 1)
            ids = [k for k in range(1, n + 1) if k == mayor or (cerca & (et == k)).any()]
            m = np.isin(et, ids)
    exc2 = por_cuadro(anim, 'excluirFinal', i)
    if exc2:
        m = m & ~rasterizar(exc2, org, tam)
    inc2 = por_cuadro(anim, 'incluirFinal', i)
    if inc2:
        # formas que se agregan al FINAL, después de quitarColor, sombra y humo: un tramo oscuro del
        # cuerpo teñido por el efecto de al lado (la muñeca entre el brazo y la lata del graffiti)
        m = m | rasterizar(inc2, org, tam)
    cerrar = por_cuadro(anim, 'cerrar', i)
    if cerrar:
        r = int(cerrar)
        est = ndimage.generate_binary_structure(2, 1)
        m = ndimage.binary_closing(np.pad(m, r + 1), structure=est, iterations=r)[r + 1:-r - 1, r + 1:-r - 1]
    rell = por_cuadro(anim, 'rellenar', i)
    if rell:
        huecos = ndimage.binary_fill_holes(m) & ~m
        et, n = ndimage.label(huecos)
        if n:
            areas = ndimage.sum(huecos, et, range(1, n + 1))
            m |= np.isin(et, [k + 1 for k, a in enumerate(areas) if a < int(rell)])
    return m


def escalar_cuadro(c, s):
    if abs(s - 1) < 1e-6:
        return c
    im = c['img']
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    chica = im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    a = np.asarray(chica).copy()
    # bordes duros como el resto de los cuadros (el render dibuja sin suavizado)
    a[..., 3] = np.where(a[..., 3] >= 110, 255, 0).astype(np.uint8)
    out = dict(c)
    out['img'] = Image.fromarray(a)
    out['ax'] = round(c['ax'] * w / im.width, 1)
    out['ay'] = round(c['ay'] * h / im.height, 1)
    return out


DETALLE = set()


def detalle_debug(hoja, nombre, i, region, m, crudo, carpeta, esc=5):
    """Un cuadro a 5x: afuera en verde, lo que el modelo daba y se sacó en violeta, grilla cada 10 px
    de la hoja con su número (para escribir polígonos de limpieza sin adivinar)."""
    rx0, ry0, rx1, ry1 = region
    ys, xs = np.nonzero(m | crudo)
    if len(xs) == 0:
        return
    y0, y1 = max(0, ys.min() - 8), min(m.shape[0], ys.max() + 9)
    x0, x1 = max(0, xs.min() - 8), min(m.shape[1], xs.max() + 9)
    v = hoja.arr[ry0 + y0:ry0 + y1, rx0 + x0:rx0 + x1].astype(np.float32).copy()
    mm, cc = m[y0:y1, x0:x1], crudo[y0:y1, x0:x1]
    v[~mm & ~cc] = v[~mm & ~cc] * 0.4 + np.array([0, 110, 0]) * 0.6
    v[~mm & cc] = v[~mm & cc] * 0.4 + np.array([210, 0, 210]) * 0.6
    img = Image.fromarray(v.astype(np.uint8)).resize(((x1 - x0) * esc, (y1 - y0) * esc), Image.NEAREST)
    d = ImageDraw.Draw(img)
    ox, oy = rx0 + x0, ry0 + y0
    for gx in range(((ox + 9) // 10) * 10, ox + (x1 - x0), 10):
        px = (gx - ox) * esc
        d.line([(px, 0), (px, img.height)], fill=(255, 0, 255) if gx % 50 == 0 else (70, 120, 200))
        d.text((px + 2, 2), str(gx), fill=(255, 255, 0))
    for gy in range(((oy + 9) // 10) * 10, oy + (y1 - y0), 10):
        py = (gy - oy) * esc
        d.line([(0, py), (img.width, py)], fill=(255, 0, 255) if gy % 50 == 0 else (70, 120, 200))
        d.text((2, py + 2), str(gy), fill=(0, 255, 255))
    img.save(os.path.join(carpeta, f'cuadro_{nombre}_{i}.png'))


def extraer_anim(hoja, nombre, anim, revision=None, extraidos=None):
    region, M, partes = mascaras_de_anim(hoja, anim)
    rx0, ry0, rx1, ry1 = region
    rgb_img = Image.fromarray(np.ascontiguousarray(hoja.arr[ry0:ry1, rx0:rx1]))
    finales, cuadros = [], []
    for i, m in enumerate(partes):
        crudo = m
        m = limpiar_cuadro(hoja, anim, i, region, M, m)
        finales.append(m)
        if revision and (nombre in DETALLE or f'{nombre}:{i}' in DETALLE):
            detalle_debug(hoja, nombre, i, region, m, crudo, revision)
        opts = dict(anim)
        esp = (anim.get('espejoPorCuadro') or {}).get(str(i))
        if esp is not None:
            opts['espejo'] = bool(esp)
        c = ES.cuadro_desde_mascara(rgb_img, m, opts, (rx0, ry0))
        if c is None:
            print(f'  {nombre}[{i}]: vacío, se omite', file=sys.stderr)
            cuadros.append(None)
            continue
        zona = por_cuadro(anim, 'anclaZona', i)
        if zona:
            solo = m & rasterizar(zona, (rx0, ry0), (rx1 - rx0, ry1 - ry0))
            ys, xs = np.nonzero(solo)
            if len(xs):
                sub = solo[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
                ax = ES.ancla_x(sub, anim.get('ancla', 'torso')) + (xs.min() + rx0 - c['origen'][0])
                if opts.get('espejo'):
                    ax = c['img'].width - ax
                c['ax'] = round(float(ax), 1)
        apoyo = por_cuadro(anim, 'apoyoX', i)
        if apoyo is not None:
            # apoyo X a mano, en px de la hoja: en un ciclo cuyo torso se balancea, que los pies no
            # patinen (el apoyo «torso» los corría 10-18 u del mundo entre cuadros de «quieto»)
            ax = float(apoyo) - c['origen'][0]
            if opts.get('espejo'):
                ax = c['img'].width - ax
            c['ax'] = round(ax, 1)
        # máscara blanda del modelo (para el retrato: bordes suaves al agrandar)
        c['mascara'] = m
        c['region'] = region
        inj = anim.get('injerto')
        if inj and str(i) in (inj.get('cuadros') or {}):
            cuadros.append(injertar(c, inj, inj['cuadros'][str(i)], extraidos or {}))
            continue
        s = float((anim.get('escalaPorCuadro') or {}).get(str(i), anim.get('escala', 1.0)))
        cuadros.append(escalar_cuadro(c, s))
    if revision:
        panel_debug(hoja, nombre, region, M, finales, revision)
    return cuadros


def resolver_usar(nombre, anim, extraidos):
    """Lista final de una animación. "usar" admite índices propios y [otra_anim, índice] (el MISMO
    cuadro, que en el atlas es el mismo rectángulo). "alias": "combo" + "usar" = todo de esa otra.
    Todos los índices son de los cuadros EXTRAÍDOS (antes del "usar" de cada animación)."""
    if 'alias' in anim:
        fuente = anim['alias']
        usar = anim.get('usar') or list(range(len(extraidos.get(fuente) or [])))
        entradas = [[fuente, k] for k in usar]
    else:
        usar = anim.get('usar')
        entradas = usar if usar else list(range(len(extraidos.get(nombre) or [])))
    lista = []
    for e in entradas:
        if isinstance(e, list):
            origen, k = e[0], int(e[1])
        else:
            origen, k = nombre, int(e)
        fuente = extraidos.get(origen)
        if fuente is None or k >= len(fuente) or fuente[k] is None:
            print(f'  AVISO {nombre}: no hay cuadro {origen}[{k}]', file=sys.stderr)
            continue
        lista.append(fuente[k])
    return lista


def injertar(c, inj, opc, extraidos):
    """Completa un cuadro cortado por el borde del panel (un primer plano sin piernas) con las piernas
    de otro cuadro ya extraído: la parte de arriba del corte se escala por "escala" (para que la
    cabeza y el torso tengan el tamaño del resto) y se apoya sobre las piernas del donante, alineada
    por la cabeza (y de la cabeza en la hoja, "cabeza") y, en x, por el centro del pantalón en la
    franja del corte (+ "dx"). El apoyo (ax, ay) es el de los pies del donante.

    inj = {"donante": [anim, i], "escala": s, "cuadros": {"i": {"corte": y, "cabeza": y, "dx": px}}}
    """
    don = (extraidos.get(inj['donante'][0]) or [None] * 99)[int(inj['donante'][1])]
    if don is None:
        print('  AVISO injerto: no está el donante', inj['donante'], file=sys.stderr)
        return c
    s = float(opc.get('escala', inj.get('escala', 1.0)))
    ox, oy = c['origen']
    corte = int(opc['corte']) - oy
    cabeza = (float(opc['cabeza']) - oy) * s
    im = c['img']
    arriba = im.crop((0, 0, im.width, max(1, min(im.height, corte))))
    T = escalar_cuadro({'img': arriba, 'ax': 0, 'ay': 0}, s)['img']
    D = don['img']
    Ta, Da = np.asarray(T)[..., 3] > 0, np.asarray(D)[..., 3] > 0
    # filas en el lienzo: la cabeza del donante es su fila 0 (no tiene nada encima de la cabeza)
    y_corte = int(round(T.height - cabeza))
    franja = slice(max(0, T.height - 8), T.height)
    xs_t = np.nonzero(Ta[franja].any(axis=0))[0]
    fd0, fd1 = max(0, y_corte - 8), max(1, min(D.height, y_corte))
    xs_d = np.nonzero(Da[fd0:fd1].any(axis=0))[0]
    if len(xs_t) == 0 or len(xs_d) == 0:
        print('  AVISO injerto: no hay pantalón en la franja del corte', file=sys.stderr)
        return c
    dx = (xs_d.min() + xs_d.max()) / 2 - (xs_t.min() + xs_t.max()) / 2 + float(opc.get('dx', 0))
    # lienzo: T arriba (puede empezar antes que la cabeza: botella levantada), donante abajo
    ty = -int(round(cabeza))
    tx = int(round(dx))
    x0 = min(0, tx)
    y0 = min(0, ty)
    W = max(D.width, tx + T.width) - x0
    H = max(D.height, ty + T.height) - y0
    lienzo = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    solape = int(opc.get('solape', 3))
    piernas = D.crop((0, max(0, y_corte - solape), D.width, D.height))
    lienzo.alpha_composite(piernas, (-x0, max(0, y_corte - solape) - y0))
    lienzo.alpha_composite(T, (tx - x0, ty - y0))
    a = np.asarray(lienzo).copy()
    a[..., 3] = np.where(a[..., 3] >= 110, 255, 0).astype(np.uint8)
    out = dict(c)
    out['img'] = Image.fromarray(a)
    out['ax'] = round(float(don['ax']) - x0, 1)
    out['ay'] = round(float(don['ay']) - y0, 1)
    out['injertado'] = True
    return out


COLORES = [(255, 70, 70), (70, 160, 255), (255, 210, 40), (70, 230, 120), (240, 90, 240),
           (255, 140, 0), (0, 230, 230), (190, 120, 255), (255, 255, 255), (150, 255, 60),
           (255, 120, 170), (120, 200, 255)]


def panel_debug(hoja, nombre, region, M, finales, carpeta, paso=10):
    """El panel con lo que queda afuera oscurecido, el contorno de cada cuadro y la grilla de la hoja."""
    rx0, ry0, rx1, ry1 = region
    v = hoja.arr[ry0:ry1, rx0:rx1].astype(np.float32).copy()
    union = np.zeros(v.shape[:2], bool)
    for m in finales:
        union |= m
    v[~union] = v[~union] * 0.35 + np.array([0, 90, 0]) * 0.65
    if M is not None:
        solo_modelo = M & ~union
        v[solo_modelo] = v[solo_modelo] * 0.4 + np.array([200, 0, 200]) * 0.6
    v = v.astype(np.uint8)
    for k, m in enumerate(finales):
        borde = m & ~ndimage.binary_erosion(m)
        v[borde] = COLORES[k % len(COLORES)]
    w, h = rx1 - rx0, ry1 - ry0
    esc = 3 if w * 3 <= 2600 else 2
    img = Image.fromarray(v).resize((w * esc, h * esc), Image.NEAREST)
    d = ImageDraw.Draw(img)
    for gx in range(((rx0 + paso - 1) // paso) * paso, rx1, paso):
        px = (gx - rx0) * esc
        fuerte = gx % 50 == 0
        d.line([(px, 0), (px, 6 if not fuerte else img.height)], fill=(255, 0, 255) if fuerte else (90, 160, 255))
        if fuerte:
            d.text((px + 2, 2), str(gx), fill=(255, 255, 0))
    for gy in range(((ry0 + paso - 1) // paso) * paso, ry1, paso):
        py = (gy - ry0) * esc
        fuerte = gy % 50 == 0
        d.line([(0, py), (6 if not fuerte else img.width, py)], fill=(255, 0, 255) if fuerte else (90, 160, 255))
        if fuerte:
            d.text((2, py + 2), str(gy), fill=(0, 255, 255))
    for k, m in enumerate(finales):
        ys, xs = np.nonzero(m)
        if len(xs):
            d.text((int(xs.mean()) * esc, img.height - 14), str(k), fill=COLORES[k % len(COLORES)])
    img.save(os.path.join(carpeta, f'panel_{nombre}.png'))


# ─── Efectos ───────────────────────────────────────────────────────────────────────────────────

def extraer_efecto(hoja, nombre, ef, revision=None):
    opts = {**ef, 'componentes': ef.get('componentes', 'todos'), 'ancla': 'caja'}
    opts.setdefault('inferencia', 'caja')
    opts['cajas'] = [ef['caja']]
    for k in ('limite', 'excluir', 'incluir', 'quitarColor', 'humo', 'rellenar', 'cerrar', 'excluirFinal'):
        if isinstance(ef.get(k), list) or isinstance(ef.get(k), (int, float)) or (k == 'humo' and ef.get(k)):
            opts[k] = {'0': ef[k]}
    if opts['inferencia'] == 'panel':
        opts['region'] = ef['caja']
    lista = extraer_anim(hoja, 'efecto_' + nombre, opts, revision)
    if not lista or lista[0] is None:
        return None
    c = lista[0]
    if ef.get('rotar'):
        im = c['img'].rotate(float(ef['rotar']), resample=Image.BICUBIC, expand=True)
        a = np.asarray(im).copy()
        a[..., 3] = np.where(a[..., 3] >= 128, 255, 0).astype(np.uint8)
        im = Image.fromarray(a)
        c['img'] = im.crop(im.getbbox())
    c['ax'] = round(c['img'].width / 2.0, 1)
    c['ay'] = round(c['img'].height / 2.0, 1)
    return c


# ─── Retrato y cara ────────────────────────────────────────────────────────────────────────────

def agrandar(img_rgba, tam, nitidez=True):
    """Agranda con LANCZOS en alfa premultiplicado (sin halo) y un poco de nitidez. El cuadro viene de
    un JPG de WhatsApp de ~120 px: antes de agrandar se le saca el ruido del JPG a su tamaño
    (cv2.bilateralFilter, que conserva los bordes); si no, se agranda como manchas."""
    import cv2
    rgb = cv2.bilateralFilter(np.ascontiguousarray(np.asarray(img_rgba.convert('RGB'))), 5, 28, 5)
    limpio = Image.fromarray(rgb).convert('RGBA')
    limpio.putalpha(img_rgba.getchannel('A'))
    grande = limpio.convert('RGBa').resize(tam, Image.LANCZOS).convert('RGBA')
    if not nitidez:
        return grande
    out = grande.convert('RGB').filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=1)).convert('RGBA')
    out.putalpha(grande.getchannel('A'))
    return out


def cuadro_suave(hoja, c):
    """El cuadro sin escalar con el alfa BLANDO del modelo dentro de la máscara final (bordes lisos
    al agrandar) y los colores del borde estirados desde adentro (el fondo no tiñe el contorno)."""
    rx0, ry0, rx1, ry1 = c['region']
    m = c['mascara']
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb = hoja.arr[ry0:ry1, rx0:rx1][y0:y1, x0:x1].astype(np.float32)
    sub = m[y0:y1, x0:x1]
    # alfa: la máscara final, con el borde exterior suavizado a medio píxel
    alfa = ndimage.gaussian_filter(sub.astype(np.float32), 0.6)
    alfa = np.where(sub, np.maximum(alfa, 0.5), alfa * 0.6)
    # colores del borde: los píxeles del contorno toman el promedio de sus vecinos de adentro
    adentro = ndimage.binary_erosion(sub, iterations=1)
    cerca = ndimage.binary_dilation(sub, iterations=2) & ~adentro
    suma = ndimage.uniform_filter(rgb * adentro[..., None], size=(5, 5, 1))
    cuenta = ndimage.uniform_filter(adentro.astype(np.float32), size=5)[..., None]
    prom = suma / np.maximum(cuenta, 1e-3)
    usar = cerca & (cuenta[..., 0] > 0.05)
    rgb = np.where(usar[..., None], rgb * 0.35 + prom * 0.65, rgb)
    rgba = np.dstack([np.clip(rgb, 0, 255), alfa * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, 'RGBA')
    return img


def procesar_retrato(hoja, cfg, resultados, salida, revision=None):
    r = cfg['retrato']
    lista = resultados[r['anim']]
    c = lista[int(r.get('cuadro', 0))]
    img = cuadro_suave(hoja, c)
    if r.get('espejo'):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    alto = int(r.get('alto', 720))
    ancho = round(img.width * alto / img.height)
    ret = agrandar(img, (ancho, alto))
    ret.save(os.path.join(salida, 'retrato.webp'), 'WEBP', quality=90, method=6)
    cara = r.get('cara')
    if isinstance(cara, dict) and cara.get('anim'):
        # la cara puede salir de otro cuadro (el del retrato tapa la cara con una mano o un objeto)
        img = cuadro_suave(hoja, resultados[cara['anim']][int(cara.get('cuadro', 0))])
    if isinstance(cara, dict):
        # cuadrado de "lado" px con la cabeza arriba: el centro x sale de las primeras filas del cuadro
        a = np.asarray(img)[..., 3] > 0
        ys, xs = np.nonzero(a)
        top = int(ys.min())
        cols = np.nonzero(a[top:top + int(cara.get('filas', 22))].any(axis=0))[0]
        cx = (cols.min() + cols.max()) / 2 + float(cara.get('dx', 0))
        lado = int(cara.get('lado', 46))
        y0 = top - int(cara.get('arriba', 3))
        cara = [int(round(cx - lado / 2)), y0, int(round(cx + lado / 2)), y0 + lado]
    if cara:
        x0, y0, x1, y1 = cara
        lado = max(x1 - x0, y1 - y0)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        # caja cuadrada centrada en la que se pidió, rellenada con transparente fuera del cuadro
        bx0, by0 = int(round(cx - lado / 2)), int(round(cy - lado / 2))
        # crop fuera del cuadro rellena con transparente (sirve para dejar aire arriba del pelo)
        lienzo = img.crop((bx0, by0, bx0 + lado, by0 + lado))
        agrandar(lienzo, (256, 256)).save(os.path.join(salida, 'cara.webp'), 'WEBP', quality=90, method=6)
    if revision:
        fondo = Image.new('RGBA', (ret.width + 280, max(ret.height, 256)), (40, 44, 52, 255))
        fondo.alpha_composite(ret, (0, 0))
        if cara:
            fondo.alpha_composite(Image.open(os.path.join(salida, 'cara.webp')).convert('RGBA'), (ret.width + 20, 0))
        fondo.convert('RGB').save(os.path.join(revision, 'retrato_y_cara.png'))
    print('retrato y cara listos')


# ─── Lámina de control ─────────────────────────────────────────────────────────────────────────

def lamina(resultados, efectos, ref, carpeta, nombre_personaje):
    """Todos los cuadros de todas las animaciones a la escala del atlas, sobre la misma línea de piso."""
    filas = []
    for nombre in CLAVES:
        if nombre in resultados:
            filas.append((nombre, resultados[nombre]))
    alto_fila = int(max(max(c['ay'] for c in l) for _, l in filas if l) + 26)
    sep = 6
    anchos = [sum(int(max(c['img'].width, 2 * max(c['ax'], c['img'].width - c['ax']))) + sep for c in l) + 110
              for _, l in filas]
    W = max(anchos) + 20
    H = alto_fila * len(filas) + 40
    lienzo = Image.new('RGBA', (W, H), (52, 56, 64, 255))
    d = ImageDraw.Draw(lienzo)
    d.text((8, 6), f'{nombre_personaje}: todos los cuadros a escala de atlas (línea verde = piso, celeste = alto de quieto)',
           fill=(255, 255, 255, 255))
    for k, (nombre, l) in enumerate(filas):
        base = 30 + (k + 1) * alto_fila - 12
        d.line([(0, base), (W, base)], fill=(0, 220, 0, 255))
        if ref:
            d.line([(110, base - ref), (W, base - ref)], fill=(0, 200, 255, 255))
        d.text((6, base - 20), nombre, fill=(255, 255, 0, 255))
        x = 110
        for i, c in enumerate(l):
            mitad = int(max(c['ax'], c['img'].width - c['ax']))
            cx = x + mitad
            lienzo.alpha_composite(c['img'], (int(cx - c['ax']), int(base - c['ay'])))
            d.line([(cx, base - 4), (cx, base + 4)], fill=(255, 0, 0, 255))
            d.text((cx - 3, base + 1), str(i), fill=(255, 255, 255, 255))
            x += max(c['img'].width, 2 * mitad) + sep
    lienzo.convert('RGB').save(os.path.join(carpeta, 'lamina.png'))
    if efectos:
        Wf = sum(c['img'].width + 20 for c in efectos.values()) + 20
        Hf = max(c['img'].height for c in efectos.values()) + 40
        lf = Image.new('RGBA', (Wf, Hf), (52, 56, 64, 255))
        df = ImageDraw.Draw(lf)
        x = 10
        for n, c in efectos.items():
            lf.alpha_composite(c['img'], (x, 30))
            df.text((x, 8), n, fill=(255, 255, 0, 255))
            x += c['img'].width + 20
        lf.convert('RGB').save(os.path.join(carpeta, 'lamina_efectos.png'))


# ─── Atlas ─────────────────────────────────────────────────────────────────────────────────────

def guardar_atlas(cfg, resultados, efectos, salida):
    unicos, indice = [], {}
    vistos = {}
    for nombre, lista in resultados.items():
        indice[nombre] = []
        for c in lista:
            k = id(c)
            if k not in vistos:
                vistos[k] = len(unicos)
                unicos.append(c)
            indice[nombre].append(vistos[k])
    ef_idx = {}
    for n, c in efectos.items():
        ef_idx[n] = len(unicos)
        unicos.append(c)
    ancho, alto, pos = ES.empaquetar(unicos)
    atlas = Image.new('RGBA', (max(1, ancho), max(1, alto)), (0, 0, 0, 0))
    for c, (x, y) in zip(unicos, pos):
        atlas.alpha_composite(c['img'], (x, y))
    # los píxeles transparentes van en negro: comprimen mejor y no cambian nada al dibujar
    a = np.asarray(atlas).copy()
    a[a[..., 3] == 0] = 0
    atlas = Image.fromarray(a)

    def cj(i):
        c, (x, y) = unicos[i], pos[i]
        return {'x': x, 'y': y, 'w': c['img'].width, 'h': c['img'].height, 'ax': c['ax'], 'ay': c['ay']}

    anims = {}
    for nombre in CLAVES:
        if nombre in resultados and resultados[nombre]:
            n = len(indice[nombre])
            imp = [int(k) for k in cfg['animaciones'][nombre].get('impactos', []) if 0 <= int(k) < n]
            anims[nombre] = {'cuadros': [cj(i) for i in indice[nombre]], 'impactos': imp}
    faltan = [k for k in CLAVES if k not in anims]
    if faltan:
        print('AVISO: faltan animaciones:', ', '.join(faltan), file=sys.stderr)
    efs = {n: {'cuadros': [cj(i)]} for n, i in ef_idx.items()}
    # PNG optimizado o WebP sin pérdida: el que pese menos (el render carga lo que diga el JSON)
    ruta_png = os.path.join(salida, 'atlas.png')
    ruta_webp = os.path.join(salida, 'atlas.webp')
    atlas.save(ruta_png, optimize=True)
    atlas.save(ruta_webp, 'WEBP', lossless=True, quality=100, method=6, exact=False)
    p, w_ = os.path.getsize(ruta_png), os.path.getsize(ruta_webp)
    if w_ < p:
        os.remove(ruta_png)
        imagen = 'atlas.webp'
    else:
        os.remove(ruta_webp)
        imagen = 'atlas.png'
    ref = anims['quieto']['cuadros'][0]['h'] if 'quieto' in anims else None
    datos = {'version': 1, 'personaje': cfg['personaje'], 'imagen': imagen, 'alturaReferencia': ref,
             'animaciones': anims, 'efectos': efs}
    with open(os.path.join(salida, 'atlas.json'), 'w') as f:
        json.dump(datos, f, separators=(',', ':'))
    print(f'atlas {ancho}x{alto} ({imagen}, {min(p, w_) / 1024:.0f} KB; png {p / 1024:.0f} KB, webp {w_ / 1024:.0f} KB), '
          f'{len(unicos)} cuadros → {salida}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--solo', default='')
    ap.add_argument('--revision', default='')
    ap.add_argument('--sin-atlas', action='store_true')
    ap.add_argument('--retrato', action='store_true')
    ap.add_argument('--detalle', default='', help='anim o anim:i separados por coma: cuadro_<anim>_<i>.png a 5x')
    args = ap.parse_args()
    DETALLE.update(s for s in args.detalle.split(',') if s)

    config = os.path.abspath(args.config)
    base = os.path.dirname(config)
    with open(config) as f:
        cfg = json.load(f)
    expandir_reglas(cfg)
    carpeta_cache = os.path.join(base, '.cache', cfg['personaje'])
    hoja = Hoja(ES.ruta(base, cfg['hoja']), carpeta_cache)
    salida = ES.ruta(base, cfg['salida'])
    os.makedirs(salida, exist_ok=True)
    rev = args.revision or None
    if rev:
        os.makedirs(rev, exist_ok=True)
    solo = [s for s in args.solo.split(',') if s]

    # Con --solo igual se extrae quieto (la altura de referencia), lo que esas animaciones toman
    # prestado con [otra, i] y la del retrato.
    necesarias = set(solo)
    if solo:
        necesarias.add('quieto')
        if args.retrato and cfg.get('retrato'):
            necesarias.add(cfg['retrato']['anim'])
            if isinstance(cfg['retrato'].get('cara'), dict) and cfg['retrato']['cara'].get('anim'):
                necesarias.add(cfg['retrato']['cara']['anim'])
        for s in solo:
            a = cfg['animaciones'].get(s) or {}
            if 'alias' in a:
                necesarias.add(a['alias'])
            for e in a.get('usar') or []:
                if isinstance(e, list):
                    necesarias.add(e[0])
            if a.get('injerto'):
                necesarias.add(a['injerto']['donante'][0])
    extraidos = {}
    for nombre, anim in cfg['animaciones'].items():
        if 'alias' in anim or not any(k in anim for k in ('cajas', 'region', 'cuadros')) or (solo and nombre not in necesarias):
            continue
        extraidos[nombre] = extraer_anim(hoja, nombre, anim, rev if (not solo or nombre in solo) else None, extraidos)
    resultados = {}
    for nombre, anim in cfg['animaciones'].items():
        if solo and nombre not in necesarias:
            continue
        resultados[nombre] = resolver_usar(nombre, anim, extraidos)
        print(f'{nombre}: {len(resultados[nombre])} cuadros')
    efectos = {}
    for nombre, ef in (cfg.get('efectos') or {}).items():
        if solo and nombre not in solo:
            continue
        c = extraer_efecto(hoja, nombre, ef, rev)
        if c:
            efectos[nombre] = c
        print(f'efecto {nombre}: {"listo" if c else "VACÍO"}')
    print(f'(inferencias nuevas del modelo: {hoja.inferencias})')

    ref = resultados['quieto'][0]['img'].height if resultados.get('quieto') else 0
    if rev:
        for nombre, lista in resultados.items():
            if not solo or nombre in solo:
                ES.tira_revision(nombre, lista, rev, ref)
        for nombre, c in efectos.items():
            ES.tira_revision('efecto_' + nombre, [c], rev, 0)
        if not solo:
            lamina(resultados, efectos, ref, rev, cfg['personaje'])
    if args.retrato and cfg.get('retrato'):
        procesar_retrato(hoja, cfg, resultados, salida, rev)
    if args.sin_atlas or solo:
        return
    guardar_atlas(cfg, resultados, efectos, salida)


if __name__ == '__main__':
    main()

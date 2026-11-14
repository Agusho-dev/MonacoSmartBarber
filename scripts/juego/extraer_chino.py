#!/usr/bin/env python3
"""
Recorte de Chino para «Corte Final» (cuarta tanda, 31/oct/2026) con el motor de extraer_gabriel.py (el de
las hojas de 18 paneles; ver su docstring de claves). Sin JSON usa scripts/juego/personajes/chino.json.
extraer_fran.py usa este mismo envoltorio (importa este módulo: las extensiones quedan puestas).

Lo que suma al motor (sin tocarlo: reemplaza funciones del módulo importado):
  - SIN_MODELO=1 hace fallar en vez de inferir (como en extraer_stefano.py): rehace el atlas sólo desde la
    caché de máscaras (scripts/juego/personajes/.cache/<id>/mascaras, fuera de git) y sale idéntico.
  - "pelarFondo" (por animación o por cuadro, {"i": {...}}): pela desde el borde de la máscara, de a un
    píxel por paso, el fondo que el modelo se tragó al lado de la ropa negra (los «bloques» oscuros entre
    las piernas o pegados a la espalda). Es fondo lo oscuro (lum <= "lumMax", 32), LISO (desvío 5x5 <=
    "stdMax", 3) y, si se pide, azulado ("bMenosRMin" sobre el promedio 3x3: el fondo de estas hojas tira a
    azul y la ropa no tanto). "pasos" (10) acota cuánto come; "zona" (forma) lo limita. Va DESPUÉS de toda
    la limpieza del motor; lo de "incluirFinal" se vuelve a sumar y queda la mancha principal.
    Una lista de objetos aplica varias pasadas (p. ej. una general y otra más fuerte en una zona).
    "bloques": N (opcional) saca además, estén donde estén, las manchas de ese mismo fondo de N px o más
    que quedaron encerradas (el fondo entre las piernas que no toca el borde de la máscara). Sólo para
    hojas cuya ropa no es negra lisa (Fran: jean gris y musculosa blanca); en la ropa negra de Chino
    se comería pliegues.
  - "limpiezasColor" (raíz del JSON): [{"zona": forma, regla de color, "dilatar"?: 1, "radio"?: 3}] reconstruye
    (cv2.inpaint) en la HOJA, antes de todo, los píxeles de esa regla dentro de la zona: los destellos pintados
    ENCIMA del cuerpo (los lentes que brillan, la chispa en la punta de los dedos), que no se pueden sacar con
    "quitarColor" (dejarían un agujero que el motor rellena con el mismo color). Como en extraer_stefano.py.
    Sólo se vuelven a inferir las máscaras de las regiones que tocan alguna zona.
  - "incluirLum" (por cuadro, quinta tanda): [{"zona", "lumMin" (40), "lumMax" (255), "suavizar" (3),
    "rellenar" (true), "quitar": [formas]}], después de todo lo anterior: devuelve lo que se despega del
    fondo casi negro por luminancia dentro de la zona y toca lo que ya está (como en extraer_lautaro.py).
    La pierna levantada de ko[0] de Fran: el modelo nunca la tomó.
  - "excluirUltimo" (por cuadro, quinta tanda): [formas] que se sacan al final, después de "incluirLum".
    Con extraer_lautaro.py cargado encima (extraer_nacho.py y extraer_nico_m.py encadenan los dos),
    "incluirLum" y "excluirUltimo" las aplica sólo él, al final de la cadena: acá no corren.
  - "quitarColorUltimo" (por cuadro, quinta tanda): [reglas de color] que se sacan al final, después de
    "excluirUltimo": lo que un "incluirFinal" a mano trajo de más (el brillo rojo de la carta alrededor
    de la mano y de la pierna en especial1[5] de Chino). Sin nombres de "reglas": van escritas.
  - "corteDonante" en el "injerto" (en cada cuadro o para todos): y de la HOJA en el cuadro donante donde
    empiezan sus piernas. El motor alinea por la cabeza ("cabeza"); con esto la fila "corte" del cuadro cae
    sobre esa fila del donante (se calcula "cabeza"), así se pueden cambiar sólo los pies: la burla de
    Chino tiene las zapatillas cortadas por el borde del panel y se le ponen las de victoria[1]. La escala
    del donante sale de su animación ("escalaPorCuadro" o "escala").

  cd MonacoSmartBarber && TURNO=ml <scratchpad>/herramientas/turno.sh nice -n 15 env OMP_NUM_THREADS=3 \\
      python3 scripts/juego/extraer_chino.py [--revision <carpeta>] [--retrato] [--solo a,b] [--detalle anim[:i],...]
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)
import extraer_gabriel as G  # noqa: E402
import extraer_sprites as ES  # noqa: E402

_inferir = G.Hoja._inferir
_limpiar_cuadro = G.limpiar_cuadro


def _inferir_o_fallar(self, region, modo, pintar=None):
    if os.environ.get('SIN_MODELO'):
        raise SystemExit(f'SIN_MODELO: falta en la caché la máscara {modo} de {list(region)}')
    return _inferir(self, region, modo, pintar)


def pelar_fondo(rgb, m, origen, lumMax=32, stdMax=3.0, pasos=10, bMenosRMin=None, zona=None, bloques=None, **_):
    """Saca del borde de m, de a un píxel por paso, lo oscuro y liso (y azulado, si se pide)."""
    a = rgb.astype(np.float32)
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    media = ndimage.uniform_filter(lum, 5)
    desvio = np.sqrt(np.maximum(ndimage.uniform_filter(lum * lum, 5) - media * media, 0))
    fondo = (lum <= float(lumMax)) & (desvio <= float(stdMax))
    if bMenosRMin is not None:
        fondo &= ndimage.uniform_filter(a[..., 2] - a[..., 0], 3) >= float(bMenosRMin)
    if zona is not None:
        fondo &= G.rasterizar([zona], origen, (rgb.shape[1], rgb.shape[0]))
    for _ in range(int(pasos)):
        borde = m & ~ndimage.binary_erosion(m, structure=np.ones((3, 3)), border_value=0)
        sacar = borde & fondo
        if not sacar.any():
            break
        m = m & ~sacar
    if bloques:
        et, n = ndimage.label(m & fondo)
        if n:
            areas = ndimage.sum(np.ones_like(et), et, range(1, n + 1))
            grandes = [k + 1 for k, a in enumerate(areas) if a >= int(bloques)]
            if grandes:
                m = m & ~np.isin(et, grandes)
    return m


def incluir_lum(rgb, m, origen, piezas):
    """Quinta tanda: devuelve lo que el modelo perdió y se despega del fondo casi negro por luminancia.
    Dentro de cada "zona", lo que (promediado en "suavizar" x "suavizar" px, 3) cae entre "lumMin" (40) y
    "lumMax" (255) y TOCA lo que ya está; con "rellenar" (true) se tapan los huecos que quedan adentro de
    la zona. Es lo mismo que "incluirLum" de extraer_lautaro.py (la pierna levantada del KO de Fran, que
    el modelo no tomó: jean gris y zapatilla blanca sobre el fondo casi negro)."""
    h, w = m.shape
    a = rgb.astype(np.float32)
    lum0 = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    for p in piezas or []:
        k = int(p.get('suavizar', 3))
        lum = ndimage.uniform_filter(lum0, size=k) if k > 1 else lum0
        zona = G.rasterizar([p['zona']], origen, (w, h))
        cand = zona & (lum >= float(p.get('lumMin', 40))) & (lum <= float(p.get('lumMax', 255)))
        if p.get('quitar'):
            cand &= ~G.rasterizar(p['quitar'], origen, (w, h))
        et, _ = ndimage.label(cand | m, structure=np.ones((3, 3)))
        ids = np.unique(et[m])
        m2 = m | (cand & np.isin(et, ids[ids > 0]))
        if p.get('rellenar', True):
            m2 |= ndimage.binary_fill_holes(m2) & zona
        m = m2
    return m


def limpiar_cuadro(hoja, anim, i, region, M, m):
    m = _limpiar_cuadro(hoja, anim, i, region, M, m)
    rx0, ry0, rx1, ry1 = region
    rgb = hoja.arr[ry0:ry1, rx0:rx1]
    pf = G.por_cuadro(anim, 'pelarFondo', i)
    if pf and m.any():
        for op in (pf if isinstance(pf, list) else [pf]):
            m = pelar_fondo(rgb, m, (rx0, ry0), **op)
        m = ES.limpiar(m, anim.get('componentes', 'principal'))
        inc2 = G.por_cuadro(anim, 'incluirFinal', i)
        if inc2:
            m = m | G.rasterizar(inc2, (rx0, ry0), (rx1 - rx0, ry1 - ry0))
    # Con extraer_lautaro.py cargado encima (los envoltorios que encadenan los dos: extraer_nacho.py y
    # extraer_nico_m.py), "incluirLum" y "excluirUltimo" son claves de ÉL y las aplica al final de la
    # cadena. Si se aplicaran también acá correrían dos veces, la primera antes de "fondoOscuro": el
    # atlas de Nico M. ya no salía igual al revisado (9 px de correr[1], quinta tanda, sprites-fix).
    encadenado = 'extraer_lautaro' in sys.modules
    il = None if encadenado else G.por_cuadro(anim, 'incluirLum', i)
    if il and m.any():
        m = incluir_lum(rgb, m, (rx0, ry0), il)
    exu = None if encadenado else G.por_cuadro(anim, 'excluirUltimo', i)
    if exu:
        # quinta tanda: formas que se sacan al FINAL, después de todo lo anterior (una sombra del piso
        # pegada a la suela que "pelarFondo" no alcanza y "excluir" no puede sacar porque vuelve)
        m = m & ~G.rasterizar(exu, (rx0, ry0), (rx1 - rx0, ry1 - ry0))
    qcu = G.por_cuadro(anim, 'quitarColorUltimo', i)
    for r in qcu or []:
        # quinta tanda: reglas de color que se sacan al FINAL (lo que un "incluirFinal" a mano trajo de
        # más: el brillo rojo oscuro de la carta alrededor de la mano abierta de Chino)
        m = m & ~G.condicion_color(rgb, r, (rx0, ry0))
    return m


_estado = {'cfg': None}
_expandir_reglas = G.expandir_reglas
_hoja_init = G.Hoja.__init__
_alfa = G.Hoja.alfa


def expandir_reglas(cfg):
    _estado['cfg'] = cfg
    return _expandir_reglas(cfg)


def hoja_init(self, ruta, carpeta_cache):
    """La hoja con los "limpiezasColor" del JSON ya reconstruidos (cv2.inpaint)."""
    _hoja_init(self, ruta, carpeta_cache)
    self.limpiezas = list((_estado['cfg'] or {}).get('limpiezasColor') or [])
    if not self.limpiezas:
        return
    import cv2
    a = np.ascontiguousarray(self.arr.copy())
    for r in self.limpiezas:
        zona = G.rasterizar([r['zona']], (0, 0), (a.shape[1], a.shape[0]))
        m = zona & G.condicion_color(a, r, (0, 0))
        if int(r.get('dilatar', 1)) > 0:
            m = ndimage.binary_dilation(m, iterations=int(r.get('dilatar', 1))) & zona
        if m.any():
            a = cv2.inpaint(a, m.astype(np.uint8) * 255, int(r.get('radio', 3)), cv2.INPAINT_TELEA)
    self.arr = a
    self.img = Image.fromarray(a)


def alfa(self, region, modo='panel', pintar=None):
    """Las máscaras de las regiones que tocan una limpieza llevan su marca en la clave de la caché."""
    x0, y0, x1, y1 = (int(v) for v in region)
    tocan = []
    for r in getattr(self, 'limpiezas', []):
        zx0, zy0, zx1, zy1 = G.caja_de_formas([r['zona']])
        if zx0 < x1 and zx1 > x0 and zy0 < y1 and zy1 > y0:
            tocan.append(r)
    if not tocan:
        return _alfa(self, region, modo, pintar)
    firma = self.firma
    self.firma = firma + '_l' + hashlib.sha1(json.dumps(tocan, sort_keys=True).encode()).hexdigest()[:8]
    try:
        return _alfa(self, region, modo, pintar)
    finally:
        self.firma = firma


_injertar = G.injertar


def injertar(c, inj, opc, extraidos):
    """El injerto del motor; con "corteDonante" (y de la hoja en el donante) calcula "cabeza" para que la
    fila "corte" del cuadro quede sobre esa fila del donante."""
    yd = opc.get('corteDonante', inj.get('corteDonante'))
    don = (extraidos.get(inj['donante'][0]) or [None] * 99)[int(inj['donante'][1])]
    if yd is not None and don is not None:
        a = ((_estado['cfg'] or {}).get('animaciones') or {}).get(inj['donante'][0]) or {}
        s_don = float((a.get('escalaPorCuadro') or {}).get(str(inj['donante'][1]), a.get('escala', 1.0)))
        s = float(opc.get('escala', inj.get('escala', 1.0)))
        fila = (float(yd) - don['origen'][1]) * s_don
        opc = dict(opc, cabeza=float(opc['corte']) - fila / s)
    return _injertar(c, inj, opc, extraidos)


G.Hoja._inferir = _inferir_o_fallar
G.Hoja.__init__ = hoja_init
G.Hoja.alfa = alfa
G.expandir_reglas = expandir_reglas
G.limpiar_cuadro = limpiar_cuadro
G.injertar = injertar

if __name__ == '__main__':
    if len(sys.argv) < 2 or not sys.argv[1].endswith('.json'):
        sys.argv.insert(1, os.path.join(_AQUI, 'personajes', 'chino.json'))
    G.main()

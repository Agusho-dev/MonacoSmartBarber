#!/usr/bin/env python3
"""
Recorte de las hojas «de foto» de la cuarta tanda de «Corte Final» (31/oct/2026): Lautaro y Leo.

Es un envoltorio del motor de extraer_gabriel.py (el de las hojas de 18 paneles; ver su docstring:
claves del JSON, --revision, --detalle, --retrato), que se importa SIN tocarlo; extraer_leo.py es un
atajo que llama a este con su JSON. Sin JSON usa scripts/juego/personajes/lautaro.json.

  cd MonacoSmartBarber && TURNO=ml <scratchpad>/herramientas/turno.sh nice -n 15 env OMP_NUM_THREADS=3 \\
      python3 scripts/juego/extraer_lautaro.py [<json>] [--revision <carpeta>] [--retrato] \\
      [--solo a,b] [--detalle anim[:i],...]

Las hojas de esta tanda son fotos realistas sobre un fondo casi negro: isnet separa bien la ropa clara,
pero la inferencia «ancho» se traga los huecos de fondo encerrados entre el brazo y el cuerpo o detrás
de la espalda (manchas negras pegadas al cuerpo), «caja» y «panel» a veces pierden la remera azul
oscuro, y en los primeros planos de Leo las piernas quedan cortadas por el borde del panel. Lo que
este envoltorio le suma al motor:

  - SIN_MODELO=1: falla en vez de inferir. Las máscaras de isnet quedan en
    scripts/juego/personajes/.cache/<id>/mascaras (ignorado por git); con la caché completa el atlas
    se rehace en segundos y sale idéntico byte a byte.
  - "fondoOscuro" (por animación o por cuadro {"i": {...}}), DESPUÉS de la limpieza del motor: saca
    las manchas de fondo negro que el modelo dejó adentro de la máscara. Una mancha es lo que, medido
    sobre el promedio de "suavizar" x "suavizar" px (3), no pasa de "lumMax" de luminancia (24) y
    tiene al menos "areaMin" px (40); el borde suavizado del cuerpo no llega a negro y queda. No se
    toca lo que caiga en "proteger" (formas en px de la hoja) ni la cabeza: "cabeza": {"alto": 16,
    "ancho": 28} protege un rectángulo de ese tamaño arriba de la máscara, centrado en lo que asoma
    en sus 3 primeras filas ("filas"), o en "x" y desde "y" (px de la hoja) si se dan (el pelo negro
    es tan oscuro como el fondo); "cabeza": false lo apaga. "zona": forma limita dónde se buscan
    las manchas. "abrir": px (0) achica antes lo oscuro (separa una mancha de fondo de la ropa
    oscura por un cuello angosto). "lisoMax": desvío (opcional) exige además que lo oscuro sea liso
    (el desvío local de la luminancia no pasa de ese valor): el fondo es un degradé sin textura y la
    ropa negra de Leo tiene pliegues, costuras y roturas (por luminancia sola se iría el jean).
    Con "crecer": px, cada mancha crece hasta esa distancia por lo oscuro con desvío de hasta
    "lisoCrecer" (2 x lisoMax): el borde del parche de fondo es más ruidoso que su centro.
    Después pela "pelar" px (2) del contorno que, sin suavizar, no pasa de "lumBorde" (30): el filo
    negro de fondo pegado a la ropa clara (fuera de "proteger"; con ropa negra, "pelar": 0).
  - "pelarColor": {"reglas": [regla de color del motor, ...], "pasos": 2} (por animación o por cuadro),
    después de "fondoOscuro": pela del contorno lo que cumple alguna regla (el filo azul que el aura
    del gigante le deja a la ropa y al pelo).
  - "piernas" (por cuadro {"i": [pieza, ...]}): completa un cuadro cortado por el borde de abajo del
    panel (los primeros planos de Leo) pegando, DEBAJO del cuadro, pedazos de pierna de otro cuadro
    ya extraído. Una pieza: {"de": [anim, i] (índice de cuadro extraído, antes de "usar"),
    "forma": forma en px de la hoja del donante (sólo lo de la máscara del donante adentro),
    "desde": [x, y] px de la hoja del donante, "hasta": [x, y] px de la hoja del cuadro,
    "escala": f (agranda la pieza respecto del donante; 1), "espejo": bool}. El punto "desde" de la
    pieza cae en "hasta"; el cuadro se dibuja encima (el ruedo del jean tapa la unión). El apoyo Y
    queda en el pie más bajo; el X no cambia ("apoyoX" sigue andando). Se aplica antes de "escala":
    la pieza se mide en px de la hoja. Con --solo, las donantes se suman solas a la lista.
    Quinta tanda: la donante puede ser otro cuadro de la MISMA animación (la zapatilla derecha del
    gigante de Lautaro en especial1[4] sale de especial1[5]; la pieza se toma de su máscara cruda).
  - "abrirZona": {"zona": forma, "radio": 1} (por cuadro): dentro de la zona, una apertura
    morfológica; se van las líneas finas que quedan de algo que se sacó por color (el contorno
    iluminado del rival) y queda lo que tiene cuerpo.
    "fondoOscuro" también acepta una LISTA de pasadas (por cuadro: [la general, {"zona": ..., ...}]):
    una pasada con "zona" (lumMax 32-40, "suavizar": 1, "pelar": 0, "cabeza": false) saca el fondo
    encerrado entre un brazo y la remera, la estela pegada a un puño o el bloque al lado del pelo, y
    lo que saca no vuelve con el relleno de huecos de menos de 40 px de ES.limpiar.
  - "incluirUltimo": [formas] (por cuadro): se agregan tal cual al FINAL, después de "fondoOscuro",
    "pelarColor" y "abrirZona" (un brillo del pelo o un rayo blanco que cruzaba el muslo y que la
    limpieza por color dejó como agujero).
  - "incluirLum": [{"zona", "lumMin" (16), "lumMax" (255), "suavizar" (3), "rellenar" (true),
    "quitar": [formas], "sinColor": [reglas]}] (por cuadro), después de "incluirUltimo": devuelve lo
    que se despega del fondo casi negro por luminancia dentro de la zona y toca lo que ya está (el
    puño pegado al destello, la tijera y la máquina en la mano de Leo, el antebrazo que baja en el
    gigante). Con "rellenar" tapa los huecos que quedan adentro de la zona (para una herramienta
    fina, "rellenar": false).
  - "excluirUltimo": [formas] (por cuadro): se sacan al final, después de "incluirLum" (el destello
    delante del puño, la mano movida del dibujo, el puente de una estela).
  - "rellenarUltimo": n (por cuadro): tapa los huecos encerrados de menos de n px después de toda la
    limpieza (los que dejan en la remera o en el jean las limpiezas por color del gigante).
  - "desaturar": [reglas de color del motor] (por animación o por cuadro): pasa a gris, con la misma
    luminancia, lo que las cumpla adentro del cuadro (el pelo del gigante teñido por la barra
    violeta del título). Admite nombres de "reglas".
  - "piso": px (por cuadro): el apoyo Y se fija en esa fila de la hoja (un cuadro cortado por el
    borde del panel cuyos pies se completaron con "piernas" queda con el apoyo donde se dibujó el
    piso); sin "piso", el apoyo es el pie más bajo, como en el motor.

Lo propio de la hoja de Lautaro (lautaro_anim.jpg, 1600x900, la plantilla de 18 paneles; el detalle,
en el "_nota" de cada animación de lautaro.json):
  - Todas las filas están a la escala de «quieto» (cabeza y alto de pie medidos): no hay "escala".
  - El ESPECIAL 1 (GIGANTE) crece a propósito: sus cuadros conservan el tamaño relativo de la hoja
    (de pie, 0,98 del alto de «quieto»; el gigante, 1,46-1,48) y van con los pies en la línea. Las
    cabezas del gigante se meten en la barra violeta del título: se pinta antes de inferir
    («barraE1»), se resta por color y el pelo teñido se pasa a gris («desaturar»). El aura azul
    sale por color («aura») y su filo con «pelarColor»; el pisotón (7) es un contorno a mano.
  - El rival (ropa negra) del ESPECIAL 2 sale por color («rival») y con «abrirZona»; desde el cuadro
    2 el borde del panel le corta los pies: «piernas» con las zapatillas de quieto[0].
  - El DASH de la hoja es la carrera envuelta en humo y estelas: se prestan los cuadros de «correr».

Lo propio de la hoja de Leo (leo_anim.jpg, 1536x1024; ver leo.json):
  - Remera clara y jean NEGRO sobre un fondo casi del mismo negro: los parches de fondo que el modelo
    se traga salen con «fondoOscuro» con "lisoMax" + "crecer" (lo oscuro y liso; el jean tiene
    textura) y "pelar": 0 (pelar lo oscuro del borde se comería el jean).
  - Filas dibujadas a otra escala (medidas con la cabeza y el alto de pie): golpes 0,92, abajo
    (daño, KO, levantarse, victoria) 0,91, ESPECIAL 1 0,82 y ESPECIAL 2 0,725. En los dos especiales
    el borde del panel corta el pie de adelante: «piernas» con la zapatilla derecha de guardia[0].
  - Pega con herramientas: GOLPE BÁSICO 1 (TIJERA) va en «golpe» y GOLPE BÁSICO 2 (MÁQUINA) en
    «patada»; herramienta1 (el botón MÁQUINA) es alias de la máquina y herramienta2 de la tijera.
  - Las herramientas que vuelan y la lata son efectos del atlas: «secador», «tijera», «aerosol».
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)
import extraer_gabriel as G  # noqa: E402

ES = G.ES
_isnet = ES.mascara_isnet


def _isnet_sin_modelo(img_rgb, cuadrar=False):
    if os.environ.get('SIN_MODELO'):
        raise SystemExit(f'SIN_MODELO: falta una máscara en la caché ({img_rgb.size}, cuadrar={cuadrar})')
    return _isnet(img_rgb, cuadrar)


ES.mascara_isnet = _isnet_sin_modelo


# ─── fondoOscuro ───────────────────────────────────────────────────────────────────────────────

def _caja_cabeza(m, op, origen):
    """Rectángulo (local) de la cabeza: arriba de la máscara, centrado en lo que asoma en sus
    primeras "filas" (3: así un pie o un puño que llega casi tan alto no corre la caja) o en "x"
    (px de la hoja) y desde "y" (px de la hoja) si se dan."""
    ys, xs = np.nonzero(m)
    if not len(ys):
        return None
    top = int(ys.min()) if op.get('y') is None else int(op['y']) - origen[1]
    if op.get('x') is not None:
        cx = float(op['x']) - origen[0]
    else:
        filas = int(op.get('filas', 3))
        cols = np.nonzero(m[top:top + filas].any(axis=0))[0]
        cx = (cols.min() + cols.max()) / 2.0
    ancho, alto = int(op.get('ancho', 28)), int(op.get('alto', 16))
    return int(round(cx - ancho / 2)), max(0, top - 2), int(round(cx + ancho / 2)), top + alto


def fondo_oscuro(hoja, region, m, op):
    rx0, ry0, rx1, ry1 = region
    tam = (rx1 - rx0, ry1 - ry0)
    rgb = hoja.arr[ry0:ry1, rx0:rx1].astype(np.float32)
    lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    k = int(op.get('suavizar', 3))
    if k > 1:
        lum = ndimage.uniform_filter(lum, size=k)
    oscuro = (lum <= float(op.get('lumMax', 24))) & m
    desvio = None
    if op.get('lisoMax') is not None:
        # sólo lo oscuro y LISO (desvío local en "suavizar"+2 px por debajo de "lisoMax"): el fondo
        # de la hoja es un degradé sin textura; la ropa negra tiene pliegues, costuras y roturas
        k2 = max(3, k + 2)
        lum0_ = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
        media = ndimage.uniform_filter(lum0_, size=k2)
        desvio = np.sqrt(np.maximum(ndimage.uniform_filter(lum0_ ** 2, size=k2) - media ** 2, 0))
        oscuro_todo = oscuro.copy()
        oscuro &= desvio <= float(op['lisoMax'])
    if op.get('zona'):
        oscuro &= G.rasterizar([op['zona']], (rx0, ry0), tam)
    if op.get('proteger'):
        oscuro &= ~G.rasterizar(op['proteger'], (rx0, ry0), tam)
    cab = op.get('cabeza', {})
    if cab is not False:
        c = _caja_cabeza(m, cab if isinstance(cab, dict) else {}, (rx0, ry0))
        if c:
            x0, y0, x1, y1 = c
            oscuro[max(0, y0):y1, max(0, x0):x1] = False
    ab = int(op.get('abrir', 0))
    if ab > 0:
        oscuro = ndimage.binary_opening(oscuro, iterations=ab)
    et, n = ndimage.label(oscuro, structure=np.ones((3, 3)))
    if n:
        areas = ndimage.sum(oscuro, et, range(1, n + 1))
        sacar = np.isin(et, [i + 1 for i, a in enumerate(areas) if a >= int(op.get('areaMin', 40))])
        if desvio is not None and int(op.get('crecer', 0)) > 0:
            # cada mancha lisa crece hasta "crecer" px por lo oscuro con un desvío de hasta
            # "lisoCrecer" (el borde del parche de fondo, más ruidoso, sin entrar al jean)
            apto = oscuro_todo & (desvio <= float(op.get('lisoCrecer', 2 * float(op['lisoMax']))))
            if op.get('proteger'):
                apto &= ~G.rasterizar(op['proteger'], (rx0, ry0), tam)
            sacar = ndimage.binary_dilation(sacar, iterations=int(op['crecer']), mask=apto | sacar)
        m = m & ~sacar
    # el borde negro que queda pegado al contorno (el fondo que el modelo agarró al costado de la
    # ropa clara): se pela "pelar" px de lo que, sin suavizar, no pasa de "lumBorde"
    lum0 = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    borde_oscuro = lum0 <= float(op.get('lumBorde', 30))
    if op.get('proteger'):
        borde_oscuro &= ~G.rasterizar(op['proteger'], (rx0, ry0), tam)
    for _ in range(int(op.get('pelar', 2))):
        borde = m & ~ndimage.binary_erosion(m)
        m = m & ~(borde & borde_oscuro)
    return m


def pelar_color(hoja, region, m, op):
    """Pela del contorno, "pasos" veces, los píxeles que cumplen alguna de las "reglas" de color
    (las del motor): el filo teñido por un aura o un brillo pegado al cuerpo."""
    rx0, ry0, rx1, ry1 = region
    rgb = hoja.arr[ry0:ry1, rx0:rx1]
    c = np.zeros(m.shape, bool)
    for r in op.get('reglas') or []:
        c |= G.condicion_color(rgb, r, (rx0, ry0))
    for _ in range(int(op.get('pasos', 2))):
        borde = m & ~ndimage.binary_erosion(m)
        m = m & ~(borde & c)
    return m


_expandir_original = G.expandir_reglas


def expandir_reglas(cfg):
    """Como el del motor, y además los nombres de juegos de reglas dentro de "pelarColor"."""
    _expandir_original(cfg)
    juegos = cfg.get('reglas') or {}

    def exp(v):
        if isinstance(v, str):
            return list(juegos[v])
        out = []
        for x in v or []:
            out += list(juegos[x]) if isinstance(x, str) else [x]
        return out

    for anim in (cfg.get('animaciones') or {}).values():
        de = anim.get('desaturar')
        if isinstance(de, dict) and de and all(str(k).isdigit() for k in de):
            anim['desaturar'] = {k: exp(v) for k, v in de.items()}
        elif de:
            anim['desaturar'] = exp(de)
        pc = anim.get('pelarColor')
        if isinstance(pc, dict) and pc and all(str(k).isdigit() for k in pc):
            for v in pc.values():
                if isinstance(v, dict) and 'reglas' in v:
                    v['reglas'] = exp(v['reglas'])
        elif isinstance(pc, dict) and 'reglas' in pc:
            pc['reglas'] = exp(pc['reglas'])


G.expandir_reglas = expandir_reglas

_limpiar_original = G.limpiar_cuadro


def incluir_lum(hoja, region, m, piezas):
    """Devuelve lo que el modelo perdió y se despega del fondo casi negro por luminancia: dentro de
    cada "zona", lo que (promediado en "suavizar" x "suavizar" px, 3) cae entre "lumMin" y "lumMax"
    (255) y toca lo que ya está; con "rellenar" (true por defecto) se tapan los huecos que quedan
    adentro de la zona; "quitar" (formas) y "sinColor" (reglas de color del motor) dejan afuera lo que no
    es cuerpo. Es el pelo negro de una cabeza acostada (el fondo de la hoja de Lautaro
    mide 8-14 y el pelo 15-60), el puño pegado al destello o la herramienta en la mano de Leo."""
    rx0, ry0, rx1, ry1 = region
    tam = (rx1 - rx0, ry1 - ry0)
    rgb = hoja.arr[ry0:ry1, rx0:rx1].astype(np.float32)
    lum0 = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    for p in piezas or []:
        k = int(p.get('suavizar', 3))
        lum = ndimage.uniform_filter(lum0, size=k) if k > 1 else lum0
        zona = G.rasterizar([p['zona']], (rx0, ry0), tam)
        cand = zona & (lum >= float(p.get('lumMin', 16))) & (lum <= float(p.get('lumMax', 255)))
        if p.get('quitar'):
            cand &= ~G.rasterizar(p['quitar'], (rx0, ry0), tam)
        for r in p.get('sinColor') or []:
            # lo que cumple una regla de color del motor no entra (el aura celeste pegada al brazo)
            cand &= ~G.condicion_color(hoja.arr[ry0:ry1, rx0:rx1], r, (rx0, ry0))
        et, n = ndimage.label(cand | m, structure=np.ones((3, 3)))
        ids = np.unique(et[m])
        ids = ids[ids > 0]
        nuevo = cand & np.isin(et, ids)
        m2 = m | nuevo
        if p.get('rellenar', True):
            m2 |= ndimage.binary_fill_holes(m2) & zona
        m = m2
    return m


def rellenar_ultimo(m, n):
    """Tapa los huecos encerrados de menos de n px (después de toda la limpieza del envoltorio)."""
    huecos = ndimage.binary_fill_holes(m) & ~m
    et, k = ndimage.label(huecos)
    if k:
        areas = ndimage.sum(huecos, et, range(1, k + 1))
        m = m | np.isin(et, [j + 1 for j, a in enumerate(areas) if a < int(n)])
    return m


def limpiar_cuadro(hoja, anim, i, region, M, m):
    m = _limpiar_original(hoja, anim, i, region, M, m)
    op = G.por_cuadro(anim, 'fondoOscuro', i)
    # una lista de pasadas: la general y otra más fuerte en una zona (lo oscuro pegado a un puño).
    # Lo que saca una pasada CON "zona" queda afuera también después de ES.limpiar, que si no tapa
    # de nuevo los huecos de menos de 40 px (el fondo encerrado entre el brazo y la remera)
    forzar = np.zeros(m.shape, bool)
    for o in (op if isinstance(op, list) else [op] if op else []):
        m2 = fondo_oscuro(hoja, region, m, o)
        if o.get('zona'):
            forzar |= m & ~m2
        m = m2
    pc = G.por_cuadro(anim, 'pelarColor', i)
    if pc:
        m = pelar_color(hoja, region, m, pc)
    ab = G.por_cuadro(anim, 'abrirZona', i)
    if ab:
        # dentro de la zona, una apertura de "radio" px: se van las líneas finas (el contorno
        # iluminado del rival que se sacó por color) y queda lo que tiene cuerpo
        rx0, ry0, rx1, ry1 = region
        z = G.rasterizar([ab['zona']], (rx0, ry0), (rx1 - rx0, ry1 - ry0))
        r = int(ab.get('radio', 1))
        abierto = ndimage.binary_opening(m, structure=np.ones((2 * r + 1, 2 * r + 1)))
        m = np.where(z, abierto, m)
    if op or pc or ab:
        m = ES.limpiar(m, anim.get('componentes', 'principal')) & ~forzar
    inc = G.por_cuadro(anim, 'incluirUltimo', i)
    if inc:
        rx0, ry0, rx1, ry1 = region
        m = m | G.rasterizar(inc, (rx0, ry0), (rx1 - rx0, ry1 - ry0))
    il = G.por_cuadro(anim, 'incluirLum', i)
    if il:
        m = incluir_lum(hoja, region, m, il)
    exu = G.por_cuadro(anim, 'excluirUltimo', i)
    if exu:
        rx0, ry0, rx1, ry1 = region
        m = m & ~G.rasterizar(exu, (rx0, ry0), (rx1 - rx0, ry1 - ry0))
    ru = G.por_cuadro(anim, 'rellenarUltimo', i)
    if ru:
        m = rellenar_ultimo(m, ru)
    if il or exu:
        m = ES.limpiar(m, anim.get('componentes', 'principal')) & ~forzar
    return m


G.limpiar_cuadro = limpiar_cuadro


# ─── piernas (completar un primer plano cortado por el borde del panel) ─────────────────────────

_EXTRAIDOS = {}
_extraer_anim_original = G.extraer_anim


def _pieza(hoja, donante, p):
    """La pieza de pierna del donante (RGBA, en px de la hoja) y su origen en la hoja. El donante
    puede estar espejado o escalado: se trabaja con su máscara cruda sobre la hoja."""
    mascara = donante.get('mascara')
    rx0, ry0, rx1, ry1 = donante['region']
    forma = G.rasterizar([p['forma']], (rx0, ry0), (rx1 - rx0, ry1 - ry0))
    sel = mascara & forma
    ys, xs = np.nonzero(sel)
    if not len(xs):
        return None, None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb = hoja.arr[ry0 + y0:ry0 + y1, rx0 + x0:rx0 + x1]
    alfa = (sel[y0:y1, x0:x1] * 255).astype(np.uint8)
    img = Image.fromarray(np.dstack([rgb, alfa]), 'RGBA')
    return img, (rx0 + x0, ry0 + y0)


def completar_piernas(hoja, c, piezas, extraidos, piso=None):
    """Pega las piezas DEBAJO del cuadro (sin escalar todavía) y recalcula el apoyo Y."""
    im = c['img']
    ox, oy = c['origen']
    capas = []
    for p in piezas:
        don = (extraidos.get(p['de'][0]) or [None] * 99)[int(p['de'][1])]
        if don is None:
            print('  AVISO piernas: no está el donante', p['de'], file=sys.stderr)
            continue
        pz, (px, py) = _pieza(hoja, don, p)
        if pz is None:
            print('  AVISO piernas: la forma no toca al donante', p['de'], file=sys.stderr)
            continue
        s = float(p.get('escala', 1.0))
        dx0, dy0 = float(p['desde'][0]) - px, float(p['desde'][1]) - py
        if abs(s - 1) > 1e-6:
            pz = pz.convert('RGBa').resize((max(1, round(pz.width * s)), max(1, round(pz.height * s))),
                                           Image.LANCZOS).convert('RGBA')
            a = np.asarray(pz).copy()
            a[..., 3] = np.where(a[..., 3] >= 110, 255, 0).astype(np.uint8)
            pz = Image.fromarray(a)
            dx0, dy0 = dx0 * s, dy0 * s
        if p.get('espejo'):
            pz = pz.transpose(Image.FLIP_LEFT_RIGHT)
            dx0 = pz.width - dx0
        # posición de la pieza en px de la hoja del cuadro
        capas.append((pz, float(p['hasta'][0]) - dx0, float(p['hasta'][1]) - dy0))
    if not capas:
        return c
    x0 = min([ox] + [int(np.floor(x)) for _, x, _ in capas])
    y0 = min([oy] + [int(np.floor(y)) for _, _, y in capas])
    x1 = max([ox + im.width] + [int(np.ceil(x)) + pz.width for pz, x, _ in capas])
    y1 = max([oy + im.height] + [int(np.ceil(y)) + pz.height for pz, _, y in capas])
    lienzo = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for pz, x, y in capas:
        lienzo.alpha_composite(pz, (int(round(x)) - x0, int(round(y)) - y0))
    lienzo.alpha_composite(im, (ox - x0, oy - y0))
    a = np.asarray(lienzo).copy()
    a[..., 3] = np.where(a[..., 3] >= 110, 255, 0).astype(np.uint8)
    out = dict(c)
    out['img'] = Image.fromarray(a)
    out['origen'] = [x0, y0]
    out['ax'] = round(float(c['ax']) + (ox - x0), 1)
    filas = np.nonzero((a[..., 3] > 0).any(axis=1))[0]
    out['ay'] = round(float(piso - y0) if piso is not None else float(filas.max() + 1), 1)
    return out


def desaturar(c, reglas):
    """Pasa a gris (misma luminancia) los píxeles del cuadro (sin escalar) que cumplen alguna regla
    de color: el pelo teñido de violeta por la barra del título, sin tocar la silueta."""
    a = np.asarray(c['img']).copy()
    rgb = a[..., :3]
    sel = np.zeros(a.shape[:2], bool)
    for r in reglas:
        sel |= G.condicion_color(rgb, r, tuple(c['origen']))
    sel &= a[..., 3] > 0
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.float32)
    gris = np.clip(np.stack([lum * 1.04, lum, lum * 0.96], axis=-1) + 0.5, 0, 255).astype(np.uint8)
    a[..., :3] = np.where(sel[..., None], gris, rgb)
    out = dict(c)
    out['img'] = Image.fromarray(a, 'RGBA')
    return out


def extraer_anim(hoja, nombre, anim, revision=None, extraidos=None):
    """El extractor del motor, más "piernas", "piso" y "desaturar" antes de escalar el cuadro. Para
    no duplicar la escala del motor, se extrae con escala 1, se completa y recién después se escala."""
    if extraidos is not None:
        _EXTRAIDOS.update(extraidos)
    piernas = anim.get('piernas') or {}
    pisos = anim.get('piso') or {}
    desat = anim.get('desaturar') or {}
    if not piernas and not pisos and not desat:
        out = _extraer_anim_original(hoja, nombre, anim, revision, extraidos)
        _EXTRAIDOS[nombre] = out
        return out
    sin_escala = dict(anim)
    sin_escala.pop('escala', None)
    sin_escala.pop('escalaPorCuadro', None)
    crudos = _extraer_anim_original(hoja, nombre, sin_escala, revision, extraidos)
    out = []
    for i, c in enumerate(crudos):
        if c is None:
            out.append(None)
            continue
        piso = pisos.get(str(i)) if isinstance(pisos, dict) else pisos
        if str(i) in piernas or piso is not None:
            # quinta tanda: también los cuadros crudos de esta misma animación pueden ser donantes
            donantes = {**_EXTRAIDOS, **(extraidos or {}), nombre: crudos}
            c = completar_piernas(hoja, c, piernas.get(str(i)) or [], donantes, piso)
        reglas = G.por_cuadro(anim, 'desaturar', i)
        if reglas:
            c = desaturar(c, reglas)
        s = float((anim.get('escalaPorCuadro') or {}).get(str(i), anim.get('escala', 1.0)))
        out.append(G.escalar_cuadro(c, s))
    _EXTRAIDOS[nombre] = out
    return out


G.extraer_anim = extraer_anim


def _sumar_donantes_a_solo():
    """Con --solo, el motor sólo extrae lo que esas animaciones piden con "usar", "alias" o
    "injerto": se le suman las animaciones donantes de "piernas" (si no, el injerto no sale)."""
    import json
    if '--solo' not in sys.argv:
        return
    k = sys.argv.index('--solo') + 1
    if k >= len(sys.argv):
        return
    with open(sys.argv[1]) as f:
        cfg = json.load(f)
    solo = [x for x in sys.argv[k].split(',') if x]
    for nombre in list(solo):
        for piezas in ((cfg['animaciones'].get(nombre) or {}).get('piernas') or {}).values():
            for pz in piezas:
                if pz['de'][0] not in solo:
                    solo.append(pz['de'][0])
    sys.argv[k] = ','.join(solo)


def main():
    if len(sys.argv) < 2 or not sys.argv[1].endswith('.json'):
        sys.argv.insert(1, os.path.join(_AQUI, 'personajes', 'lautaro.json'))
    _sumar_donantes_a_solo()
    G.main()


if __name__ == '__main__':
    main()

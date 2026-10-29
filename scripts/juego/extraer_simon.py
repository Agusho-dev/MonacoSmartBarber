#!/usr/bin/env python3
"""
Envoltorio de scripts/juego/extraer_sprites.py para la hoja de Simón (agente sprites-simon).

La herramienta compartida NO se toca: este script la importa, le suma las opciones que la hoja
de Simón necesita y corre su main() con los mismos argumentos:

  cd MonacoSmartBarber && OMP_NUM_THREADS=3 python3 <este script> \
      scripts/juego/personajes/simon.json [--solo a,b] [--revision carpeta] [--retrato]

Opciones extra en simon.json (la herramienta base las ignora; este envoltorio las aplica):

  por animación (o por cuadro, dentro de porCuadro)
    escala      factor para sus cuadros. La fila de abajo de la hoja (levantarse, victoria,
                burla) está dibujada ~1,19x más grande que el resto: van con 0.84 para que
                Simón no "crezca" al festejar. El pique que se tomó prestado del dash para
                especial1 va con 1.07 (el dash está dibujado un poco más chico).

  por efecto (modo "luz")
    fondos           [{"caja": [...], "color": [r,g,b]}]: fondo explícito por zona (la barra de
                     título verde azulada del panel se mete detrás del tornado).
    contornoOscuro   lum: los trazos más oscuros que eso, pegados a lo claro, quedan como negro
                     semitransparente (el contorno de las tijeras del tornado).
    desvanecer       [izq, der, arriba, abajo] px: rampa de alfa en los bordes del recorte.
    rellenarObjetos  N: huecos chicos encerrados por trazos claros van opacos (no se usa).

  por cuadro: "porCuadro": {"<i>": {...}}  (i = índice de la caja, ANTES de "usar")
    umbral      corte del alfa sólo para ese cuadro.
    pintar      [regla, ...] ANTES del modelo: pinta los píxeles que cumplen la regla con
                "color" ([r,g,b] o "fondo", default "fondo"). Borra chispas, polvo y arcos que
                el modelo confunde con el cuerpo, y tapa la parte de una chispa que cae sobre la
                remera con el color de la remera.
    agregar     [[x0,y0,x1,y1], ...]: dentro de cada rectángulo la máscara crece hacia los píxeles
                que se despegan del fondo (distancia de color > "difAgregar", default 34) y que
                tocan lo que ya es personaje. Recupera tijeras, máquina y manos estiradas.
    quitar      [regla, ...] DESPUÉS del modelo: saca de la máscara los píxeles de la regla.
    borrar      [[x0,y0,x1,y1], ...]: saca de la máscara todo lo que caiga adentro.
    cerrar      radio (px) de un cierre morfológico final (tapa muescas chicas del borde).
    rellenar    tapa los huecos internos de menos de N px (la herramienta sólo tapa los de <40).

  Una regla es {"caja": [x0,y0,x1,y1], y condiciones opcionales que se cumplen TODAS:
  "lumMin", "lumMax", "satMin", "satMax", "rMenosGMin", "rMenosGMax", "gMenosBMin",
  "bMenosRMin"}. Todas las coordenadas son de la HOJA.
"""
import os
import sys

# El extractor compartido vive al lado de este archivo (scripts/juego/); si se lo corre desde
# otra copia, se busca en el repo.
HERRAMIENTA = os.path.dirname(os.path.abspath(__file__))
if not os.path.exists(os.path.join(HERRAMIENTA, 'extraer_sprites.py')):
    HERRAMIENTA = '/Users/ignaciobaldovino/MSB_FULL/MonacoSmartBarber/scripts/juego'
sys.path.insert(0, HERRAMIENTA)

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy import ndimage  # noqa: E402

import extraer_sprites as ex  # noqa: E402

_cuadro_desde_mascara_original = ex.cuadro_desde_mascara


def _a_local(rect, origen, forma):
    x0, y0, x1, y1 = rect
    ox, oy = origen
    h, w = forma
    return max(0, x0 - ox), max(0, y0 - oy), min(w, x1 - ox), min(h, y1 - oy)


def _zona(rects, origen, forma):
    z = np.zeros(forma, bool)
    for r in rects:
        x0, y0, x1, y1 = _a_local(r, origen, forma)
        if x1 > x0 and y1 > y0:
            z[y0:y1, x0:x1] = True
    return z


def condicion(arr, regla, origen):
    """Máscara de los píxeles que cumplen una regla (caja + condiciones de color)."""
    forma = arr.shape[:2]
    cond = _zona([regla['caja']], origen, forma) if 'caja' in regla else np.ones(forma, bool)
    r_, g_, b_ = arr[..., 0], arr[..., 1], arr[..., 2]
    if any(k in regla for k in ('lumMin', 'lumMax')):
        lum = 0.299 * r_ + 0.587 * g_ + 0.114 * b_
        if 'lumMin' in regla:
            cond &= lum >= regla['lumMin']
        if 'lumMax' in regla:
            cond &= lum <= regla['lumMax']
    if any(k in regla for k in ('satMin', 'satMax')):
        mx, mn = arr.max(axis=2), arr.min(axis=2)
        sat = (mx - mn) / np.maximum(mx, 1)
        if 'satMin' in regla:
            cond &= sat >= regla['satMin']
        if 'satMax' in regla:
            cond &= sat <= regla['satMax']
    if 'rMenosGMin' in regla:
        cond &= (r_ - g_) >= regla['rMenosGMin']
    if 'rMenosGMax' in regla:
        cond &= (r_ - g_) <= regla['rMenosGMax']
    if 'gMenosBMin' in regla:
        cond &= (g_ - b_) >= regla['gMenosBMin']
    if 'bMenosRMin' in regla:
        cond &= (b_ - r_) >= regla['bMenosRMin']
    return cond


def pintar(recorte, reglas, origen):
    arr = np.asarray(recorte).astype(np.float32).copy()
    borde = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    fondo = np.median(borde, axis=0)
    for regla in reglas:
        cond = condicion(arr, regla, origen)
        color = regla.get('color', 'fondo')
        arr[cond] = fondo if color == 'fondo' else np.array(color, np.float32)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def _fondo(recorte, alfa):
    arr = np.asarray(recorte).astype(np.float32)
    seguro = alfa < 0.05
    if seguro.sum() >= 50:
        return np.median(arr[seguro], axis=0)
    borde = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    return np.median(borde, axis=0)


def editar_mascara(binaria, recorte, alfa, o, origen):
    """agregar → quitar → borrar → cerrar, sobre la máscara binaria de un cuadro."""
    arr = np.asarray(recorte).astype(np.float32)
    forma = binaria.shape
    out = binaria.copy()

    if o.get('agregar'):
        fondo = _fondo(recorte, alfa)
        dist = np.sqrt(((arr - fondo) ** 2).sum(axis=2))
        candidato = _zona(o['agregar'], origen, forma) & (dist > float(o.get('difAgregar', 34)))
        out = ndimage.binary_propagation(out, structure=np.ones((3, 3)), mask=out | candidato)

    for regla in o.get('quitar') or []:
        out &= ~condicion(arr, regla, origen)

    borrar = _zona(o.get('borrar') or [], origen, forma)
    out &= ~borrar

    radio = int(o.get('cerrar', 0))
    if radio > 0:
        estructura = np.ones((2 * radio + 1, 2 * radio + 1), bool)
        out = ndimage.binary_closing(out, structure=estructura) & ~borrar

    tope = int(o.get('rellenar', 0))
    if tope > 0:
        huecos = ndimage.binary_fill_holes(out) & ~out
        et, n = ndimage.label(huecos)
        if n:
            areas = ndimage.sum(huecos, et, range(1, n + 1))
            out |= np.isin(et, [i + 1 for i, a in enumerate(areas) if a < tope])
    return out


def recortar_cuadro(hoja, caja, opts):
    """Igual que el de la herramienta, más las opciones por cuadro de este envoltorio."""
    extra = {}
    if 'cajas' in opts or 'panel' in opts:
        cajas = [list(map(int, c)) for c in ex.cajas_de(opts)]
        try:
            i = cajas.index(list(map(int, caja)))
            extra = (opts.get('porCuadro') or {}).get(str(i), {})
        except ValueError:
            extra = {}
    o = {**opts, **extra}
    pad = int(o.get('pad', 6))
    x0, y0, x1, y1 = caja
    x0p, y0p = max(0, x0 - pad), max(0, y0 - pad)
    x1p, y1p = min(hoja.width, x1 + pad), min(hoja.height, y1 + pad)
    recorte = hoja.crop((x0p, y0p, x1p, y1p))
    if o.get('pintar'):
        recorte = pintar(recorte, o['pintar'], (x0p, y0p))
    alfa = ex.mascara_isnet(recorte, cuadrar=True)
    binaria = alfa >= float(o.get('umbral', 0.5))
    abajo = int(o.get('recorteAbajo', 0))
    if abajo > 0:
        binaria[-abajo:, :] = False
    binaria = editar_mascara(binaria, recorte, alfa, o, (x0p, y0p))
    binaria = ex.limpiar(binaria, o.get('componentes', 'principal'))
    return ex.cuadro_desde_mascara(recorte, binaria, o, (x0p, y0p))


def cuadro_desde_mascara(recorte_rgb, binaria, opts, origen):
    """El de la herramienta + "escala" (normaliza filas dibujadas a otro tamaño)."""
    c = _cuadro_desde_mascara_original(recorte_rgb, binaria, opts, origen)
    s = float(opts.get('escala', 1) or 1)
    if c is None or abs(s - 1) < 1e-6:
        return c
    im = c['img']
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    chica = im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    a = np.asarray(chica).copy()
    # bordes duros como el resto de los cuadros (el render dibuja sin suavizado)
    a[..., 3] = np.where(a[..., 3] >= 110, 255, 0).astype(np.uint8)
    c['img'] = Image.fromarray(a)
    c['ax'] = round(c['ax'] * w / im.width, 1)
    c['ay'] = round(c['ay'] * h / im.height, 1)
    return c


_efecto_luz_original = ex.efecto_luz
_efectos_cfg = []


def efecto_luz(hoja, caja):
    """El de la herramienta + opciones del efecto (se buscan por su caja en simon.json):

    fondos            [{"caja": [...], "color": [r,g,b]}]: fondo explícito por zona (la barra de
                      título del panel es verde azulado y el tornado se le mete arriba).
    rellenarObjetos   N: los huecos chicos (<N px) que encierran los trazos claros son el cuerpo
                      negro de las tijeras: van opacos con su color (si no, quedan huecas).
    lumObjeto         umbral de los trazos claros para lo anterior (default 110).
    """
    ef = next((e for e in _efectos_cfg if list(map(int, e.get('caja', []))) == list(map(int, caja))), None)
    claves = ('fondos', 'rellenarObjetos', 'contornoOscuro', 'filasInterpoladas', 'desvanecer')
    if not ef or not any(ef.get(k) for k in claves):
        return _efecto_luz_original(hoja, caja)
    rec = np.asarray(hoja.crop(tuple(caja))).astype(np.float32)
    h, w = rec.shape[:2]
    for fila in ef.get('filasInterpoladas') or []:
        y = int(fila) - int(caja[1])
        if 0 < y < h - 1:
            rec[y] = (rec[y - 1] + rec[y + 1]) / 2
    borde = np.concatenate([rec[0], rec[-1], rec[:, 0], rec[:, -1]])
    fondo = np.broadcast_to(np.median(borde, axis=0), rec.shape).copy()
    for f in ef.get('fondos') or []:
        x0, y0, x1, y1 = _a_local(f['caja'], caja[:2], (h, w))
        fondo[y0:y1, x0:x1] = np.array(f['color'], np.float32)
    dif = np.clip(rec - fondo, 0, None)
    alfa = np.clip(dif.max(axis=2) / np.maximum(1.0, 255.0 - fondo.max(axis=2)), 0, 1)
    alfa = np.where(alfa < 0.06, 0, alfa)
    color = np.clip(fondo + dif / np.maximum(alfa[..., None], 1e-3), 0, 255)
    oscuro = float(ef.get('contornoOscuro', 0))
    if oscuro > 0:
        # los trazos negros (contorno de las tijeras) se conservan como negro semitransparente,
        # sólo pegados a lo claro: si no, las tijeras se ven huecas sobre un fondo claro
        lum = 0.299 * rec[..., 0] + 0.587 * rec[..., 1] + 0.114 * rec[..., 2]
        cerca = ndimage.binary_dilation(alfa > 0.25, structure=np.ones((3, 3)), iterations=2)
        a_osc = np.where(cerca & (lum < oscuro), 0.9 * (1 - lum / oscuro), 0)
        usar = a_osc > alfa
        alfa = np.where(usar, a_osc, alfa)
        color = np.where(usar[..., None], 0, color)
    tope = int(ef.get('rellenarObjetos', 0))
    if tope > 0:
        lum = 0.299 * rec[..., 0] + 0.587 * rec[..., 1] + 0.114 * rec[..., 2]
        claro = lum > float(ef.get('lumObjeto', 110))
        huecos = ndimage.binary_fill_holes(claro) & ~claro
        et, n = ndimage.label(huecos)
        if n:
            areas = ndimage.sum(huecos, et, range(1, n + 1))
            cuerpo = np.isin(et, [i + 1 for i, a in enumerate(areas) if a < tope])
            alfa = np.where(cuerpo, 1.0, alfa)
            color = np.where(cuerpo[..., None], rec, color)
    if ef.get('desvanecer'):
        # rampa de alfa en los bordes [izquierda, derecha, arriba, abajo] (px): un tramo de
        # rayo recortado de la hoja no termina de golpe donde se cortó
        izq, der, arr, aba = (list(ef['desvanecer']) + [0, 0, 0, 0])[:4]
        xs, ys = np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32)
        rx = np.ones(w, np.float32)
        ry = np.ones(h, np.float32)
        if izq:
            rx = np.minimum(rx, np.clip((xs + 1) / izq, 0, 1))
        if der:
            rx = np.minimum(rx, np.clip((w - xs) / der, 0, 1))
        if arr:
            ry = np.minimum(ry, np.clip((ys + 1) / arr, 0, 1))
        if aba:
            ry = np.minimum(ry, np.clip((h - ys) / aba, 0, 1))
        alfa = alfa * ry[:, None] * rx[None, :]
    rgba = np.dstack([color, alfa * 255]).astype(np.uint8)
    img = Image.fromarray(rgba)
    bb = img.getbbox()
    img = img.crop(bb) if bb else img
    return {'img': img, 'ax': img.width / 2.0, 'ay': img.height / 2.0, 'origen': list(caja[:2])}


ex.recortar_cuadro = recortar_cuadro
ex.cuadro_desde_mascara = cuadro_desde_mascara
ex.efecto_luz = efecto_luz


def _cargar_efectos():
    for a in sys.argv[1:]:
        if a.endswith('.json') and os.path.exists(a):
            import json
            with open(a) as f:
                _efectos_cfg.extend((json.load(f).get('efectos') or {}).values())
            return

if __name__ == '__main__':
    os.environ.setdefault('OMP_NUM_THREADS', '3')
    _cargar_efectos()
    ex.main()

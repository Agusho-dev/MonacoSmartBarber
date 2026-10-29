#!/usr/bin/env python3
"""
Extrae los cuadros de una hoja de sprites de «Corte Final» y arma el atlas del personaje.

Uso (desde MonacoSmartBarber/):
  OMP_NUM_THREADS=3 python3 scripts/juego/extraer_sprites.py scripts/juego/personajes/simon.json \
      [--solo quieto,golpe] [--revision /ruta/a/carpeta] [--sin-atlas]

Por qué así y no por color: las hojas vienen con fondo gris casi negro (#151717) y los
barberos visten de negro (#0a0a0a): por umbral de color la ropa se pierde o el fondo se
cuela. isnet-general-use (rembg) los separa bien CUADRO POR CUADRO (probado el 29/oct/2026).
Sobre un panel entero con efectos (rayos, tornados) se confunde: por eso se recorta cada
cuadro por separado y los efectos los dibuja el motor.

Requisitos: pip3 install --user rembg onnxruntime scipy pillow numpy
(el modelo, ~170 MB, se baja solo a ~/.u2net la primera vez).

Formato del JSON de configuración (rutas relativas al propio JSON o absolutas):
{
  "personaje": "simon",
  "hoja": "../../../../juego-fuentes/simon_anim.png",
  "salida": "../../../public/juego/personajes/simon",
  "retrato": { "fuente": "...simon_full.jpg", "alto": 720, "cara": [x0, y0, x1, y1] },
  "animaciones": {
    "quieto": { "panel": [x0, y0, x1, y1], "cuadros": 5 },
    "golpe":  { "panel": [...], "cuadros": 5, "impactos": [4] },
    "ko":     { "cajas": [[x0, y0, x1, y1], ...], "ancla": "pies" },
    ...
  },
  "efectos": {
    "tornado": { "caja": [x0, y0, x1, y1], "modo": "luz" },
    "sillon":  { "caja": [x0, y0, x1, y1], "modo": "objeto" }
  }
}

Opciones por animación (todas opcionales salvo panel+cuadros o cajas):
  impactos     índices de los cuadros de contacto (ataques), en el orden en que pegan
  usar         índices de los cuadros a conservar (para descartar repetidos o rotos)
  espejo       true si en la hoja el personaje mira a la IZQUIERDA (el atlas mira a la derecha)
  pad          px de margen extra alrededor de cada ranura (default 6)
  umbral       corte del alfa 0..1 (default 0.5)
  ancla        'torso' (default) | 'pies' | 'caja': cómo se calcula el punto de apoyo X
  componentes  'principal' (default) | 'todos'
  ajusteY      px que se suman al apoyo Y (positivo = el personaje se dibuja más arriba)
  recorteAbajo px de la ranura que se ignoran abajo (polvo, sombras pintadas)
  cajasPorCuadro  {"2": [x0,y0,x1,y1]} para corregir la ranura de un cuadro puntual
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

CLAVES = [
    'quieto', 'caminar', 'correr', 'dash', 'guardia', 'agachado', 'saltar', 'caer',
    'golpe', 'patada', 'combo', 'herramienta1', 'herramienta2', 'especial1', 'especial2',
    'danio', 'ko', 'levantarse', 'victoria', 'burla',
]

_sesion = None


def sesion():
    global _sesion
    if _sesion is None:
        from rembg import new_session
        _sesion = new_session('isnet-general-use')
    return _sesion


def mascara_isnet(img_rgb, cuadrar=False):
    """Alfa 0..1 (float) del primer plano de una imagen RGB chica, a su tamaño.

    cuadrar=True rellena a un cuadrado con el color del borde antes de inferir: el modelo
    estira la entrada a 1024x1024 y un recorte angosto de un solo cuadro sale deformado
    (cortaba piernas). Sobre un panel entero NO conviene: así, sin rellenar, salió limpio.
    """
    from rembg import remove
    src = img_rgb
    off = (0, 0)
    if cuadrar:
        a = np.asarray(img_rgb)
        borde = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
        color = tuple(int(v) for v in np.median(borde, axis=0))
        lado = max(img_rgb.size)
        src = Image.new('RGB', (lado, lado), color)
        off = ((lado - img_rgb.width) // 2, (lado - img_rgb.height) // 2)
        src.paste(img_rgb, off)
    escala = 4 if max(src.size) < 400 else (2 if max(src.size) < 900 else 1)
    up = src.resize((src.width * escala, src.height * escala), Image.LANCZOS)
    m = remove(up, session=sesion(), only_mask=True)
    m = m.resize(src.size, Image.LANCZOS)
    if cuadrar:
        m = m.crop((off[0], off[1], off[0] + img_rgb.width, off[1] + img_rgb.height))
    return np.asarray(m).astype(np.float32) / 255.0


def separar_cuadros(binaria, n):
    """Parte la máscara de un panel en n personajes (izquierda → derecha).

    Cada personaje suele ser una mancha propia; cuando dos se tocan (los pies de un golpe
    rozan al cuadro siguiente) se corta la mancha más ancha por la columna con menos masa
    de su tercio central. Los pedacitos sueltos (una tijera, un mechón) van al más cercano.
    """
    lab, k = ndimage.label(binaria, structure=np.ones((3, 3)))
    if k == 0:
        return []
    lab = lab.astype(np.int32)
    siguiente = k + 1

    def datos():
        areas = ndimage.sum(np.ones_like(lab), lab, range(1, siguiente))
        objs = ndimage.find_objects(lab, max_label=siguiente - 1)
        out = []
        for i, sl in enumerate(objs):
            if sl is None or areas[i] < 12:
                continue
            out.append({'id': i + 1, 'area': float(areas[i]), 'x0': sl[1].start, 'x1': sl[1].stop,
                        'y0': sl[0].start, 'y1': sl[0].stop})
        return out

    comps = datos()
    for _ in range(n * 3):
        comps.sort(key=lambda c: -c['area'])
        if not comps:
            return []
        grandes = [c for c in comps if c['area'] >= 0.25 * comps[0]['area']]
        if len(grandes) >= n:
            break
        c = max(grandes, key=lambda c: c['x1'] - c['x0'])
        ancho = c['x1'] - c['x0']
        if ancho < 30:
            break
        zona = lab[:, c['x0']:c['x1']] == c['id']
        perfil = zona.sum(axis=0).astype(float)
        a, b = int(ancho * 0.3), int(ancho * 0.7)
        corte = c['x0'] + a + int(np.argmin(perfil[a:b]))
        derecha = (lab == c['id']) & (np.arange(lab.shape[1])[None, :] >= corte)
        lab[derecha] = siguiente
        siguiente += 1
        comps = datos()

    comps.sort(key=lambda c: -c['area'])
    grandes = sorted(comps[:n], key=lambda c: (c['x0'] + c['x1']) / 2)
    resto = comps[n:]
    asignacion = {g['id']: [g['id']] for g in grandes}
    for c in resto:
        cx, cy = (c['x0'] + c['x1']) / 2, (c['y0'] + c['y1']) / 2

        def dist(g):
            dx = max(g['x0'] - cx, 0, cx - g['x1'])
            dy = max(g['y0'] - cy, 0, cy - g['y1'])
            return dx * dx + dy * dy

        mejor = min(grandes, key=dist)
        if dist(mejor) <= 18 * 18:
            asignacion[mejor['id']].append(c['id'])
    return [np.isin(lab, asignacion[g['id']]) for g in grandes]


def cuadro_desde_mascara(recorte_rgb, binaria, opts, origen):
    """Recorta el cuadro de una máscara ya separada y calcula su punto de apoyo."""
    agujeros = ndimage.binary_fill_holes(binaria) & ~binaria
    et_h, nh = ndimage.label(agujeros)
    if nh:
        ah = ndimage.sum(agujeros, et_h, range(1, nh + 1))
        binaria = binaria | np.isin(et_h, [i + 1 for i, a in enumerate(ah) if a < 40])
    ys, xs = np.nonzero(binaria)
    if len(xs) == 0:
        return None
    by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([np.asarray(recorte_rgb), (binaria * 255).astype(np.uint8)])[by0:by1, bx0:bx1]
    sub = binaria[by0:by1, bx0:bx1]
    img = Image.fromarray(np.ascontiguousarray(rgba), 'RGBA')
    ax = ancla_x(sub, opts.get('ancla', 'torso'))
    ay = float(img.height) + float(opts.get('ajusteY', 0))
    if opts.get('espejo'):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
        ax = img.width - ax
    return {'img': img, 'ax': round(ax, 1), 'ay': round(ay, 1), 'origen': [origen[0] + int(bx0), origen[1] + int(by0)]}


def cuadros_de_panel(hoja, anim):
    """Modo por defecto: UNA inferencia sobre el panel entero y separación por manchas."""
    x0, y0, x1, y1 = anim['panel']
    recorte = hoja.crop((x0, y0, x1, y1))
    alfa = mascara_isnet(recorte)
    binaria = alfa >= float(anim.get('umbral', 0.5))
    abajo = int(anim.get('recorteAbajo', 0))
    if abajo > 0:
        binaria[-abajo:, :] = False
    binaria = ndimage.binary_opening(binaria, structure=np.ones((2, 2)))
    partes = separar_cuadros(binaria, int(anim['cuadros']))
    if len(partes) != int(anim['cuadros']):
        print(f"  AVISO: se esperaban {anim['cuadros']} cuadros y se separaron {len(partes)}", file=sys.stderr)
    out = []
    for m in partes:
        c = cuadro_desde_mascara(recorte, m, anim, (x0, y0))
        if c:
            out.append(c)
    return out


def limpiar(binaria, modo='principal'):
    """Se queda con el personaje: la mancha más grande y lo que cuelga de ella."""
    etiquetas, n = ndimage.label(binaria, structure=np.ones((3, 3)))
    if n == 0:
        return binaria
    areas = ndimage.sum(binaria, etiquetas, range(1, n + 1))
    if modo == 'todos':
        conservar = [i + 1 for i, a in enumerate(areas) if a >= 20]
    else:
        mayor = int(np.argmax(areas)) + 1
        ys, xs = np.where(etiquetas == mayor)
        y0, y1, x0, x1 = ys.min() - 12, ys.max() + 12, xs.min() - 12, xs.max() + 12
        conservar = [mayor]
        cajas = ndimage.find_objects(etiquetas)
        for i, a in enumerate(areas):
            if i + 1 == mayor or a < max(15, 0.03 * areas[mayor - 1]):
                continue
            sl = cajas[i]
            cy0, cy1, cx0, cx1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
            if cy0 >= y0 and cy1 <= y1 and cx0 >= x0 and cx1 <= x1:
                conservar.append(i + 1)
    out = np.isin(etiquetas, conservar)
    # Rellena agujeros chicos (brillos de la ropa que el modelo dejó afuera), no los grandes
    # (el hueco entre las piernas o entre el brazo y el torso es fondo de verdad).
    agujeros = ndimage.binary_fill_holes(out) & ~out
    et_h, nh = ndimage.label(agujeros)
    if nh:
        ah = ndimage.sum(agujeros, et_h, range(1, nh + 1))
        chicos = [i + 1 for i, a in enumerate(ah) if a < 40]
        out |= np.isin(et_h, chicos)
    return out


def ancla_x(binaria, modo):
    h, w = binaria.shape
    if modo == 'caja':
        return w / 2.0
    if modo == 'pies':
        franja = binaria[int(h * 0.85):, :]
    else:  # torso: cabeza y tronco, lo más estable entre cuadros de un mismo movimiento
        franja = binaria[int(h * 0.12):int(h * 0.55), :]
    ys, xs = np.nonzero(franja)
    if len(xs) == 0:
        return w / 2.0
    return float(np.median(xs))


def recortar_cuadro(hoja, caja, opts):
    """Modo 'cajas': un cuadro por recorte (paneles con efectos que confunden al modelo)."""
    pad = int(opts.get('pad', 6))
    x0, y0, x1, y1 = caja
    x0p, y0p = max(0, x0 - pad), max(0, y0 - pad)
    x1p, y1p = min(hoja.width, x1 + pad), min(hoja.height, y1 + pad)
    recorte = hoja.crop((x0p, y0p, x1p, y1p))
    alfa = mascara_isnet(recorte, cuadrar=True)
    binaria = alfa >= float(opts.get('umbral', 0.5))
    abajo = int(opts.get('recorteAbajo', 0))
    if abajo > 0:
        binaria[-abajo:, :] = False
    binaria = limpiar(binaria, opts.get('componentes', 'principal'))
    return cuadro_desde_mascara(recorte, binaria, opts, (x0p, y0p))


def cajas_de(anim):
    if 'cajas' in anim:
        cajas = [list(c) for c in anim['cajas']]
    else:
        x0, y0, x1, y1 = anim['panel']
        n = int(anim['cuadros'])
        ancho = (x1 - x0) / n
        cajas = [[int(round(x0 + i * ancho)), y0, int(round(x0 + (i + 1) * ancho)), y1] for i in range(n)]
    for k, c in (anim.get('cajasPorCuadro') or {}).items():
        cajas[int(k)] = list(c)
    return cajas


def efecto_luz(hoja, caja):
    """Brillos sobre fondo oscuro → sprite con alfa (como «color a alfa» contra el fondo)."""
    rec = np.asarray(hoja.crop(tuple(caja))).astype(np.float32)
    borde = np.concatenate([rec[0], rec[-1], rec[:, 0], rec[:, -1]])
    fondo = np.median(borde, axis=0)
    dif = np.clip(rec - fondo, 0, None)
    alfa = np.clip(dif.max(axis=2) / np.maximum(1.0, 255.0 - fondo.max()), 0, 1)
    alfa = np.where(alfa < 0.06, 0, alfa)
    color = np.clip(fondo + dif / np.maximum(alfa[..., None], 1e-3), 0, 255)
    rgba = np.dstack([color, alfa * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, 'RGBA')
    bb = img.getbbox()
    img = img.crop(bb) if bb else img
    return {'img': img, 'ax': img.width / 2.0, 'ay': img.height / 2.0, 'origen': list(caja[:2])}


def empaquetar(cuadros, ancho_max=2048, sep=2):
    """Estantes simples: alto descendente. Devuelve (ancho, alto, posiciones)."""
    orden = sorted(range(len(cuadros)), key=lambda i: -cuadros[i]['img'].height)
    x = y = alto_fila = 0
    ancho_usado = 0
    pos = [None] * len(cuadros)
    for i in orden:
        w, h = cuadros[i]['img'].size
        if x + w > ancho_max:
            x, y, alto_fila = 0, y + alto_fila + sep, 0
        pos[i] = (x, y)
        x += w + sep
        alto_fila = max(alto_fila, h)
        ancho_usado = max(ancho_usado, x)
    return ancho_usado, y + alto_fila, pos


def tira_revision(nombre, lista, carpeta, ref):
    """Tira de control: cada cuadro parado sobre la misma línea de piso, con su apoyo X en rojo."""
    if not lista:
        return
    esc = 2
    alto = int(max(max(c['ay'], c['img'].height) for c in lista) + 30)
    celda = int(max(max(c['ax'], c['img'].width - c['ax']) for c in lista) * 2 + 20)
    lienzo = Image.new('RGBA', (celda * len(lista) * esc, alto * esc), (120, 120, 120, 255))
    dib = ImageDraw.Draw(lienzo)
    for i, c in enumerate(lista):
        cx = i * celda + celda // 2
        base = alto - 15
        # cuadriculado para ver el alfa
        for yy in range(0, alto * esc, 16):
            for xx in range(i * celda * esc, (i + 1) * celda * esc, 16):
                if (xx // 16 + yy // 16) % 2 == 0:
                    dib.rectangle([xx, yy, xx + 15, yy + 15], fill=(100, 100, 100, 255))
        im = c['img'].resize((c['img'].width * esc, c['img'].height * esc), Image.NEAREST)
        lienzo.alpha_composite(im, (int((cx - c['ax']) * esc), int((base - c['ay']) * esc)))
        dib.line([(cx * esc, 0), (cx * esc, alto * esc)], fill=(255, 0, 0, 255), width=1)
        dib.line([(i * celda * esc, base * esc), ((i + 1) * celda * esc, base * esc)], fill=(0, 255, 0, 255), width=1)
        dib.line([(i * celda * esc, (base - ref) * esc), ((i + 1) * celda * esc, (base - ref) * esc)], fill=(0, 200, 255, 255), width=1)
        dib.text((i * celda * esc + 4, 4), str(i), fill=(255, 255, 0, 255))
    lienzo.convert('RGB').save(os.path.join(carpeta, f'revision_{nombre}.png'))


def procesar_retrato(cfg, salida):
    r = cfg['retrato']
    fuente = Image.open(r['fuente']).convert('RGB')
    alfa = mascara_isnet(fuente)
    binaria = limpiar(alfa >= 0.5)
    rgba = np.dstack([np.asarray(fuente), (binaria * 255).astype(np.uint8)])
    img = Image.fromarray(rgba, 'RGBA')
    bb = img.getbbox()
    cuerpo = img.crop(bb)
    alto = int(r.get('alto', 720))
    ancho = round(cuerpo.width * alto / cuerpo.height)
    cuerpo.resize((ancho, alto), Image.LANCZOS).save(os.path.join(salida, 'retrato.webp'), 'WEBP', quality=90, method=6)
    if r.get('cara'):
        cara = img.crop(tuple(r['cara']))
        lado = max(cara.size)
        cuadrada = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
        cuadrada.alpha_composite(cara, ((lado - cara.width) // 2, (lado - cara.height) // 2))
        cuadrada.resize((256, 256), Image.LANCZOS).save(os.path.join(salida, 'cara.webp'), 'WEBP', quality=90, method=6)
    print('retrato listo')


def ruta(base, p):
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(base, p))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--solo', default='')
    ap.add_argument('--revision', default='')
    ap.add_argument('--sin-atlas', action='store_true')
    ap.add_argument('--retrato', action='store_true', help='procesa también retrato.webp y cara.webp')
    args = ap.parse_args()

    base = os.path.dirname(os.path.abspath(args.config))
    with open(args.config) as f:
        cfg = json.load(f)
    hoja = Image.open(ruta(base, cfg['hoja'])).convert('RGB')
    salida = ruta(base, cfg['salida'])
    os.makedirs(salida, exist_ok=True)
    if args.revision:
        os.makedirs(args.revision, exist_ok=True)
    if cfg.get('retrato'):
        cfg['retrato']['fuente'] = ruta(base, cfg['retrato']['fuente'])
    if args.retrato and cfg.get('retrato'):
        procesar_retrato(cfg, salida)

    solo = [s for s in args.solo.split(',') if s]
    resultado = {}
    # Los intermedios van al lado del JSON (scripts/juego/personajes/.cache/<id>), NUNCA a public/.
    carpeta_cache = os.path.join(base, '.cache', cfg['personaje'])
    os.makedirs(carpeta_cache, exist_ok=True)
    cache = os.path.join(carpeta_cache, 'cuadros.json')
    previos = {}
    if solo and os.path.exists(cache):
        with open(cache) as f:
            previos = json.load(f)

    for nombre, anim in cfg['animaciones'].items():
        if solo and nombre not in solo:
            continue
        lista = []
        if 'cajas' in anim:
            for i, caja in enumerate(cajas_de(anim)):
                c = recortar_cuadro(hoja, caja, anim)
                if c is None:
                    print(f'  {nombre}[{i}]: vacío, se omite', file=sys.stderr)
                    continue
                lista.append(c)
        else:
            lista = cuadros_de_panel(hoja, anim)
            for k, caja in (anim.get('cajasPorCuadro') or {}).items():
                c = recortar_cuadro(hoja, caja, anim)
                if c is not None and int(k) < len(lista):
                    lista[int(k)] = c
        usar = anim.get('usar')
        if usar:
            lista = [lista[i] for i in usar if i < len(lista)]
        resultado[nombre] = {'cuadros': lista, 'impactos': anim.get('impactos', [])}
        print(f'{nombre}: {len(lista)} cuadros')

    efectos = {}
    for nombre, ef in (cfg.get('efectos') or {}).items():
        if solo and nombre not in solo:
            continue
        if ef.get('modo') == 'luz':
            efectos[nombre] = [efecto_luz(hoja, ef['caja'])]
        else:
            c = recortar_cuadro(hoja, ef['caja'], {**ef, 'componentes': ef.get('componentes', 'todos'), 'ancla': 'caja'})
            if c:
                c['ay'] = c['img'].height / 2.0
                efectos[nombre] = [c]
        print(f'efecto {nombre}: listo')

    ref = None
    if 'quieto' in resultado and resultado['quieto']['cuadros']:
        ref = int(resultado['quieto']['cuadros'][0]['img'].height)

    if args.revision:
        for nombre, r in resultado.items():
            tira_revision(nombre, r['cuadros'], args.revision, ref or 0)
        for nombre, lista in efectos.items():
            tira_revision('efecto_' + nombre, lista, args.revision, 0)

    # Guarda los cuadros sueltos para poder re-armar el atlas procesando sólo algunas animaciones.
    carpeta_cuadros = os.path.join(carpeta_cache, 'cuadros')
    os.makedirs(carpeta_cuadros, exist_ok=True)
    for nombre, r in list(resultado.items()) + [('efecto:' + k, {'cuadros': v, 'impactos': []}) for k, v in efectos.items()]:
        entradas = []
        for i, c in enumerate(r['cuadros']):
            archivo = f"{nombre.replace(':', '_')}_{i}.png"
            c['img'].save(os.path.join(carpeta_cuadros, archivo))
            entradas.append({'archivo': archivo, 'ax': c['ax'], 'ay': c['ay']})
        previos[nombre] = {'cuadros': entradas, 'impactos': r['impactos']}
    with open(cache, 'w') as f:
        json.dump(previos, f)

    if args.sin_atlas:
        return

    todos, indice = [], {}
    for nombre, r in previos.items():
        indice[nombre] = []
        for e in r['cuadros']:
            img = Image.open(os.path.join(carpeta_cuadros, e['archivo'])).convert('RGBA')
            indice[nombre].append(len(todos))
            todos.append({'img': img, 'ax': e['ax'], 'ay': e['ay']})
    ancho, alto, pos = empaquetar(todos)
    atlas = Image.new('RGBA', (max(1, ancho), max(1, alto)), (0, 0, 0, 0))
    for c, (x, y) in zip(todos, pos):
        atlas.alpha_composite(c['img'], (x, y))
    atlas.save(os.path.join(salida, 'atlas.png'), optimize=True)

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
    faltan = [k for k in CLAVES if k not in anims]
    if faltan:
        print('AVISO: faltan animaciones:', ', '.join(faltan), file=sys.stderr)
    if ref is None and 'quieto' in anims:
        ref = anims['quieto']['cuadros'][0]['h']
    salida_json = {
        'version': 1,
        'personaje': cfg['personaje'],
        'imagen': 'atlas.png',
        'alturaReferencia': ref,
        'animaciones': anims,
        'efectos': efs,
    }
    with open(os.path.join(salida, 'atlas.json'), 'w') as f:
        json.dump(salida_json, f, separators=(',', ':'))
    print(f'atlas {ancho}x{alto}, {len(todos)} cuadros → {salida}')


if __name__ == '__main__':
    main()

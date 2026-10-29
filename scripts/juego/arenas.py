#!/usr/bin/env python3
"""
Arenas de «Corte Final»: saca el HUD que las imágenes de origen traen dibujado (barras de
vida, el «VS» y los puntitos de rounds), reconstruye lo que había debajo y exporta los
.webp que usa el juego: public/juego/arenas/<id>.webp (ancho original, ≤1672) y
<id>-mini.webp (480 de ancho, para las tarjetas).

Uso (desde MonacoSmartBarber/; si hay otros procesos pesados, anteponé el candado
`TURNO=ml …/herramientas/turno.sh`):
  python3 scripts/juego/arenas.py [rondeau caseros pueyrredon parana] [--revision DIR] \
      [--sin-exportar] [--modelo RUTA.onnx] [--fuentes DIR] [--solo-mascara]

  --revision DIR  deja hojas para mirar a ojo: la máscara, el antes/después de la franja de
                  arriba ampliada y la arena con dos luchadores parados en `suelo` y las
                  luces marcadas.
  --sin-exportar  no toca public/ (para probar parámetros).

Cómo funciona:
1. Máscara del HUD por COLOR y POSICIÓN en el ~20 % de arriba. El relleno de las barras es
   rojo/naranja/amarillo saturado y cruza casi todo el ancho en filas fijas: se toma fila
   por fila y se dilata con los márgenes medidos en cada imagen (contorno negro + bisel +
   sombra: T arriba, B abajo, S a los costados). El «VS» es el cálido saturado de su caja
   (más el orbe azul en Caseros), dilatado para comerse el contorno. Puntitos de rounds y
   pestañas azules: cajas medidas. Después se suman, creciendo de a 1 px, los píxeles con
   colores de HUD que quedaron pegados (las puntas inclinadas de las barras), y un margen.
2. Reconstrucción con LaMa (Suvorov et al., 2021; modelo Big-LaMa exportado a ONNX, entrada
   fija de 512x512). Se probó primero un relleno por ejemplos (Criminisi) y cv2.inpaint:
   el primero inventa fragmentos (tubos de luz cortados, soportes repetidos, pedazos del
   neón MONACO arriba del cartel) y el segundo deja un borrón; LaMa continúa los tubos de
   luz, las vigas y los listones a través del hueco. Se procesa en mosaicos de 512 a
   resolución nativa (nada de reescalar: es pixel art): cada mosaico rellena SÓLO su banda
   central de 256 px, así todo píxel tiene contexto a los dos lados, y el siguiente ve lo
   ya rellenado como conocido (sin costuras entre mosaicos).
3. `tono`: el color oscuro dominante (k-means sobre los tonos oscuros), llevado a una
   luminosidad de fondo con la croma acotada.
`suelo`, `luces` y `tono` van a mano en src/lib/juego/arenas.ts; acá están en CONFIG para la
hoja de revisión (que es la que justifica los números).

Requisitos: python3 con numpy, scipy, pillow, opencv-python y onnxruntime (todos en el site
del usuario: no usar `python3 -I`). El modelo (208 MB, Apache-2.0) se baja una vez:
  mkdir -p ~/.cache/corte-final && curl -L -o ~/.cache/corte-final/lama_fp32.onnx \
    https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
  sha256 1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6
Usa ~1 GB de RAM y ~2 s por mosaico (4 a 7 mosaicos por arena).
"""
import argparse
import hashlib
import json
import os
import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FUENTES = os.path.abspath(os.path.join(RAIZ, '..', 'juego-fuentes'))
SALIDA = os.path.join(RAIZ, 'public', 'juego', 'arenas')
MODELO = os.environ.get('LAMA_ONNX', os.path.expanduser('~/.cache/corte-final/lama_fp32.onnx'))
SHA_MODELO = '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6'

# Vista lógica del juego y alto del luchador (src/lib/juego/tipos.ts y personajes.ts).
VISTA_ALTO = 540
ALTURA_LUCHADOR = 212

# ─── Configuración por arena ────────────────────────────────────────────────
# Medidas en px de la imagen de origen.
#   T, B, S   margen del borde de la barra alrededor del relleno: arriba, abajo, costados
#             (contorno negro + bisel + sombra; medido con perfiles de columna).
#   vs        caja del «VS» (x0, y0, x1, y1); vs_azul suma el orbe azul de Caseros.
#   cajas     rectángulos que se borran enteros (puntitos de rounds, pestañas).
#   margen    dilatación final (más en el JPEG de Rondeau, por los halos de compresión).
#   suelo     fracción del alto donde apoyan los pies       } los mismos valores que en
#   luces     (x, y, radio, color) en fracciones            } src/lib/juego/arenas.ts
CONFIG = {
    'rondeau': dict(
        fuente='arena_rondeau.jpg',
        T=12, B=14, S=15,
        vs=(583, 6, 702, 110),
        cajas=[(498, 74, 568, 105), (713, 74, 783, 105)],
        margen=3,
        # En la referencia del dueño (referencia_rondeau_pelea.jpg) las suelas están en
        # y ≈ 628-638 de 720 (0,87-0,89) con luchadores de ~270 px (37,5 % del alto).
        suelo=0.87,
        luces=[
            (0.195, 0.403, 0.022, '#FFF3E3'),  # aro de luz del primer espejo
            (0.568, 0.458, 0.012, '#FFF3E3'),  # aro de luz chico del fondo
            (0.628, 0.194, 0.085, '#FFE6C0'),  # racimo de tiras LED del techo
            (0.780, 0.317, 0.055, '#FFE6C0'),  # tiras LED de la derecha
            (0.819, 0.479, 0.024, '#F2D9A6'),  # cartel redondo MÓNACO
        ],
    ),
    'caseros': dict(
        fuente='arena_caseros.png',
        T=15, B=15, S=15,
        vs=(766, 6, 900, 146), vs_azul=True,
        cajas=[(647, 96, 738, 130), (932, 96, 1021, 130),
               (674, 28, 742, 54), (928, 18, 992, 54)],  # puntitos + pestañas azules
        margen=2,
        # La base del sillón más cercano está en 0,84: los pies van un poco adelante.
        suelo=0.87,
        luces=[
            (0.222, 0.430, 0.040, '#FFE6C2'),  # neón «M» de la pared de cemento
            (0.897, 0.462, 0.026, '#EEF2FF'),  # neón «M» del fondo
            (0.278, 0.118, 0.014, '#FFD597'),  # spots colgantes
            (0.484, 0.188, 0.013, '#FFD597'),
            (0.614, 0.240, 0.011, '#FFD597'),
            (0.854, 0.245, 0.035, '#EAF1FF'),  # tubo fluorescente del fondo
        ],
    ),
    'pueyrredon': dict(
        fuente='arena_pueyrredon.png',
        T=17, B=19, S=15,
        vs=(768, 10, 900, 130),
        cajas=[(637, 101, 753, 138), (916, 101, 1032, 138)],
        margen=2,
        # Se pelea en la vereda: el escalón de la vidriera termina en ~0,815.
        suelo=0.88,
        luces=[
            (0.539, 0.201, 0.065, '#DCEBFF'),  # neón MONACO: «MON»
            (0.664, 0.239, 0.065, '#DCEBFF'),  # neón MONACO: «ACO»
            (0.866, 0.443, 0.075, '#E2EDFF'),  # «M» gigante de neón
            (0.341, 0.362, 0.060, '#FFD9A0'),  # luces del techo del salón (detrás del vidrio)
            (0.176, 0.455, 0.055, '#B07CFF'),  # pantalla violeta de la vidriera
        ],
    ),
    'parana': dict(
        fuente='arena_parana.png',
        T=16, B=16, S=15,
        vs=(764, 4, 904, 144),
        cajas=[(647, 97, 753, 135), (927, 97, 1025, 135)],
        margen=2,
        # Las bases de los sillones llegan a ~0,79: los pies van adelante, sobre el parquet.
        suelo=0.87,
        luces=[
            (0.827, 0.420, 0.032, '#D4F0FF'),  # neón «M» en el espejo
            (0.062, 0.438, 0.016, '#FFC46B'),  # aplique de la pared del fondo
            (0.192, 0.282, 0.060, '#FFD49A'),  # tiras de luz del techo (no sus reflejos
            (0.477, 0.194, 0.060, '#FFD49A'),  # en los espejos)
            (0.661, 0.092, 0.060, '#FFD49A'),
        ],
    ),
}


# ─── Máscara del HUD ────────────────────────────────────────────────────────

def corridas(v):
    """Rangos [a, b] (inclusive) donde el vector booleano es True."""
    d = np.diff(np.concatenate([[0], v.astype(np.int8), [0]]))
    return list(zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0] - 1))


def dilatar_asim(m, arriba, abajo, lados):
    """Dilata una máscara booleana con márgenes distintos arriba, abajo y a los costados."""
    v = m.copy()
    for d in range(1, arriba + 1):
        v[:-d] |= m[d:]
    for d in range(1, abajo + 1):
        v[d:] |= m[:-d]
    h = v.copy()
    for d in range(1, lados + 1):
        h[:, :-d] |= v[:, d:]
        h[:, d:] |= v[:, :-d]
    return h


def mascara_hud(rgb, cfg):
    H, W, _ = rgb.shape
    a = rgb.astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    zona_hud = np.zeros((H, W), bool)
    zona_hud[:int(H * 0.2)] = True
    mascara = np.zeros((H, W), bool)

    # 1) Barras: relleno cálido saturado que cruza buena parte del ancho en las mismas filas.
    calido = (r > 170) & (sat > 0.6) & (b < 90) & (r >= g) & zona_hud
    filas = np.nonzero(calido.sum(1) > W * 0.3)[0]
    if len(filas) == 0:
        raise SystemExit('no encontré las barras de vida (¿cambió la imagen de origen?)')
    y0, y1 = int(filas.min()), int(filas.max())
    banda = calido[y0:y1 + 1].mean(0) > 0.5
    barras = [(int(xa), int(xb)) for xa, xb in corridas(banda) if xb - xa > W * 0.2]
    if len(barras) != 2:
        raise SystemExit(f'esperaba 2 barras y encontré {len(barras)}: {barras}')
    for xa, xb in barras:
        ya, yb = max(0, y0 - 12), min(H, y1 + 13)
        xa0, xb1 = max(0, xa - 40), min(W, xb + 41)
        zona = ndimage.binary_opening(calido[ya:yb, xa0:xb1], np.ones((3, 3)))
        relleno = np.zeros_like(zona)
        for i in range(zona.shape[0]):
            xs = np.nonzero(zona[i])[0]
            if len(xs) > 0.5 * (xb - xa):
                relleno[i, xs.min():xs.max() + 1] = True
        m = np.zeros((H, W), bool)
        m[ya:yb, xa0:xb1] = relleno
        mascara |= dilatar_asim(m, cfg['T'], cfg['B'], cfg['S'])

    # 2) El «VS»: cálido saturado (más permisivo: tiene amarillos y rojos oscuros) en su caja,
    #    el contorno negro (dilatación) y los huecos entre letras (relleno de agujeros).
    x0, yv0, x1, yv1 = cfg['vs']
    caja = np.zeros((H, W), bool)
    caja[yv0:yv1, x0:x1] = True
    letras = (r > 140) & (sat > 0.5) & (b < 130) & (r >= g)
    if cfg.get('vs_azul'):
        letras |= (b > 110) & (b - r > 45) & (sat > 0.45)
    letras &= caja
    etiquetas, n = ndimage.label(letras)
    if n:
        tam = ndimage.sum(letras, etiquetas, range(1, n + 1))
        letras = np.isin(etiquetas, 1 + np.nonzero(tam >= 30)[0])
    borde = cfg.get('vs_borde', 6)
    vs = ndimage.binary_dilation(letras, np.ones((2 * borde + 1, 2 * borde + 1)))
    vs = ndimage.binary_fill_holes(vs)
    lim = np.zeros((H, W), bool)
    lim[max(0, yv0 - borde):yv1 + borde, max(0, x0 - borde):x1 + borde] = True
    mascara |= vs & lim

    # 3) Cajas medidas a mano: puntitos de rounds, pestañas.
    for (cx0, cy0, cx1, cy1) in cfg.get('cajas', []):
        mascara[cy0:cy1, cx0:cx1] = True

    # 4) Lo que quedó pegado afuera con colores de HUD (contorno negro o azul marino, bisel
    #    azul/acero, relleno) se suma creciendo de a 1 px, como mucho `crecer` px: las puntas
    #    inclinadas de las barras sobresalen del rectángulo dilatado.
    hud = (mx < 50) | ((b > r + 25) & (sat > 0.3)) | ((r > 150) & (sat > 0.6) & (b < 100))
    hud &= zona_hud
    for _ in range(cfg.get('crecer', 5)):
        nuevo = ndimage.binary_dilation(mascara, np.ones((3, 3))) & ~mascara & hud
        if not nuevo.any():
            break
        mascara |= nuevo

    # 5) Margen general para los halos de antialias y de compresión.
    k = cfg.get('margen', 2)
    if k:
        mascara = ndimage.binary_dilation(mascara, np.ones((2 * k + 1, 2 * k + 1)))
    return mascara, barras, (y0, y1)


# ─── Reconstrucción (LaMa) ──────────────────────────────────────────────────

def sesion_lama(ruta):
    if not os.path.exists(ruta):
        sys.exit(f'falta el modelo {ruta}. Bajalo con el curl del encabezado de este script '
                 '(o pasá --modelo / LAMA_ONNX).')
    h = hashlib.sha256()
    with open(ruta, 'rb') as f:
        for bloque in iter(lambda: f.read(1 << 20), b''):
            h.update(bloque)
    if h.hexdigest() != SHA_MODELO:
        sys.exit(f'el modelo {ruta} no es el esperado (sha256 {h.hexdigest()})')
    import onnxruntime as ort
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 3
    opts.inter_op_num_threads = 1
    return ort.InferenceSession(ruta, opts, providers=['CPUExecutionProvider'])


def reconstruir(rgb, hueco, sesion, lado=512, paso=256, avisar=None):
    """Rellena `hueco` con LaMa en mosaicos de `lado` px apoyados arriba de la imagen (el HUD
    está arriba). El mosaico k sólo escribe su banda central [k·paso, (k+1)·paso)."""
    H, W, _ = rgb.shape
    ys = np.nonzero(hueco)[0]
    if len(ys) == 0:
        return rgb.copy()
    if ys.max() >= lado or H < lado or W < lado:
        raise SystemExit('el hueco no entra en un mosaico apoyado arriba')
    out = rgb.copy()
    falta = hueco.copy()
    for k in range(-(-W // paso)):
        b0, b1 = k * paso, min(W, (k + 1) * paso)
        if not falta[:, b0:b1].any():
            continue
        x0 = int(np.clip((b0 + b1) // 2 - lado // 2, 0, W - lado))
        m = falta[:lado, x0:x0 + lado]
        img = out[:lado, x0:x0 + lado].astype(np.float32) / 255.0
        img[m] = 0
        t = time.time()
        res = sesion.run(None, {'image': img.transpose(2, 0, 1)[None],
                                'mask': m[None, None].astype(np.float32)})[0][0]
        res = res.transpose(1, 2, 0)
        if res.max() <= 1.5:  # algunas exportaciones devuelven 0..1
            res = res * 255.0
        res = np.clip(np.rint(res), 0, 255).astype(np.uint8)
        poner = np.zeros_like(m)
        poner[:, b0 - x0:b1 - x0] = True
        poner &= m
        out[:lado, x0:x0 + lado][poner] = res[poner]
        falta[:lado, x0:x0 + lado][poner] = False
        if avisar:
            avisar(k, x0, time.time() - t)
    if falta.any():
        raise RuntimeError('quedaron píxeles sin rellenar')
    return out


# ─── Medidas y salida ───────────────────────────────────────────────────────

def tono_dominante(rgb, luminosidad=0.13, croma_max=14):
    """Color oscuro dominante para fondos de UI: el grupo más poblado de los tonos oscuros
    (k-means en Lab), llevado a una luminosidad de fondo con la croma acotada."""
    peq = cv2.resize(rgb, (160, 90), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(peq, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    datos = lab[lab[:, 0] < 0.45 * 255]
    if len(datos) < 50:
        datos = lab
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5)
    cv2.setRNGSeed(7)
    _, etq, centros = cv2.kmeans(datos, 4, None, crit, 5, cv2.KMEANS_PP_CENTERS)
    c = centros[int(np.argmax(np.bincount(etq.ravel(), minlength=4)))].copy()
    c[0] = luminosidad * 255
    a, b = c[1] - 128, c[2] - 128
    croma = float(np.hypot(a, b))
    if croma > croma_max:
        c[1], c[2] = 128 + a * croma_max / croma, 128 + b * croma_max / croma
    px = cv2.cvtColor(np.clip(c, 0, 255).reshape(1, 1, 3).astype(np.uint8), cv2.COLOR_LAB2RGB)[0, 0]
    return '#%02x%02x%02x' % tuple(int(v) for v in px)


def exportar(rgb, id_arena, carpeta, ancho_max=1672, calidad=82, ancho_mini=480, calidad_mini=80):
    os.makedirs(carpeta, exist_ok=True)
    im = Image.fromarray(rgb)
    if im.width > ancho_max:
        im = im.resize((ancho_max, round(im.height * ancho_max / im.width)), Image.LANCZOS)
    grande = os.path.join(carpeta, f'{id_arena}.webp')
    im.save(grande, 'WEBP', quality=calidad, method=6)
    mini = im.resize((ancho_mini, round(im.height * ancho_mini / im.width)), Image.LANCZOS)
    chica = os.path.join(carpeta, f'{id_arena}-mini.webp')
    mini.save(chica, 'WEBP', quality=calidad_mini, method=6)
    return [(grande, im.size, os.path.getsize(grande)), (chica, mini.size, os.path.getsize(chica))]


# ─── Hojas de revisión ──────────────────────────────────────────────────────

def hoja_mascara(rgb, mascara, destino, alto):
    vis = rgb[:alto].astype(np.float32).copy()
    m = mascara[:alto]
    vis[m] = vis[m] * 0.35 + np.array([255, 0, 255]) * 0.65
    Image.fromarray(vis.astype(np.uint8)).save(destino)


def hoja_antes_despues(antes, despues, destino, alto, escala=2):
    """La franja de arriba antes y después, ampliada, en dos mitades (izquierda y derecha)."""
    W = antes.shape[1]
    partes = []
    for x0, x1 in ((0, W // 2), (W // 2, W)):
        for img in (antes, despues):
            tira = Image.fromarray(img[:alto, x0:x1])
            partes.append(tira.resize((tira.width * escala, tira.height * escala), Image.NEAREST))
    hoja = Image.new('RGB', (partes[0].width, sum(p.height for p in partes) + 6 * len(partes)), (255, 0, 255))
    y = 0
    for p in partes:
        hoja.paste(p, (0, y))
        y += p.height + 6
    hoja.save(destino)


def silueta(alto):
    """Luchador de prueba (RGBA) de `alto` px, en guardia, si no hay un atlas a mano."""
    w = int(alto * 0.5)
    im = Image.new('RGBA', (w, alto), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = (20, 20, 22, 235)
    cx = w // 2
    cab = alto * 0.07
    d.ellipse([cx - cab, 0, cx + cab, cab * 2.1], fill=c)
    d.rounded_rectangle([cx - alto * 0.12, cab * 2.2, cx + alto * 0.12, alto * 0.55],
                        radius=int(alto * 0.04), fill=c)
    for s in (-1, 1):
        d.polygon([(cx + s * alto * 0.1, alto * 0.53), (cx + s * alto * 0.02, alto * 0.55),
                   (cx + s * alto * 0.17, alto), (cx + s * alto * 0.26, alto)], fill=c)
    d.polygon([(cx + alto * 0.1, alto * 0.25), (cx + alto * 0.24, alto * 0.3),
               (cx + alto * 0.22, alto * 0.36), (cx + alto * 0.08, alto * 0.33)], fill=c)
    return im


def sprite_de_prueba(ruta_atlas, alto):
    """El cuadro 0 de «quieto» de un atlas del juego, escalado a `alto` (pixel art: vecino)."""
    with open(ruta_atlas) as f:
        atlas = json.load(f)
    q = atlas['animaciones']['quieto']['cuadros'][0]
    hoja = Image.open(os.path.join(os.path.dirname(ruta_atlas), atlas['imagen'])).convert('RGBA')
    cuadro = hoja.crop((q['x'], q['y'], q['x'] + q['w'], q['y'] + q['h']))
    esc = alto / atlas.get('alturaReferencia', q['h'])
    cuadro = cuadro.resize((max(1, round(q['w'] * esc)), max(1, round(q['h'] * esc))), Image.NEAREST)
    return cuadro, q['ax'] * esc, q['ay'] * esc


def hoja_siluetas(rgb, cfg, destino, atlas=None):
    """La arena reducida a la vista lógica (960 de ancho) con dos luchadores de 212 px parados
    en `suelo` (x = 30 % y 70 %), su sombra, la línea del piso y las luces marcadas."""
    H, W, _ = rgb.shape
    base = Image.fromarray(rgb).convert('RGBA')
    alto = round(H * ALTURA_LUCHADOR / VISTA_ALTO)
    if atlas and os.path.exists(atlas):
        fig, ax, ay = sprite_de_prueba(atlas, alto)
    else:
        fig = silueta(alto)
        ax, ay = fig.width / 2, fig.height
    ys = round(cfg['suelo'] * H)
    capa = Image.new('RGBA', base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(capa)
    for fx in (0.30, 0.70):
        x = round(fx * W)
        rx, ry = alto * 0.22, alto * 0.035
        d.ellipse([x - rx, ys - ry, x + rx, ys + ry], fill=(0, 0, 0, 110))
    base.alpha_composite(capa)
    for fx, espejo in ((0.30, False), (0.70, True)):
        f = fig.transpose(Image.FLIP_LEFT_RIGHT) if espejo else fig
        axx = (f.width - ax) if espejo else ax
        base.alpha_composite(f, (round(fx * W - axx), round(ys - ay)))
    d = ImageDraw.Draw(base)
    d.line([(0, ys), (W, ys)], fill=(0, 255, 120, 255), width=max(1, H // 400))
    for (lx, ly, lr, color) in cfg.get('luces', []):
        cx, cy, rr = lx * W, ly * H, lr * W
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=color, width=max(2, H // 300))
        d.line([(cx - 6, cy), (cx + 6, cy)], fill=(255, 0, 255), width=2)
        d.line([(cx, cy - 6), (cx, cy + 6)], fill=(255, 0, 255), width=2)
    base.convert('RGB').resize((960, round(H * 960 / W)), Image.LANCZOS).save(destino)


# ─── Principal ──────────────────────────────────────────────────────────────

def procesar(id_arena, args, sesion):
    cfg = CONFIG[id_arena]
    rgb = np.asarray(Image.open(os.path.join(args.fuentes, cfg['fuente'])).convert('RGB')).copy()
    H, W, _ = rgb.shape
    t0 = time.time()
    mascara, barras, (y0, y1) = mascara_hud(rgb, cfg)
    ys = np.nonzero(mascara)[0]
    print(f'[{id_arena}] {W}x{H}  barras x={barras} relleno filas {y0}-{y1}  '
          f'máscara {int(mascara.sum())} px en filas {ys.min()}-{ys.max()} '
          f'({100 * (ys.max() + 1) / H:.1f} % del alto)', flush=True)
    rev = args.revision
    alto_tira = int(min(H, ys.max() + 40))
    if rev:
        os.makedirs(rev, exist_ok=True)
        hoja_mascara(rgb, mascara, os.path.join(rev, f'{id_arena}_mascara.png'), alto_tira)
    if args.solo_mascara:
        return

    def avisar(k, x0, seg):
        print(f'  mosaico {k} (x={x0}) {seg:.1f} s', flush=True)

    limpio = reconstruir(rgb, mascara, sesion, avisar=avisar)
    print(f'  reconstruido en {time.time() - t0:.1f} s')
    if rev:
        hoja_antes_despues(rgb, limpio, os.path.join(rev, f'{id_arena}_antes_despues.png'), alto_tira)
        Image.fromarray(limpio).save(os.path.join(rev, f'{id_arena}_limpia.png'))
        hoja_siluetas(limpio, cfg, os.path.join(rev, f'{id_arena}_siluetas.png'), args.atlas)
    if not args.sin_exportar:
        for ruta, tam, peso in exportar(limpio, id_arena, SALIDA):
            print(f'  -> {os.path.relpath(ruta, RAIZ)} {tam[0]}x{tam[1]} {peso / 1024:.0f} KB')
    print(f'  tono {tono_dominante(limpio)}')


def main():
    ap = argparse.ArgumentParser(description='Arenas de «Corte Final»: HUD afuera, webp adentro.')
    ap.add_argument('arenas', nargs='*', default=list(CONFIG))
    ap.add_argument('--revision', default='', help='carpeta para las hojas de revisión')
    ap.add_argument('--sin-exportar', action='store_true')
    ap.add_argument('--solo-mascara', action='store_true')
    ap.add_argument('--fuentes', default=FUENTES)
    ap.add_argument('--modelo', default=MODELO)
    ap.add_argument('--atlas', default=os.path.join(RAIZ, 'public', 'juego', 'personajes', 'simon', 'atlas.json'),
                    help='atlas para dibujar luchadores de prueba (si no existe, siluetas)')
    args = ap.parse_args()
    for id_arena in args.arenas:
        if id_arena not in CONFIG:
            sys.exit(f'arena desconocida: {id_arena} (hay: {", ".join(CONFIG)})')
    cv2.setNumThreads(2)
    sesion = None if args.solo_mascara else sesion_lama(args.modelo)
    for id_arena in args.arenas:
        procesar(id_arena, args, sesion)


if __name__ == '__main__':
    main()

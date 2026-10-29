#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Atlas de efectos visuales de «Corte Final» (el juego de pelea de Monaco Smart Barber).

Todo se dibuja POR CÓDIGO y en pixel art real, a la resolución final del cuadro:
  - las formas se muestrean a 8x y se umbralizan: borde duro, sin antialias;
  - cada efecto tiene su paleta corta (4–6 tonos más el brillo);
  - los objetos (tijera, sillón, mechones, esquirlas) llevan contorno de 1 px y un
    sombreado de bisel con la luz arriba a la izquierda;
  - los efectos aditivos llevan un núcleo nítido y, debajo, un halo suave
    (desenfoque gaussiano) escalonado en pocos niveles de alfa;
  - las animaciones usan curvas de facilidad: arrancan rápido y se apagan al final.

Salida (por defecto en public/juego/efectos/ del repo):
  efectos.png   atlas RGBA (con 2 px de aire entre cuadros)
  efectos.json  { "version": 1, "imagen": "efectos.png",
                  "animaciones": { "<nombre>": { "cuadros": [ {x, y, w, h, ax, ay} ],
                                                 "mezcla": "normal" | "aditiva", "fps": n } } }
  (ax, ay) es el pivote del cuadro en px: el centro del efecto, salvo «polvo» y «hielo»,
  que lo tienen en el punto que apoya en el piso. Todos los cuadros de una animación
  comparten tamaño y pivote.

Uso:
  python3 scripts/juego/generar_efectos.py                 # escribe en public/juego/efectos/
  python3 scripts/juego/generar_efectos.py --salida DIR    # otra carpeta (para pruebas)

Reproducible: cada efecto usa su propio generador con semilla fija (SEMILLA + crc32 del
nombre), así que agregar o reordenar efectos no cambia a los demás.
Requiere Python 3.9+, numpy, opencv-python (cv2) y Pillow.
"""

import argparse
import json
import math
import sys
import zlib
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

SEMILLA = 20261029
SS = 8                      # submuestreo para rasterizar con borde duro
LUZ2 = np.array([-0.62, -0.78])
LUZ2 = LUZ2 / np.linalg.norm(LUZ2)          # luz arriba a la izquierda (y crece hacia abajo)
LUZ3 = np.array([-0.62, -0.78, 1.0])
LUZ3 = LUZ3 / np.linalg.norm(LUZ3)
TAU = 2 * math.pi


# ════════════════════════════════════════════════════════════════════════════
# Utilidades generales
# ════════════════════════════════════════════════════════════════════════════

def rng_de(nombre):
    """Generador propio de cada efecto: semilla fija + crc32 del nombre (estable entre corridas)."""
    return np.random.default_rng(SEMILLA + zlib.crc32(nombre.encode('utf-8')))


def hx(c):
    c = c.lstrip('#')
    return np.array([int(c[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


def paleta(*cs):
    return np.stack([hx(c) for c in cs])


def mezclar(c1, c2, k):
    return np.asarray(c1, np.float32) * (1 - k) + np.asarray(c2, np.float32) * k


def recortar01(t):
    return min(max(float(t), 0.0), 1.0)


# Curvas de facilidad (t en 0..1)
def salida_cubica(t):
    t = recortar01(t)
    return 1 - (1 - t) ** 3


def unidad(a):
    return np.array([math.cos(a), math.sin(a)])


def perp(u):
    return np.array([-u[1], u[0]])


class Lienzo:
    """Capa RGBA en float con alfa premultiplicado: componer «encima» queda exacto."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.p = np.zeros((h, w, 3), np.float32)
        self.a = np.zeros((h, w), np.float32)

    def pintar(self, alfa, color, opacidad=1.0):
        a = np.clip(np.asarray(alfa, np.float32) * opacidad, 0, 1)
        if a.ndim == 0:
            a = np.full((self.h, self.w), float(a), np.float32)
        c = np.asarray(color, np.float32) / 255.0
        if c.ndim == 1:
            c = c[None, None, :]
        self.p = c * a[..., None] + self.p * (1 - a[..., None])
        self.a = a + self.a * (1 - a)

    def componer(self, otro, opacidad=1.0, dx=0, dy=0):
        """Pone otro Lienzo encima, con su esquina en (dx, dy) (puede ser más chico o salirse)."""
        a = otro.a * opacidad
        p = otro.p * opacidad
        if dx or dy or (otro.w, otro.h) != (self.w, self.h):
            a2 = np.zeros_like(self.a)
            p2 = np.zeros_like(self.p)
            h, w = otro.h, otro.w
            x0, y0 = max(dx, 0), max(dy, 0)
            x1, y1 = min(dx + w, self.w), min(dy + h, self.h)
            if x1 <= x0 or y1 <= y0:
                return
            a2[y0:y1, x0:x1] = a[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
            p2[y0:y1, x0:x1] = p[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
            a, p = a2, p2
        self.p = p + self.p * (1 - a[..., None])
        self.a = a + self.a * (1 - a)

    def escalar_alfa(self, k):
        k = np.asarray(k, np.float32)
        if k.ndim == 2:
            self.p *= k[..., None]
        else:
            self.p *= k
        self.a *= k

    def borrar(self, mascara):
        k = 1.0 - np.clip(np.asarray(mascara, np.float32), 0, 1)
        self.escalar_alfa(k)

    def rgba(self):
        a = self.a
        rgb = np.where(a[..., None] > 1e-6, self.p / np.maximum(a[..., None], 1e-6), 0)
        out = np.dstack([np.clip(rgb * 255 + 0.5, 0, 255), np.clip(a * 255 + 0.5, 0, 255)])
        out = out.astype(np.uint8)
        out[out[..., 3] == 0] = 0       # píxeles transparentes en negro limpio (mejor PNG)
        return out


# ─── Rasterizado con submuestreo ─────────────────────────────────────────────

_GRILLAS = {}


def grilla(w, h, ss=SS):
    """Coordenadas continuas de las submuestras (el píxel (i, j) ocupa [i, i+1) × [j, j+1))."""
    k = (w, h, ss)
    if k not in _GRILLAS:
        xs = (np.arange(w * ss, dtype=np.float32) + 0.5) / ss
        ys = (np.arange(h * ss, dtype=np.float32) + 0.5) / ss
        _GRILLAS[k] = np.meshgrid(xs, ys)
    return _GRILLAS[k]


def centros(w, h):
    """Centros de píxel (i + 0.5)."""
    xs = np.arange(w, dtype=np.float32) + 0.5
    ys = np.arange(h, dtype=np.float32) + 0.5
    return np.meshgrid(xs, ys)


def reducir(b, ss=SS):
    h, w = b.shape[0] // ss, b.shape[1] // ss
    return b.reshape(h, ss, w, ss).mean(axis=(1, 3), dtype=np.float32)


def a_grande(pts, ss=SS):
    """Coordenadas continuas → punto fijo (shift=4) en la grilla grande de OpenCV."""
    p = np.asarray(pts, np.float64) * ss - 0.5
    return np.round(p * 16).astype(np.int32)


def lienzo_g(w, h, ss=SS):
    return np.zeros((h * ss, w * ss), np.uint8)


def poligono_g(big, pts, ss=SS, valor=255):
    cv2.fillPoly(big, [a_grande(pts, ss)], valor, lineType=cv2.LINE_8, shift=4)
    return big


def disco_g(big, cx, cy, r, ss=SS, valor=255):
    if r <= 0:
        return big
    c = a_grande([(cx, cy)], ss)[0]
    cv2.circle(big, (int(c[0]), int(c[1])), int(round(r * ss * 16)), valor, -1,
               lineType=cv2.LINE_8, shift=4)
    return big


def elipse_g(big, cx, cy, rx, ry, rot_grados=0.0, ss=SS, valor=255):
    c = a_grande([(cx, cy)], ss)[0]
    ejes = (int(round(rx * ss * 16)), int(round(ry * ss * 16)))
    cv2.ellipse(big, (int(c[0]), int(c[1])), ejes, rot_grados, 0, 360, valor, -1,
                lineType=cv2.LINE_8, shift=4)
    return big


def trazo_g(big, pts, anchos, ss=SS, puntas=True, valor=255):
    """Trazo de ancho variable: unión de cuadriláteros convexos + discos en las uniones."""
    P = np.asarray(pts, np.float64)
    A = np.broadcast_to(np.asarray(anchos, np.float64), (len(P),))
    for i in range(len(P) - 1):
        p0, p1 = P[i], P[i + 1]
        d = p1 - p0
        L = math.hypot(d[0], d[1])
        if L < 1e-9:
            continue
        n = np.array([-d[1], d[0]]) / L
        quad = [p0 + n * A[i] / 2, p1 + n * A[i + 1] / 2, p1 - n * A[i + 1] / 2, p0 - n * A[i] / 2]
        cv2.fillConvexPoly(big, a_grande(quad, ss), valor, lineType=cv2.LINE_8, shift=4)
    if puntas:
        for i in range(len(P)):
            if A[i] / 2 * ss >= 0.5:
                disco_g(big, P[i][0], P[i][1], A[i] / 2, ss, valor)
    return big


def cob(big, ss=SS):
    return reducir(big.astype(np.float32) / 255.0, ss)


def mascara(big, ss=SS, umbral=0.5):
    return cob(big, ss) >= umbral


def linea_px(w, h, pts, cerrada=False):
    """Línea de 1 px (Bresenham de OpenCV) por coordenadas continuas."""
    img = np.zeros((h, w), np.uint8)
    p = np.round((np.asarray(pts, np.float64) - 0.5) * 16).astype(np.int32)
    cv2.polylines(img, [p], cerrada, 255, 1, lineType=cv2.LINE_8, shift=4)
    return img > 0


def punto_px(m, x, y):
    xi, yi = int(math.floor(x)), int(math.floor(y))
    if 0 <= yi < m.shape[0] and 0 <= xi < m.shape[1]:
        m[yi, xi] = True
    return m


CRUZ = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], np.uint8)
CUADRADO = np.ones((3, 3), np.uint8)


def dilatar(m, k=CRUZ, n=1):
    return cv2.dilate(m.astype(np.uint8), k, iterations=n) > 0


def erosionar(m, k=CRUZ, n=1):
    return cv2.erode(m.astype(np.uint8), k, iterations=n) > 0


def contorno(m, diagonal=False):
    """Contorno exterior de 1 px (4-conexo por defecto: el clásico del pixel art)."""
    return dilatar(m, CUADRADO if diagonal else CRUZ) & ~m


def desenfocar(a, sigma):
    if sigma <= 0:
        return a.astype(np.float32).copy()
    pad = int(math.ceil(sigma * 3)) + 1
    g = np.pad(a.astype(np.float32), pad)
    g = cv2.GaussianBlur(g, (0, 0), sigma)
    return g[pad:-pad, pad:-pad]


def escalonar(a, niveles):
    """Cuantiza el alfa en pocos niveles (bandas de brillo al estilo pixel art)."""
    return np.round(np.clip(a, 0, 1) * niveles) / niveles


def ventana_borde(h, w, margen=4.0):
    """1 adentro, baja a 0 en el borde del cuadro: ningún halo queda cortado en seco."""
    y = np.arange(h, dtype=np.float32) + 0.5
    x = np.arange(w, dtype=np.float32) + 0.5
    fy = np.clip((np.minimum(y, h - y) - 0.5) / margen, 0, 1)
    fx = np.clip((np.minimum(x, w - x) - 0.5) / margen, 0, 1)
    v = np.minimum(fy[:, None], fx[None, :])
    return v * v * (3 - 2 * v)


def ruido_suave(rng, h, w, sigma):
    r = rng.random((h, w)).astype(np.float32)
    r = desenfocar(r, sigma)
    r -= r.min()
    return r / max(r.max(), 1e-6)


def sombreado_bisel(big, bisel, ss=SS, luz=LUZ3, suave=0.5):
    """Sombreado de «almohadón»: el borde que mira a la luz se aclara y el opuesto se oscurece.

    Devuelve (cobertura, s) por píxel; s ≈ 0.71 en lo plano, → 1 hacia la luz, → 0 a la sombra.
    """
    m = (big > 0).astype(np.uint8)
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    d = np.clip(dist / (bisel * ss), 0, 1).astype(np.float32)
    alt = np.sqrt(np.clip(1 - (1 - d) ** 2, 0, 1))          # perfil de borde redondeado
    if suave:
        alt = cv2.GaussianBlur(alt, (0, 0), ss * suave)
    gy, gx = np.gradient(alt)
    esc = bisel * ss * 0.85
    nx, ny = -gx * esc, -gy * esc
    nz = np.ones_like(alt)
    nn = np.sqrt(nx * nx + ny * ny + nz * nz)
    s = (nx * luz[0] + ny * luz[1] + nz * luz[2]) / nn
    mf = m.astype(np.float32)
    c = reducir(mf, ss)
    s_med = reducir(s * mf, ss) / np.maximum(c, 1e-6)
    return c, s_med


def tonos_por_umbral(s, umbrales):
    """Índice de tono según umbrales crecientes de s (0 = el más oscuro)."""
    return np.digitize(s, np.asarray(umbrales, np.float32))


def halo_de(brillo, sigma, ganancia, tope, niveles, colores, cortes, ventana=None):
    """Halo escalonado: desenfoca el brillo del núcleo y lo pinta con una rampa de colores.

    colores[i] se usa donde el desenfoque supera cortes[i] (cortes de mayor a menor).
    Devuelve un Lienzo para poner DEBAJO del núcleo.
    """
    h, w = brillo.shape
    b = desenfocar(brillo, sigma)
    a = np.clip(b * ganancia, 0, tope)
    if ventana is not None:
        a = a * ventana
    a = escalonar(a, niveles)
    col = np.zeros((h, w, 3), np.float32)
    col[:] = colores[-1]
    for c, corte in zip(reversed(colores[:-1]), reversed(cortes)):
        col = np.where((b > corte)[..., None], np.asarray(c, np.float32)[None, None, :], col)
    L = Lienzo(w, h)
    L.pintar(a, col)
    return L


def rotar_pts(pts, ang, centro=(0.0, 0.0)):
    c, s = math.cos(ang), math.sin(ang)
    P = np.asarray(pts, np.float64) - centro
    return np.stack([P[:, 0] * c - P[:, 1] * s, P[:, 0] * s + P[:, 1] * c], 1) + centro


def rect_redondeado(x0, y0, x1, y1, r, n=6):
    """Polígono de un rectángulo con esquinas redondeadas (sentido horario)."""
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    pts = []
    for (cx, cy, a0) in ((x1 - r, y0 + r, -math.pi / 2), (x1 - r, y1 - r, 0.0),
                         (x0 + r, y1 - r, math.pi / 2), (x0 + r, y0 + r, math.pi)):
        for k in range(n + 1):
            a = a0 + (math.pi / 2) * k / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return np.array(pts)


def suave(e0, e1, x):
    """smoothstep de e0 a e1 (vale también decreciente, con e0 > e1)."""
    t = np.clip((np.asarray(x, np.float32) - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def densidad(W, H, bolas, alcance=3.2):
    """Campo de densidad: suma de gaussianas (x, y, r, peso), para nieblas suaves."""
    X, Y = centros(W, H)
    d = np.zeros((H, W), np.float32)
    for x, y, r, w in bolas:
        s = max(r * 0.6, 0.5)
        k = alcance * s
        x0, x1 = max(0, int(x - k)), min(W, int(x + k) + 2)
        y0, y1 = max(0, int(y - k)), min(H, int(y + k) + 2)
        if x1 <= x0 or y1 <= y0:
            continue
        dx = X[y0:y1, x0:x1] - x
        dy = Y[y0:y1, x0:x1] - y
        d[y0:y1, x0:x1] += w * np.exp(-(dx * dx + dy * dy) / (2 * s * s))
    return d


def relieve_bolas(W, H, bolas, suavizar=0.8, ruido=None):
    """Relieve de una nube: la superficie de arriba de varias semiesferas (x, y, r, peso).

    Con la luz arriba a la izquierda, el máximo de semiesferas da el aspecto «coliflor» de las
    nubes y el polvo en pixel art. Devuelve (alto, s): s ≈ 0.71 en lo plano, → 1 hacia la luz.
    """
    X, Y = centros(W, H)
    alt = np.zeros((H, W), np.float32)
    for x, y, r, w in bolas:
        if r <= 0.5:
            continue
        x0, x1 = max(0, int(x - r) - 1), min(W, int(x + r) + 2)
        y0, y1 = max(0, int(y - r) - 1), min(H, int(y + r) + 2)
        if x1 <= x0 or y1 <= y0:
            continue
        q = 1 - ((X[y0:y1, x0:x1] - x) ** 2 + (Y[y0:y1, x0:x1] - y) ** 2) / (r * r)
        h = r * np.sqrt(np.clip(q, 0, 1)) * w
        alt[y0:y1, x0:x1] = np.maximum(alt[y0:y1, x0:x1], h)
    if ruido is not None:
        alt = alt * ruido
    a = desenfocar(alt, suavizar) if suavizar else alt
    gy, gx = np.gradient(a)
    nz = np.ones_like(a) * 0.9
    nn = np.sqrt(gx * gx + gy * gy + nz * nz)
    s = (-gx * LUZ3[0] - gy * LUZ3[1] + nz * LUZ3[2]) / nn
    return alt, s


def destellito(L, x, y, brazo, colores, opacidad=1.0):
    """Destello de 4 puntas: colores[0] en el centro, colores[k] a k píxeles del centro."""
    for k in range(brazo, -1, -1):
        m = np.zeros((L.h, L.w), bool)
        if k == 0:
            punto_px(m, x, y)
        else:
            for dx, dy in ((k, 0), (-k, 0), (0, k), (0, -k)):
                punto_px(m, x + dx, y + dy)
        L.pintar(m, colores[min(k, len(colores) - 1)], opacidad)


def zigzag(p0, p1, tramos, amp, rng, alternar=0.8):
    """Camino quebrado de p0 a p1: quiebres marcados que van y vienen (el rayo de dibujo animado)."""
    p0, p1 = np.asarray(p0, np.float64), np.asarray(p1, np.float64)
    d = p1 - p0
    L = max(math.hypot(d[0], d[1]), 1e-9)
    n = np.array([-d[1], d[0]]) / L
    # tramos parejos (estratificados): sin rulos ni rectas largas
    s = np.r_[0.0, (np.arange(1, tramos) + rng.uniform(-0.3, 0.3, tramos - 1)) / tramos, 1.0]
    lado = 1.0
    off = [0.0]
    for _ in range(tramos - 1):
        if rng.uniform() < alternar:
            lado = -lado
        off.append(lado * rng.uniform(0.35, 1.0) * amp)
    off.append(0.0)
    return p0 + d * s[:, None] + n * np.array(off)[:, None]


def temblor(pts, amp, rng):
    """Subdivide cada tramo una vez con un desvío chico: el quiebre fino del rayo."""
    out = [pts[0]]
    for i in range(len(pts) - 1):
        q0, q1 = pts[i], pts[i + 1]
        d = q1 - q0
        L = max(math.hypot(d[0], d[1]), 1e-9)
        n = np.array([-d[1], d[0]]) / L
        if L > 4:
            out.append((q0 + q1) / 2 + n * rng.uniform(-amp, amp))
        out.append(q1)
    return np.array(out)


# ════════════════════════════════════════════════════════════════════════════
# Efectos
# ════════════════════════════════════════════════════════════════════════════

def huso(W, H, c, ang, r0, r1, ancho, pico=0.25):
    """Rayo afinado: fino en r0, máximo ancho cerca del arranque, punta de 1 px en r1."""
    u = unidad(ang)
    v = perp(u)
    if r1 - r0 < 0.6:
        return np.zeros((H, W), bool)
    rm = r0 + pico * (r1 - r0)
    pts = [c + u * r0, c + u * rm + v * ancho / 2, c + u * r1, c + u * rm - v * ancho / 2]
    m = mascara(poligono_g(lienzo_g(W, H), pts))
    if r1 - r0 > 2:
        m |= linea_px(W, H, [c + u * (r0 + 0.4), c + u * (r1 - 0.6)])
    return m


def efecto_chispa():
    """Chispa de impacto: estallido blanco-amarillo con rayos naranjas (aditiva)."""
    W = H = 48
    c = np.array([24.0, 24.0])
    rng = rng_de('chispa')
    # blanco, amarillo pálido, amarillo, naranja, naranja oscuro, brasa
    R = paleta('#FFFFFF', '#FFF2B0', '#FFD23F', '#FF9419', '#EC5A0B', '#A63408')
    X, Y = centros(W, H)
    rho = np.hypot(X - c[0], Y - c[1])
    ven = ventana_borde(H, W, 4)

    giro = rng.uniform(0, math.pi / 2)
    ang_p = giro + np.arange(4) * math.pi / 2 + rng.uniform(-0.14, 0.14, 4)
    nsec = 14
    ang_s = giro + (np.arange(nsec) + rng.uniform(0.25, 0.75, nsec)) * (TAU / nsec)
    largo_s = rng.uniform(0.42, 0.86, nsec)
    largo_p = rng.uniform(0.93, 1.0, 4)
    npar = 10
    ang_c = (np.arange(npar) + rng.uniform(0, 1, npar)) * (TAU / npar)
    dist_c = rng.uniform(13.5, 21.0, npar)

    # núcleo, arranque y punta de los rayos, ancho, cuánto de los secundarios, «calor» (corre la
    # rampa hacia el naranja) y fuerza del halo
    T = [
        dict(nuc=3.0, rin=0.0, rout=14.5, ancho=3.0, sec=0.8, calor=0.00, halo=1.00),
        dict(nuc=4.5, rin=0.0, rout=22.0, ancho=2.6, sec=1.0, calor=0.06, halo=1.00),
        dict(nuc=3.0, rin=3.5, rout=22.0, ancho=2.1, sec=0.9, calor=0.30, halo=0.68),
        dict(nuc=1.6, rin=9.0, rout=21.5, ancho=1.6, sec=0.6, calor=0.55, halo=0.38),
        dict(nuc=0.8, rin=14.0, rout=21.0, ancho=1.2, sec=0.0, calor=0.80, halo=0.17),
        dict(nuc=0.0, rin=17.5, rout=20.5, ancho=1.0, sec=0.0, calor=1.00, halo=0.05),
    ]
    cuadros = []
    for f, t in enumerate(T):
        rayos = np.zeros((H, W), bool)
        for k, a in enumerate(ang_p):
            rout = t['rin'] + (t['rout'] - t['rin']) * largo_p[k]
            rayos |= huso(W, H, c, a, t['rin'], rout, t['ancho'])
        if t['sec'] > 0:
            for k, a in enumerate(ang_s):
                rin = t['rin'] * 0.85
                rout = rin + (t['rout'] - rin) * largo_s[k] * t['sec']
                rayos |= huso(W, H, c, a, rin, rout, t['ancho'] * 0.55)
        bordes = np.array([4.5, 8.0, 12.5, 17.0]) * (1 - 0.5 * t['calor'])
        idx = np.clip(np.digitize(rho, bordes) + (1 if t['calor'] > 0.7 else 0), 0, 5)

        capas_nuc = []
        nucleo = np.zeros((H, W), np.float32)
        if t['nuc'] > 0:
            for r, ci in ((t['nuc'] + 2.0, 2), (t['nuc'] + 1.0, 1), (t['nuc'], 0)):
                m = mascara(disco_g(lienzo_g(W, H), c[0], c[1], r))
                capas_nuc.append((m, R[min(ci + (1 if t['calor'] > 0.5 else 0), 5)]))
                nucleo = np.maximum(nucleo, m * (1.0 - 0.12 * ci))

        part = np.zeros((H, W), bool)
        if f >= 1:
            k = (f - 1) / (len(T) - 2)
            for a, d in zip(ang_c, dist_c):
                u = unidad(a)
                r = 5 + (d - 5) * salida_cubica(k)
                if f <= 2:
                    part |= linea_px(W, H, [c + u * (r - 2.6), c + u * r])
                else:
                    punto_px(part, *(c + u * r))
        col_part = R[min(f, 5)] if f > 1 else R[0]

        peso = np.array([1.0, 0.92, 0.78, 0.6, 0.42, 0.28], np.float32)
        brillo = np.maximum(rayos * peso[idx], nucleo) + part * 0.5
        L = halo_de(brillo, 2.2, 1.5 * t['halo'], 0.75, 7,
                    [R[1], R[2], R[3], R[4]], [0.5, 0.27, 0.11], ven)
        L.pintar(rayos, R[idx])
        for m, colr in capas_nuc:
            L.pintar(m, colr)
        L.pintar(part, col_part)
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=24, ay=24, mezcla='aditiva', fps=24)


def efecto_chispa_critica():
    """Crítico: estallido dorado grande con anillo, destellos en cruz y chispas (aditiva)."""
    W = H = 96
    c = np.array([48.0, 48.0])
    rng = rng_de('chispa_critica')
    # blanco, oro pálido, oro (Simón), naranja (Simón), naranja quemado, brasa
    R = paleta('#FFFFFF', '#FFF0A6', '#F5B301', '#FF6A00', '#D9480A', '#8E2A06')
    X, Y = centros(W, H)
    rho = np.hypot(X - c[0], Y - c[1])
    th = np.arctan2(Y - c[1], X - c[0])
    ven = ventana_borde(H, W, 5)

    giro = rng.uniform(0, TAU)
    nr = 18
    ang_r = giro + (np.arange(nr) + rng.uniform(0.15, 0.85, nr)) * (TAU / nr)
    principal = np.arange(nr) % 3 == 0
    largo_r = np.where(principal, rng.uniform(0.92, 1.0, nr), rng.uniform(0.5, 0.8, nr))
    npar = 16
    ang_c = (np.arange(npar) + rng.uniform(0, 1, npar)) * (TAU / npar)
    dist_c = rng.uniform(26, 43, npar)
    # destellos de 4 puntas: (ángulo, radio, cuadro en que nacen)
    dest = [(rng.uniform(0, TAU), rng.uniform(18, 40), int(rng.integers(2, 6))) for _ in range(7)]
    huecos = rng.uniform(0, 1, 64)

    T = [
        dict(nuc=7.0, rin=0, rout=22, ancho=5.0, sec=0.8, cruz=24, cw=3.0, ar=0, at=0, hueco=0, calor=0.0, halo=1.0),
        dict(nuc=9.5, rin=0, rout=42, ancho=4.2, sec=1.0, cruz=44, cw=3.4, ar=15, at=3.0, hueco=0, calor=0.05, halo=1.0),
        dict(nuc=7.0, rin=9, rout=43, ancho=3.0, sec=0.75, cruz=40, cw=2.8, ar=23, at=2.4, hueco=0, calor=0.25, halo=0.7),
        dict(nuc=4.5, rin=17, rout=43, ancho=2.4, sec=0.5, cruz=32, cw=2.2, ar=30, at=2.0, hueco=0.08, calor=0.45, halo=0.5),
        dict(nuc=3.0, rin=25, rout=42, ancho=1.8, sec=0.0, cruz=22, cw=1.6, ar=35, at=1.8, hueco=0.25, calor=0.64, halo=0.32),
        dict(nuc=1.5, rin=31, rout=40, ancho=1.3, sec=0.0, cruz=13, cw=1.1, ar=39, at=1.3, hueco=0.45, calor=0.84, halo=0.16),
        dict(nuc=0.0, rin=35, rout=38.5, ancho=1.0, sec=0.0, cruz=0, cw=0, ar=42, at=1.0, hueco=0.65, calor=1.0, halo=0.06),
    ]
    cuadros = []
    for f, t in enumerate(T):
        rayos = np.zeros((H, W), bool)
        for k, a in enumerate(ang_r):
            if not principal[k] and t['sec'] <= 0:
                continue
            esc = 1.0 if principal[k] else t['sec']
            rout = t['rin'] + (t['rout'] - t['rin']) * largo_r[k] * esc
            w = t['ancho'] * (1.0 if principal[k] else 0.55)
            rayos |= huso(W, H, c, a, t['rin'], rout, w)
        bordes = np.array([8.0, 15.0, 25.0, 35.0]) * (1 - 0.45 * t['calor'])
        idx_r = np.clip(np.digitize(rho, bordes) + (1 if t['calor'] > 0.75 else 0), 0, 5)

        # destello en cruz (horizontal y vertical largos, diagonales cortos)
        cruz = np.zeros((H, W), bool)
        if t['cruz'] > 0:
            for a, lk, wk in ((0, 1, 1), (math.pi / 2, 1, 1), (math.pi / 4, 0.55, 0.65),
                              (3 * math.pi / 4, 0.55, 0.65)):
                for s in (0, math.pi):
                    cruz |= huso(W, H, c, a + s, 0, t['cruz'] * lk, t['cw'] * 2 * wk, pico=0.0)
        idx_c = np.clip(np.digitize(rho, np.array([0.3, 0.6, 0.85]) * max(t['cruz'], 1)), 0, 3)
        idx_c = np.clip(idx_c + (1 if t['calor'] > 0.4 else 0), 0, 4)

        anillo = np.zeros((H, W), bool)
        if t['ar'] > 0:
            g = lienzo_g(W, H)
            disco_g(g, c[0], c[1], t['ar'])
            disco_g(g, c[0], c[1], t['ar'] - t['at'], valor=0)
            anillo = mascara(g)
            if t['hueco'] > 0:
                seg = ((th + math.pi) / TAU * 64).astype(int) % 64
                anillo &= huecos[seg] >= t['hueco']
        idx_a = min(int(round(t['calor'] * 4.2)), 5)

        nucleo = []
        brillo_n = np.zeros((H, W), np.float32)
        if t['nuc'] > 0:
            for r, ci in ((t['nuc'] + 3.0, 2), (t['nuc'] + 1.5, 1), (t['nuc'], 0)):
                m = mascara(disco_g(lienzo_g(W, H), c[0], c[1], r))
                nucleo.append((m, R[min(ci + (1 if t['calor'] > 0.5 else 0), 5)]))
                brillo_n = np.maximum(brillo_n, m * (1.0 - 0.15 * ci))

        part = np.zeros((H, W), bool)
        if f >= 1:
            k = (f - 1) / (len(T) - 2)
            for a, d in zip(ang_c, dist_c):
                u = unidad(a)
                r = 10 + (d - 10) * salida_cubica(k)
                if f <= 3:
                    part |= linea_px(W, H, [c + u * (r - 3.2), c + u * r])
                else:
                    punto_px(part, *(c + u * r))
        col_part = R[min(f, 5)] if f > 1 else R[0]

        peso = np.array([1.0, 0.9, 0.72, 0.55, 0.4, 0.28], np.float32)
        brillo = np.maximum.reduce([rayos * peso[idx_r], cruz * peso[idx_c], anillo * peso[idx_a],
                                    brillo_n]) + part * 0.4
        L = halo_de(brillo, 4.0, 1.7 * t['halo'], 0.8, 8,
                    [R[1], R[2], R[3], R[4]], [0.48, 0.26, 0.1], ven)
        L.pintar(rayos, R[idx_r])
        L.pintar(anillo, R[idx_a])
        L.pintar(cruz, R[idx_c])
        for m, colr in nucleo:
            L.pintar(m, colr)
        L.pintar(part, col_part)
        # destellos dorados de 4 puntas que titilan
        for a, r, nace in dest:
            edad = f - nace
            if 0 <= edad <= 2:
                p = c + unidad(a) * (r + edad * 2.0)
                brazo = (3, 2, 1)[edad]
                destellito(L, p[0], p[1], brazo, [R[0], R[1], R[2], R[3]])
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=48, ay=48, mezcla='aditiva', fps=20)


def norma_hex(dx, dy):
    """«Radio» hexagonal (hexágono con punta arriba): max de |p·n| sobre las 3 normales."""
    return np.maximum.reduce([np.abs(dx), np.abs(0.5 * dx + 0.8660254 * dy),
                              np.abs(0.5 * dx - 0.8660254 * dy)])


def efecto_bloqueo():
    """Guardia: escudo hexagonal facetado blanco-celeste que se abre en seis y se desvanece (aditiva)."""
    W = H = 56
    cx = cy = 28.0
    rng = rng_de('bloqueo')
    # blanco, celeste pálido, celeste, azul, azul hondo
    R = paleta('#FFFFFF', '#CFF6FF', '#62DAFF', '#2F8DFF', '#1F52C4')
    Xs, Ys = grilla(W, H)
    X, Y = centros(W, H)
    ven = ventana_borde(H, W, 3)
    th = np.arctan2(Y - cy, X - cx)
    # faceta = la normal de lado más cercana (lados con normales a 0°, 60°, ...: hexágono con punta arriba)
    faceta = np.round(th / (math.pi / 3)).astype(int) % 6
    luz_f = np.array([math.cos(k * math.pi / 3) * LUZ2[0] + math.sin(k * math.pi / 3) * LUZ2[1]
                      for k in range(6)])
    tono_f = np.where(luz_f > 0.5, 1, np.where(luz_f > -0.1, 2, np.where(luz_f > -0.6, 3, 4)))
    alfa_f = np.where(luz_f > 0.5, 0.85, np.where(luz_f > -0.1, 0.7, np.where(luz_f > -0.6, 0.55, 0.45)))
    npar = 10
    ang_c = (np.arange(npar) + rng.uniform(0, 1, npar)) * (TAU / npar)
    dist_c = rng.uniform(17, 25, npar)

    def hex_lleno(Rr):
        return mascara((norma_hex(Xs - cx, Ys - cy) <= Rr * 0.8660254).astype(np.uint8) * 255)

    T = [
        dict(R=10.5, d=0.0, enc=1.0, t=1.0, fac=1.0, cara=1.0, rayos=1.0, halo=1.0),
        dict(R=17.0, d=0.0, enc=1.0, t=2.0, fac=0.75, cara=0.85, rayos=1.0, halo=0.9),
        dict(R=21.0, d=1.0, enc=0.92, t=2.0, fac=0.32, cara=0.35, rayos=0.55, halo=0.6),
        dict(R=23.0, d=2.6, enc=0.7, t=1.4, fac=0.08, cara=0.0, rayos=0.0, halo=0.34),
        dict(R=24.0, d=4.0, enc=0.42, t=1.0, fac=0.0, cara=0.0, rayos=0.0, halo=0.14),
    ]
    cuadros = []
    for f, t in enumerate(T):
        Rr = t['R']
        Rin = Rr * 0.8660254
        lleno = hex_lleno(Rr)
        # bordes: seis lados que se separan hacia afuera (cada uno por su normal)
        borde = np.zeros((H, W), bool)
        for k in range(6):
            a = k * math.pi / 3
            n = (math.cos(a), math.sin(a))
            pn = (Xs - cx) * n[0] + (Ys - cy) * n[1]
            pt = -(Xs - cx) * n[1] + (Ys - cy) * n[0]
            g = (pn <= Rin + t['d']) & (pn >= Rin + t['d'] - t['t']) & (np.abs(pt) <= Rr / 2 * t['enc'])
            borde |= mascara(g.astype(np.uint8) * 255)
        cara = hex_lleno(Rr * 0.44)
        cara_borde = cara & ~erosionar(cara)
        rayos = np.zeros((H, W), bool)
        if t['rayos'] > 0:
            for k in range(6):
                a = math.pi / 6 + k * math.pi / 3              # vértices (30°, 90°, ...)
                rayos |= linea_px(W, H, [(cx + Rr * 0.44 * math.cos(a), cy + Rr * 0.44 * math.sin(a)),
                                         (cx + (Rr - 1) * math.cos(a), cy + (Rr - 1) * math.sin(a))])
            rayos &= lleno
        part = np.zeros((H, W), bool)
        if f >= 1:
            k = (f - 1) / (len(T) - 2)
            for a, d in zip(ang_c, dist_c):
                punto_px(part, *(np.array([cx, cy]) + unidad(a) * (9 + (d - 9) * salida_cubica(k))))

        facetas = lleno & ~cara
        brillo = (facetas * t['fac'] * 0.55 + cara * t['cara'] * 0.9 + borde * 1.0 + rayos * 0.7)
        L = halo_de(brillo, 2.2, 1.5 * t['halo'], 0.75, 6, [R[1], R[2], R[3], R[4]],
                    [0.45, 0.22, 0.08], ven)
        if f == 0:
            L.pintar(facetas, R[np.clip(tono_f[faceta] - 1, 0, 4)])
            L.pintar(cara, R[0])
        else:
            if t['fac'] > 0:
                L.pintar(facetas, R[tono_f[faceta]], alfa_f[faceta] * t['fac'])
            if t['cara'] > 0:
                L.pintar(cara, R[1], 0.8 * t['cara'])
                L.pintar(cara_borde, R[0], t['cara'])
            L.pintar(rayos, R[1], t['rayos'])
            L.pintar(borde, R[0] if f <= 1 else (R[1] if f == 2 else R[2]))
        L.pintar(part, R[min(f, 3)] if f > 1 else R[0])
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=28, ay=28, mezcla='aditiva', fps=20)


# ─── Mechones de pelo ────────────────────────────────────────────────────────

RAMPAS_PELO = {
    # contorno, oscuro, medio, claro, brillo
    'castano': paleta('#1E1209', '#40281A', '#6B4428', '#98653A', '#C48E57'),
    'negro': paleta('#070608', '#1B191F', '#2E2B34', '#4A4653', '#6F6A7A'),
    'rubio': paleta('#3A2810', '#8C6526', '#C49A45', '#E2BF69', '#F7E3A1'),
}


def mechon(rng, rampa, W=24, H=24, largo=15.0, flecha=3.0, ancho=3.2, rizo=0.0, puntas=1, ese=False):
    """Mechón de pelo cortado: un trazo curvo con el corte romo, la punta fina y abierta en hebras.

    rizo > 0 lo enrula: un arco en «C» de `rizo` vueltas que se cierra un poco (rulo), como
    el pelo de Simón. ese=True lo hace ondulado (en S) en vez de arqueado.
    """
    L = Lienzo(W, H)
    c = np.array([W / 2, H / 2])
    ang = rng.uniform(0, TAU)
    sgn = 1 if rng.uniform() < 0.5 else -1
    s = np.linspace(0, 1, 44)
    afuera_ref = None
    if rizo <= 0:
        u, v = unidad(ang), perp(unidad(ang))
        x = (s - 0.5) * largo
        if ese:
            y = flecha * sgn * np.sin(TAU * s) * 0.55
        else:
            y = flecha * sgn * (1 - (2 * s - 1) ** 2) - flecha * sgn * 0.5
        pts = c + u * x[:, None] + v * y[:, None]
        afuera_ref = v * sgn
    else:
        # rulo: arco en «C» que se cierra un poco (espiral corta), corte romo en un extremo
        R0 = largo / (rizo * TAU)
        th = ang + sgn * s * rizo * TAU
        r = R0 * (1.18 - 0.36 * s)
        pts = np.stack([r * np.cos(th), r * np.sin(th)], 1)
        pts = c + pts - (pts.min(0) + pts.max(0)) / 2
    w = ancho * np.clip((1 - s) ** 0.75, 0.12, 1) * np.clip(s * 6 + 0.55, 0, 1)
    big = trazo_g(lienzo_g(W, H), pts, w)
    cobt, sh = sombreado_bisel(big, 1.3)
    m = (cobt >= 0.5) | linea_px(W, H, pts[2:-1])
    idx = tonos_por_umbral(sh, (0.5, 0.68, 0.86)) + 1          # 1 (oscuro) .. 4 (brillo)
    L.pintar(m, rampa[np.clip(idx, 1, 4)])
    union = m.copy()
    # hebras oscuras por adentro, siguiendo la curva
    tg = np.gradient(pts, axis=0)
    tg /= np.linalg.norm(tg, axis=1, keepdims=True) + 1e-9
    nrm = np.stack([-tg[:, 1], tg[:, 0]], 1)
    adentro = erosionar(m)
    for off, a0, a1 in ((0.28, 0.12, 0.62), (-0.25, 0.3, 0.75)):
        q = pts + nrm * (w[:, None] * off)
        i0, i1 = int(len(q) * a0), int(len(q) * a1)
        L.pintar(linea_px(W, H, q[i0:i1]) & adentro, rampa[1])
    # punta abierta: hebras finas que se separan apenas, con la misma curva que el resto
    for j in range(puntas if afuera_ref is not None else 0):
        s0 = (0.52, 0.64)[j]
        i0 = int(len(pts) * s0)
        lado = 1 if np.dot(nrm[i0], afuera_ref) > 0 else -1
        if j == 1:
            lado = -lado
        resto = pts[i0:] - pts[i0]
        q = rotar_pts(resto, lado * (0.2 if j == 0 else 0.14)) * 0.92 + pts[i0] + nrm[i0] * lado * w[i0] * 0.25
        bq = trazo_g(lienzo_g(W, H), q, np.linspace(1.6, 0.3, len(q)))
        mq = (mascara(bq, umbral=0.45) | linea_px(W, H, q[1:-1])) & ~union
        L.pintar(mq, rampa[2 + (j % 2)])
        union |= mq
    L.pintar(contorno(union), rampa[0])
    return L


def efecto_mechones():
    """10 mechones sueltos (no es animación): castaños, negros y rubios, lacios y con rulos."""
    rng = rng_de('mechones')
    receta = [
        ('castano', dict(largo=17, rizo=0.62, ancho=3.2)),
        ('castano', dict(largo=17, flecha=3.0, ancho=3.4, puntas=2)),
        ('castano', dict(largo=14, rizo=0.7, ancho=2.8)),
        ('castano', dict(largo=13, flecha=2.4, ancho=3.0, puntas=1, ese=True)),
        ('negro', dict(largo=18, flecha=3.4, ancho=3.4, puntas=2)),
        ('negro', dict(largo=16, rizo=0.6, ancho=3.0)),
        ('negro', dict(largo=13, flecha=2.6, ancho=2.8, puntas=1)),
        ('rubio', dict(largo=16, flecha=3.0, ancho=3.2, puntas=2)),
        ('rubio', dict(largo=15, rizo=0.66, ancho=2.8)),
        ('castano', dict(largo=11, flecha=1.8, ancho=2.6, puntas=1)),
    ]
    cuadros = [mechon(rng, RAMPAS_PELO[color], **kw).rgba() for color, kw in receta]
    return dict(cuadros=cuadros, ax=12, ay=12, mezcla='normal', fps=0)


# ─── Rayo y arcos eléctricos ─────────────────────────────────────────────────

def _electrico(W, H, ramas, R, ven, halo_k=1.0, sigma=2.6, borde_alfa=0.9):
    """Pinta caminos eléctricos. ramas = [(pts, nivel, grueso)]: nivel 0 principal, 1 rama, 2 ramita."""
    nucleo0 = np.zeros((H, W), bool)     # blanco
    cuerpo = np.zeros((H, W), bool)      # amarillo pálido (tronco grueso)
    nucleo1 = np.zeros((H, W), bool)     # amarillo pálido (ramas)
    nucleo2 = np.zeros((H, W), bool)     # oro (ramitas)
    for pts, nivel, grueso in ramas:
        lin = linea_px(W, H, pts)
        if nivel == 0:
            nucleo0 |= lin
            if grueso:
                cuerpo |= dilatar(lin)
        elif nivel == 1:
            nucleo1 |= lin
        else:
            nucleo2 |= lin
    todo = nucleo0 | cuerpo | nucleo1 | nucleo2
    borde_oro = dilatar(nucleo0 | cuerpo | nucleo1) & ~todo
    borde_nar = dilatar(nucleo2) & ~todo & ~borde_oro
    brillo = (nucleo0 * 1.0 + cuerpo * 0.9 + nucleo1 * 0.85 + nucleo2 * 0.6 + borde_oro * 0.4)
    L = halo_de(brillo, sigma, 1.25 * halo_k, 0.7, 6, [R[2], R[3], R[4]], [0.3, 0.12], ven)
    L.pintar(borde_nar, R[4], 0.7 * borde_alfa)
    L.pintar(borde_oro, R[3], borde_alfa)
    L.pintar(nucleo2, R[3])
    L.pintar(cuerpo, R[1])
    L.pintar(nucleo1, R[1])
    L.pintar(nucleo0, R[0])
    return L


def efecto_rayo():
    """Rayo dorado/blanco, quebrado y ramificado (estela del Corte Relámpago), 4 parpadeos (aditiva)."""
    W, H = 40, 130
    rng = rng_de('rayo')
    R = paleta('#FFFFFF', '#FFF3B0', '#FFD84D', '#F5B301', '#FF6A00')
    ven = ventana_borde(H, W, 4)
    cuadros = []
    for f in range(4):
        x0 = 20 + rng.uniform(-3, 3)
        x1 = 20 + rng.uniform(-3, 3)
        tronco = zigzag((x0, 3.5), (x1, 126.5), int(rng.integers(11, 15)), 7.0, rng)
        tronco = temblor(tronco, 1.3, rng)
        tronco[:, 0] = np.clip(tronco[:, 0], 10, 30)
        corte = int(len(tronco) * 0.7)
        ramas = [(tronco[:corte + 1], 0, True), (tronco[corte:], 0, False)]
        for _ in range(int(rng.integers(3, 5))):
            i0 = int(rng.integers(len(tronco) // 6, int(len(tronco) * 0.8)))
            p0 = tronco[i0]
            lado = -1 if p0[0] > 20 else 1
            if rng.uniform() < 0.25:
                lado = -lado
            ang = math.pi / 2 - lado * rng.uniform(0.28, 0.62)
            largo = rng.uniform(16, 36)
            p1 = p0 + unidad(ang) * largo
            p1[0] = np.clip(p1[0], 9, 31)
            p1[1] = min(p1[1], 125)
            rama = zigzag(p0, p1, int(rng.integers(4, 7)), 3.2, rng)
            rama[:, 0] = np.clip(rama[:, 0], 9, 31)
            ramas.append((rama, 1, False))
            if rng.uniform() < 0.75:
                j = int(rng.integers(1, len(rama) - 1))
                q0 = rama[j]
                q1 = q0 + unidad(ang + lado * rng.uniform(0.3, 0.7)) * rng.uniform(5, 10)
                q1[0] = np.clip(q1[0], 9, 31)
                ramas.append((zigzag(q0, q1, 3, 1.6, rng), 2, False))
        L = _electrico(W, H, ramas, R, ven, halo_k=(1.0, 0.9, 1.0, 0.85)[f], sigma=2.2)
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=20, ay=65, mezcla='aditiva', fps=20)


def efecto_arco_electrico():
    """Arcos eléctricos chicos dorado-blancos alrededor de un punto (electrocutado), en loop (aditiva)."""
    W = H = 44
    c = np.array([22.0, 22.0])
    rng = rng_de('arco_electrico')
    R = paleta('#FFFFFF', '#FFF3B0', '#FFD84D', '#F5B301', '#FF6A00')
    ven = ventana_borde(H, W, 3)
    cuadros = []
    for f in range(4):
        ramas = []
        narcos = 3 if f % 2 == 0 else 2
        a_base = rng.uniform(0, TAU)
        for k in range(narcos):
            a0 = a_base + k * TAU / narcos + rng.uniform(-0.35, 0.35)
            span = rng.uniform(1.0, 1.7)
            R0 = rng.uniform(9.0, 13.5)
            n = int(rng.integers(7, 10))
            s = np.linspace(0, 1, n)
            ang = a0 + span * s
            alt = np.array([(1 if i % 2 else -1) for i in range(n)]) * rng.uniform(0.6, 1.0, n) * 1.9
            alt[0] = alt[-1] = 0
            rr = np.clip(R0 + 2.2 * np.sin(math.pi * s) * rng.choice([-1, 1]) + alt, 5, 16.5)
            pts = c + np.stack([rr * np.cos(ang), rr * np.sin(ang)], 1)
            ramas.append((pts, 0 if k == 0 else 1, False))
            if rng.uniform() < 0.75:
                j = int(rng.integers(2, n - 2))
                q0 = pts[j]
                q1 = q0 + unidad(ang[j] + rng.choice([-1, 1]) * rng.uniform(0.5, 1.1)) * rng.uniform(3.5, 6)
                d = q1 - c
                if np.hypot(*d) > 17:
                    q1 = c + d / np.hypot(*d) * 17
                ramas.append((zigzag(q0, q1, 3, 1.2, rng), 2, False))
        L = _electrico(W, H, ramas, R, ven, halo_k=0.9, sigma=1.6, borde_alfa=0.55)
        ch = np.zeros((H, W), bool)
        for _ in range(3):
            p = c + unidad(rng.uniform(0, TAU)) * rng.uniform(6, 17)
            punto_px(ch, *p)
        L.pintar(ch, R[1])
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=22, ay=22, mezcla='aditiva', fps=16)


# ─── Tijera (también se usa adentro del tornado) ────────────────────────────

PAL_ACERO = paleta('#12141A', '#2F3542', '#5C6577', '#949EB0', '#CBD3DE', '#FFFFFF')
PAL_ORO = paleta('#5A3B00', '#A87400', '#F5B301', '#FFE27A')


def _palanca_tijera(lado, apertura=0.27):
    """Una de las dos piezas de la tijera (hoja + caña + anillo), en coordenadas locales.

    El tornillo está en (0, 0) y las puntas miran a +x. lado=+1 es la hoja de arriba.
    """
    a = -lado * apertura
    u = unidad(a)
    afuera = -lado * perp(u)
    # hoja: filo recto del lado de adentro, lomo convexo del lado de afuera
    us = np.array([-0.6, 2.0, 5.0, 8.0, 10.4, 12.0, 12.9])
    ws = np.array([1.35, 1.85, 1.8, 1.45, 0.95, 0.42, 0.0])
    lomo = [u * x + afuera * w for x, w in zip(us, ws)]
    filo = [u * 12.9, u * -0.6 - afuera * 0.85]
    hoja = np.array(lomo + filo)
    # caña y anillo: siguen la hoja del otro lado del tornillo y se abren hacia afuera
    centro_anillo = np.array([-8.4, lado * 3.75])
    cana = [np.array([0.0, 0.0]), -u * 3.5, centro_anillo + np.array([2.6, -lado * 0.9])]
    return hoja, np.array(cana), centro_anillo


def capa_tijera(ang, escala=1.0, tam=None, pal=PAL_ACERO, oro=PAL_ORO, apertura=0.27,
                oscurecer=0.0, centro=None):
    """Dibuja una tijera abierta rotada `ang` (radianes, horario) en un Lienzo chico.

    Devuelve (Lienzo, (cx, cy)) con el tornillo en (cx, cy) del lienzo. El sombreado se
    calcula después de rotar, así la luz siempre viene de arriba a la izquierda.
    """
    if tam is None:
        tam = int(math.ceil(30 * escala)) + 4
    W = H = tam
    if centro is None:
        centro = (W / 2, H / 2)
    cxy = np.array(centro, np.float64)
    piezas = []
    for lado in (-1, 1):            # primero la de abajo, después la de arriba (queda encima)
        hoja, cana, ca = _palanca_tijera(lado, apertura)
        tr = lambda P: rotar_pts(np.asarray(P) * escala, ang) + cxy
        big = lienzo_g(W, H)
        poligono_g(big, tr(hoja))
        trazo_g(big, tr(cana), 1.9 * escala)
        anillo_c = tr([ca])[0]
        disco_g(big, anillo_c[0], anillo_c[1], 3.25 * escala)
        disco_g(big, anillo_c[0], anillo_c[1], 1.75 * escala, valor=0)
        if lado == 1:
            # gancho de apoyo del dedo (tijera de peluquero)
            gancho = tr([ca + np.array([-1.0, 2.6]), ca + np.array([-3.4, 4.6]), ca + np.array([-4.6, 4.2])])
            trazo_g(big, gancho, [1.4 * escala, 1.1 * escala, 0.8 * escala])
        piezas.append(big)
    L = Lienzo(W, H)
    union = np.zeros((H, W), bool)
    for big in piezas:
        c, s = sombreado_bisel(big, 1.25 * escala + 0.15, suave=0.35)
        m = c >= 0.5
        idx = tonos_por_umbral(s, (0.30, 0.52, 0.72, 0.9)) + 1      # 1..5
        col = pal[np.clip(idx, 1, 5)]
        if oscurecer > 0:
            col = mezclar(col, pal[1], oscurecer)
        L.pintar(contorno(m), pal[0])
        L.pintar(m, col)
        union |= m
    # tornillo dorado
    tor = mascara(disco_g(lienzo_g(W, H), cxy[0], cxy[1], max(1.15 * escala, 0.9)))
    L.pintar(tor, oro[2] if oscurecer < 0.3 else mezclar(oro[2], oro[0], oscurecer))
    L.pintar(contorno(tor) & union, oro[0])
    brillo_t = np.zeros((H, W), bool)
    punto_px(brillo_t, cxy[0] - 0.5, cxy[1] - 0.5)
    L.pintar(brillo_t & tor, oro[3])
    L.pintar(contorno(union), pal[0])
    return L, (cxy[0], cxy[1])


def efecto_tijera():
    """Tijera de peluquero abierta en 8 rotaciones (cada 45°, sentido horario; el cuadro 0 apunta a la derecha)."""
    W = H = 28
    cuadros = []
    for k in range(8):
        L, _ = capa_tijera(k * math.pi / 4, escala=0.8, tam=W, centro=(14.0, 14.0))
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=14, ay=14, mezcla='normal', fps=16)


# ─── Tornado de tijeras ──────────────────────────────────────────────────────

def efecto_tornado():
    """Torbellino blanco-gris azulado que gira con tijeras metidas en la espiral (6 cuadros en loop)."""
    W, H = 110, 150
    rng = rng_de('tornado')
    # blanco, pálido, claro, medio, oscuro, hondo
    R = paleta('#FFFFFF', '#E6EEF7', '#BACADC', '#8B9CB4', '#5D6C86', '#3A4660')
    PELO = paleta('#2A1A0E', '#5A3A22')
    ven = ventana_borde(H, W, 5)
    y_top, y_bot = 12.0, 141.0
    X, Y = centros(W, H)

    def radio(u):
        return 8.0 + 35.0 * np.clip(u, 0, 1) ** 1.12

    def eje(u, f):
        return 55.0 + 3.0 * np.sin(TAU * (u * 0.9 + f / 6.0))

    def u_de_y(y):
        return (y_bot - y) / (y_bot - y_top)

    def y_de_u(u):
        return y_bot - u * (y_bot - y_top)

    nv = 60
    vetas = []
    for i in range(nv):
        vetas.append(dict(u=(i + rng.uniform(0.1, 0.9)) / nv, rf=rng.uniform(0.82, 1.04),
                          arco=rng.uniform(1.3, 3.4), fase=rng.uniform(0, TAU), paso=rng.uniform(5, 10),
                          grosor=rng.choice([1.5, 2.5, 3.5], p=[0.3, 0.4, 0.3])))
    tijeras = []
    for k, u in enumerate((0.17, 0.36, 0.54, 0.72, 0.88)):
        tijeras.append(dict(u=u, rf=rng.uniform(0.55, 0.7), fase=k * 2.5 + rng.uniform(-0.3, 0.3),
                            giro0=rng.uniform(0, TAU), giro=rng.choice([1, -1]) * (TAU / 6) * rng.choice([1, 2]),
                            esc=rng.uniform(0.74, 0.84)))
    pelos = [dict(u=rng.uniform(0.05, 0.95), rf=rng.uniform(0.5, 1.0), fase=rng.uniform(0, TAU),
                  largo=int(rng.integers(1, 3))) for _ in range(12)]
    polvo = [dict(fase=k * TAU / 7 + rng.uniform(-0.3, 0.3), rx=rng.uniform(11, 19), r=rng.uniform(2.4, 3.6))
             for k in range(7)]

    def pos(u, rf, a, f, paso=0.0):
        yc = y_de_u(u)
        r = float(radio(u)) * rf
        return float(eje(u, f)) + r * math.cos(a), yc + (r * 0.2 + 0.8) * math.sin(a)

    cuadros = []
    for f in range(6):
        dfase = f * TAU / 6
        L = Lienzo(W, H)
        atras = Lienzo(W, H)
        frente = Lienzo(W, H)
        brillo = np.zeros((H, W), np.float32)
        # cuerpo: niebla translúcida con borde blando que ondula
        u_px = np.clip(u_de_y(Y), 0, 1)
        ex = eje(u_px, f)
        rr = radio(u_px) * (1 + 0.06 * np.sin(u_px * 17 + 2 * dfase))
        dx = (X - ex) / rr
        dentro = (suave(1.0, 0.45, np.abs(dx)) * suave(-0.02, 0.08, u_de_y(Y))
                  * suave(1.0, 0.7, u_de_y(Y)))
        alfa_cuerpo = escalonar(0.42 * dentro, 5)
        tono = np.where(dx < -0.3, 1, np.where(dx < 0.35, 2, 3))
        for v in vetas:
            a0 = v['fase'] + dfase
            n = max(10, int(v['arco'] * 9))
            angs = a0 + np.linspace(0, v['arco'], n)
            ys0 = y_de_u(v['u']) - v['paso'] * (angs - a0) / TAU
            uu = np.clip(u_de_y(ys0), 0, 1)
            r = radio(uu) * v['rf']
            xs = eje(uu, f) + r * np.cos(angs)
            ys = ys0 + (r * 0.2 + 0.8) * np.sin(angs)
            pts = np.stack([xs, ys], 1)
            s = np.linspace(0, 1, n)
            anchos = v['grosor'] * np.sin(math.pi * np.clip(s, 0.03, 0.97)) ** 0.7
            adelante = np.sin(angs) > 0
            for sel, capa in ((~adelante, 'atras'), (adelante, 'frente')):
                idx = np.where(sel)[0]
                if len(idx) < 2:
                    continue
                for seg in np.split(idx, np.where(np.diff(idx) > 1)[0] + 1):
                    if len(seg) < 2:
                        continue
                    P = pts[seg]
                    A = anchos[seg]
                    if capa == 'atras':
                        lin = linea_px(W, H, P)
                        atras.pintar(lin, R[4] if v['grosor'] < 2 else R[3], 0.9)
                    else:
                        m = mascara(trazo_g(lienzo_g(W, H), P, np.maximum(A, 0.3)))
                        lin = linea_px(W, H, P[1:-1]) if len(P) > 3 else np.zeros((H, W), bool)
                        frente.pintar(m, R[2] if v['grosor'] < 3 else R[1])
                        frente.pintar(lin & m, R[0] if v['grosor'] >= 2 else R[1])
                        brillo += m * 0.6 + lin * 0.4
        # polvo que levanta en la base
        # remolino de viento contra el piso: arcos bajos que giran con el embudo
        base = Lienzo(W, H)
        for k, p in enumerate(polvo[:4]):
            a0 = p['fase'] + dfase
            angs = a0 + np.linspace(0, 1.7, 14)
            rx, ry = 13.0 + 3.2 * k, 2.2 + 0.5 * k
            pts = np.stack([55 + rx * np.cos(angs), 141.5 + ry * np.sin(angs)], 1)
            adel = np.sin(angs) > 0
            for sel, col, op in ((adel, R[1], 0.9), (~adel, R[3], 0.6)):
                idx = np.where(sel)[0]
                for seg in np.split(idx, np.where(np.diff(idx) > 1)[0] + 1):
                    if len(seg) >= 2:
                        base.pintar(linea_px(W, H, pts[seg]), col, op)
        L.componer(halo_de(brillo, 4.0, 0.5, 0.3, 5, [R[1], R[2]], [0.3], ven))
        L.pintar(alfa_cuerpo > 0, R[tono], alfa_cuerpo)
        L.componer(atras)
        orden = []
        for t in tijeras:
            a = t['fase'] + dfase
            orden.append((math.sin(a), 'tijera', t, a))
        for p in pelos:
            a = p['fase'] + dfase
            orden.append((math.sin(a), 'pelo', p, a))
        orden.sort(key=lambda o: o[0])
        for prof, tipo, t, a in orden:
            if prof <= 0:
                _objeto_tornado(L, tipo, t, a, f, prof, radio, eje, y_bot, y_top, PELO)
        L.pintar(alfa_cuerpo > 0, R[2], alfa_cuerpo * 0.45)
        L.componer(base)
        L.componer(frente)
        for prof, tipo, t, a in orden:
            if prof > 0:
                _objeto_tornado(L, tipo, t, a, f, prof, radio, eje, y_bot, y_top, PELO)
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=55, ay=75, mezcla='normal', fps=12)


def _objeto_tornado(L, tipo, t, a, f, prof, radio, eje, y_bot, y_top, PELO):
    u = t['u']
    yc = y_bot - u * (y_bot - y_top)
    r = float(radio(u)) * t['rf']
    x = float(eje(u, f)) + r * math.cos(a)
    y = yc + (r * 0.2 + 0.8) * math.sin(a)
    if tipo == 'tijera':
        esc = t['esc'] * (0.88 + 0.12 * prof)
        ang = t['giro0'] + f * t['giro']
        osc = 0.0 if prof > 0 else 0.5 * (-prof)
        tam = 30
        capa, _ = capa_tijera(ang, escala=esc, tam=tam, centro=(tam / 2 + 0.5, tam / 2 + 0.5), oscurecer=osc)
        dx = int(math.floor(x)) - tam // 2
        dy = int(math.floor(y)) - tam // 2
        L.componer(capa, 0.8 if prof <= 0 else 1.0, dx, dy)
    else:
        m = np.zeros((L.h, L.w), bool)
        punto_px(m, x, y)
        if t['largo'] > 1:
            punto_px(m, x + math.cos(a + 1.2), y + math.sin(a + 1.2))
        L.pintar(m, PELO[0] if prof <= 0 else PELO[1])


# ─── Sillón de barbero (proyectil del Sillonazo) ─────────────────────────────

def efecto_sillon():
    """Sillón de barbero de cuero negro, de perfil mirando a la derecha (1 cuadro; el render lo rota)."""
    W = H = 96
    CUERO = paleta('#0A0A0E', '#141519', '#1D1E25', '#2A2C35', '#3D404C', '#5E6273', '#9296A8')
    CROMO = paleta('#0A0A0E', '#2A2E37', '#525967', '#858D9D', '#BAC2CF', '#E6EAF0', '#FFFFFF')
    L = Lienzo(W, H)
    union = np.zeros((H, W), bool)
    X, Y = centros(W, H)

    def capa_cuero(big, bisel, umbrales=(0.3, 0.55, 0.74, 0.86, 0.95)):
        nonlocal union
        c, s = sombreado_bisel(big, bisel)
        m = c >= 0.5
        idx = tonos_por_umbral(s, umbrales) + 1
        L.pintar(contorno(m), CUERO[0])
        L.pintar(m, CUERO[np.clip(idx, 1, 6)])
        union |= m
        return m

    def capa_cromo_bisel(big, bisel, umbrales=(0.3, 0.5, 0.68, 0.82, 0.93)):
        nonlocal union
        c, s = sombreado_bisel(big, bisel, suave=0.3)
        m = c >= 0.5
        idx = tonos_por_umbral(s, umbrales) + 1
        L.pintar(contorno(m), CROMO[0])
        L.pintar(m, CROMO[np.clip(idx, 1, 6)])
        union |= m
        return m

    def capa_cilindro(big, x0, x1, franjas):
        """Cromo de cilindro vertical: franjas verticales de reflejo."""
        nonlocal union
        m = mascara(big)
        s = np.clip((X - x0) / (x1 - x0), 0, 0.999)
        idx = np.array(franjas)[(s * len(franjas)).astype(int)]
        L.pintar(contorno(m), CROMO[0])
        L.pintar(m, CROMO[idx])
        union |= m
        return m

    # 1) base redonda (disco cromado visto en perspectiva)
    g = lienzo_g(W, H)
    elipse_g(g, 44.0, 87.6, 21.0, 4.6)
    borde_base = mascara(g)
    g2 = lienzo_g(W, H)
    elipse_g(g2, 44.0, 86.2, 21.0, 4.2)
    tapa = mascara(g2)
    L.pintar(contorno(borde_base | tapa), CROMO[0])
    L.pintar(borde_base, CROMO[2])
    canto = borde_base & ~tapa
    L.pintar(canto & (X > 44), CROMO[1])
    nu = (X - 44.0) / 21.0
    tono_tapa = np.where(nu < -0.55, 4, np.where(nu < -0.15, 5, np.where(nu < 0.35, 4, 3)))
    L.pintar(tapa, CROMO[tono_tapa])
    # reflejo blanco en el canto de atrás y sombra del pie
    g3 = lienzo_g(W, H)
    elipse_g(g3, 44.0, 85.6, 18.0, 3.0)
    L.pintar(tapa & ~mascara(g3) & (Y < 85.0) & (np.abs(nu) < 0.6), CROMO[6])
    g4 = lienzo_g(W, H)
    elipse_g(g4, 44.6, 86.0, 8.0, 2.2)
    L.pintar(mascara(g4), CROMO[2])
    union |= borde_base | tapa

    # 2) apoyapiés: barra cromada en diagonal y plancha
    g = lienzo_g(W, H)
    trazo_g(g, [(61.0, 57.0), (68.5, 68.0), (74.0, 77.5)], 3.2)
    capa_cromo_bisel(g, 1.4)
    g = lienzo_g(W, H)
    poligono_g(g, rect_redondeado(67.0, 76.8, 89.5, 81.6, 1.4))
    m_pl = capa_cromo_bisel(g, 1.6, umbrales=(0.32, 0.55, 0.75, 0.9, 0.97))
    estrias = m_pl & erosionar(m_pl) & (((X - 0.5).astype(int) % 4) == 0) & (Y > 78) & (Y < 81)
    L.pintar(estrias, CROMO[1])

    # 3) pie hidráulico con anillo arriba y campana abajo
    g = lienzo_g(W, H)
    poligono_g(g, [(36.8, 86.5), (51.2, 86.5), (49.6, 82.8), (38.4, 82.8)])
    capa_cilindro(g, 36.8, 51.2, [1, 3, 5, 6, 5, 4, 3, 2, 2, 1])
    g = lienzo_g(W, H)
    poligono_g(g, [(39.8, 83.0), (48.2, 83.0), (48.2, 63.0), (39.8, 63.0)])
    capa_cilindro(g, 39.8, 48.2, [2, 4, 6, 5, 4, 3, 2, 1])
    g = lienzo_g(W, H)
    poligono_g(g, rect_redondeado(37.8, 60.2, 50.2, 64.6, 1.2))
    capa_cilindro(g, 37.8, 50.2, [1, 3, 5, 6, 5, 4, 3, 2, 1])
    # palanca del pie
    g = lienzo_g(W, H)
    trazo_g(g, [(48.5, 78.0), (55.0, 80.5), (58.5, 80.5)], 1.6)
    capa_cromo_bisel(g, 0.9)

    # 4) mecanismo bajo el asiento (metal oscuro)
    g = lienzo_g(W, H)
    poligono_g(g, rect_redondeado(30.5, 54.5, 58.5, 61.2, 1.5))
    capa_cuero(g, 1.3, umbrales=(0.3, 0.55, 0.8, 0.95, 0.99))

    # 5) respaldo con cabezal (inclinado hacia atrás)
    inc = -0.16
    cres = np.array([27.8, 32.6])
    g = lienzo_g(W, H)
    poligono_g(g, rotar_pts(rect_redondeado(20.3, 11.6, 35.3, 54.0, 5.2), inc, cres))
    m_resp = capa_cuero(g, 3.4)
    # costuras del respaldo (hundida + luz debajo)
    for yy in (24.5, 37.5):
        p = rotar_pts([(22.8, yy), (32.8, yy)], inc, cres)
        lin = linea_px(W, H, p) & erosionar(m_resp, n=2)
        L.pintar(lin, CUERO[1])
        abajo = np.roll(lin, 1, axis=0) & erosionar(m_resp, n=2) & ~lin
        L.pintar(abajo, CUERO[4])
    # barra cromada y cabezal
    g = lienzo_g(W, H)
    poligono_g(g, rotar_pts(rect_redondeado(25.3, 6.8, 28.6, 13.0, 0.6), inc, cres))
    capa_cromo_bisel(g, 0.9)
    g = lienzo_g(W, H)
    poligono_g(g, rotar_pts(rect_redondeado(18.6, 2.6, 34.0, 9.0, 3.0), inc, cres))
    capa_cuero(g, 2.2)

    # 6) asiento
    g = lienzo_g(W, H)
    poligono_g(g, rect_redondeado(24.5, 44.4, 70.5, 56.8, 5.4))
    m_as = capa_cuero(g, 3.2)
    lin = linea_px(W, H, [(30.5, 47.5), (65.0, 47.5)]) & erosionar(m_as, n=2)
    L.pintar(lin, CUERO[1])
    L.pintar(np.roll(lin, 1, axis=0) & erosionar(m_as, n=2) & ~lin, CUERO[4])

    # 7) soporte cromado del apoyabrazos y apoyabrazos
    g = lienzo_g(W, H)
    poligono_g(g, [(59.6, 40.0), (64.6, 40.0), (63.6, 46.0), (60.6, 46.0)])
    capa_cilindro(g, 59.6, 64.6, [1, 4, 6, 4, 2])
    g = lienzo_g(W, H)
    poligono_g(g, rect_redondeado(29.0, 35.2, 66.0, 41.6, 3.2))
    disco_g(g, 66.6, 38.6, 3.7)
    capa_cuero(g, 2.4)

    L.pintar(contorno(union), CUERO[0])
    return dict(cuadros=[L.rgba()], ax=48, ay=48, mezcla='normal', fps=0)


# ─── Nube de spray de fijación ───────────────────────────────────────────────

def efecto_spray_nube():
    """Spray de fijación: chorro y nube celeste-blanca con gotitas que se expande a la derecha (aditiva)."""
    W, H = 150, 90
    rng = rng_de('spray_nube')
    # blanco, hielo pálido, hielo, celeste Chipi, azul Chipi
    R = paleta('#FFFFFF', '#D6F7FF', '#8FE6FF', '#38D6FF', '#2A6BFF')
    ven = ventana_borde(H, W, 6)
    boq = np.array([4.0, 46.0])            # boquilla (a la izquierda, al medio)
    npf = 46
    puffs = []
    for k in range(npf):
        x = 9 + 117 * ((k + rng.uniform(0, 1)) / npf) ** 0.92
        hw = 3 + 0.27 * x
        y = boq[1] + rng.uniform(-1, 1) * hw * 0.45
        r = min(2.6 + 0.085 * x + rng.uniform(0, 3.2), 15.0)
        puffs.append(dict(x=x, y=y, r=r, d=rng.uniform(2, 6)))
    gotas = [dict(a=rng.uniform(-0.34, 0.34), v=rng.uniform(70, 150), t0=rng.uniform(0, 0.55),
                  tam=int(rng.choice([1, 1, 2]))) for _ in range(46)]
    brillos = [(rng.uniform(30, 132), boq[1] + rng.uniform(-20, 20), int(rng.integers(2, 6))) for _ in range(8)]
    textura = ruido_suave(rng, H, W + 40, 2.2)
    # tono por luz: 0 brillo, 1 claro, 2 medio, 3 sombra, 4 sombra honda (en aditivo, alfa x color = luz que suma)
    TONO_COL = [R[0], R[1], R[2], R[3], R[4]]
    TONO_ALFA = np.array([0.82, 0.68, 0.52, 0.38, 0.27], np.float32)

    cuadros = []
    for f in range(6):
        t = f / 5
        frente = 8 + 122 * salida_cubica(min(1.0, t / 0.62))
        disip = recortar01((t - 0.55) / 0.45)
        bolas = []
        for p in puffs:
            if p['x'] > frente:
                continue
            t_nace = 0.62 * (1 - (1 - (p['x'] - 8) / 122) ** (1 / 3)) if p['x'] > 8 else 0
            edad = max(0.0, t - t_nace)
            r = p['r'] * (0.5 + 0.5 * salida_cubica(edad / 0.3)) * (1 - 0.12 * disip)
            x = p['x'] + p['d'] * edad
            y = p['y'] - 3.0 * edad
            if disip > 0 and p['x'] < 30 + 60 * disip:      # lo de la boquilla se va primero
                r *= 1 - 0.6 * disip
            r = min(r, H - 6 - y, y - 6, W - 7 - x)
            if r < 1.2:
                continue
            bolas.append((x, y, r, 1.0))
        tex = textura[:, 40 - f * 7: 40 - f * 7 + W]
        alt, s = relieve_bolas(W, H, bolas, suavizar=0.7, ruido=0.7 + 0.6 * tex)
        hay = alt > 0.6
        tono = np.select([s > 0.93, s > 0.8, s > 0.6, s > 0.38], [0, 1, 2, 3], 4)
        # borde de la nube: más tenue (bruma)
        borde = hay & (alt < 2.0)
        alfa = TONO_ALFA[tono] * np.where(borde, 0.55, 1.0) * (1 - 0.45 * disip)
        nube = Lienzo(W, H)
        nube.pintar(hay, np.asarray(TONO_COL)[tono], alfa)
        if disip > 0:
            ruido = ruido_suave(rng, H, W, 2.0)
            nube.borrar(ruido < 0.42 * disip)
        chorro = np.zeros((H, W), bool)
        chorro_c = np.zeros((H, W), bool)
        if f <= 2:
            largo = (24, 40, 30)[f]
            for a in (-0.11, -0.05, 0.0, 0.05, 0.11):
                lin = linea_px(W, H, [boq + unidad(a) * 1.0, boq + unidad(a) * largo * (1 - abs(a) * 3)])
                if a == 0:
                    chorro_c |= lin
                else:
                    chorro |= lin
        got = np.zeros((H, W), bool)
        got2 = np.zeros((H, W), bool)
        for gd in gotas:
            if t < gd['t0']:
                continue
            dd = gd['v'] * (t - gd['t0']) * 0.9 + 4
            p = boq + unidad(gd['a']) * dd + np.array([0, 9 * (t - gd['t0']) ** 2])
            if not (4 <= p[0] < W - 4 and 4 <= p[1] < H - 4):
                continue
            if gd['tam'] == 2 and f <= 3:
                got |= linea_px(W, H, [p - unidad(gd['a']) * 1.5, p])
            else:
                punto_px(got2 if disip > 0.5 else got, p[0], p[1])
        brillo = np.maximum(hay * 0.35, (chorro | chorro_c) * 1.0) + got * 0.4
        L = halo_de(brillo, 3.4, 0.8 * (1 - 0.5 * disip), 0.3, 5, [R[2], R[3], R[4]], [0.4, 0.18], ven)
        L.componer(nube)
        L.pintar(chorro, R[1])
        L.pintar(chorro_c, R[0])
        L.pintar(got, R[0])
        L.pintar(got2, R[2])
        for bx, by, nace in brillos:
            if nace <= f <= nace + 1 and bx < frente:
                destellito(L, bx, by, 2 if f == nace else 1, [R[0], R[1], R[2]])
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=75, ay=45, mezcla='aditiva', fps=14)


# ─── Hielo (congelado) ───────────────────────────────────────────────────────

PAL_HIELO = paleta('#173F9E', '#2A6BFF', '#38D6FF', '#8FE6FF', '#D6F7FF', '#FFFFFF')


def _cristal(L, W, H, base, ang, largo, ancho, alfa=0.9, pal=PAL_HIELO):
    """Cristal de hielo: prisma con punta, una cara iluminada y otra en sombra, contorno azul."""
    u = unidad(ang)
    v = perp(u)
    hw = ancho / 2
    b = np.asarray(base, np.float64)
    pts_i = [b - v * hw, b + u * largo * 0.66 - v * hw * 0.92, b + u * largo]
    pts_d = [b + u * largo, b + u * largo * 0.66 + v * hw * 0.92, b + v * hw]
    cara_i = mascara(poligono_g(lienzo_g(W, H), pts_i + [b]))
    cara_d = mascara(poligono_g(lienzo_g(W, H), [b] + pts_d))
    todo = cara_i | cara_d
    if not todo.any():
        return todo
    luz_i = np.dot(-v, LUZ2) > 0
    L.pintar(contorno(todo), pal[0], 0.95)
    L.pintar(cara_i, pal[4] if luz_i else pal[2], alfa)
    L.pintar(cara_d, pal[2] if luz_i else pal[4], alfa)
    arista = linea_px(W, H, [b + u * largo * 0.12, b + u * largo * 0.86]) & todo
    L.pintar(arista, pal[5], 0.95)
    # brillo en la punta
    if largo >= 10:
        m = np.zeros((H, W), bool)
        punto_px(m, *(b + u * (largo - 2.2) - v * hw * 0.25 * (1 if luz_i else -1)))
        L.pintar(m & todo, pal[5])
    return todo


def efecto_hielo():
    """Congelado: el hielo trepa desde el piso y le salen cristales al cuerpo (3 cuadros; pivote en el piso)."""
    W, H = 90, 160
    piso = 157.0
    rng = rng_de('hielo')
    P = PAL_HIELO
    X, Y = centros(W, H)
    # 1) masa de hielo que encierra los pies y sube (borde de arriba en picos)
    topes = [141.0, 122.0, 113.0]
    xs_masa = np.linspace(12.0, 78.0, 15)
    picos = rng.uniform(3.0, 8.0, len(xs_masa)) * np.where(np.arange(len(xs_masa)) % 2 == 0, -1, 0.35)
    semillas = np.array([(rng.uniform(12, 78), rng.uniform(108, 156)) for _ in range(9)])
    dist = np.stack([np.hypot(X - sx, Y - sy) for sx, sy in semillas], 0)
    celda = np.argmin(dist, 0)
    d_ord = np.sort(dist, 0)
    arista_facetas = (d_ord[1] - d_ord[0]) < 0.9
    alfa_celda = rng.uniform(0.4, 0.62, len(semillas))[celda]
    # 2) cristales grandes al pie
    cristales = []
    xs_base = np.linspace(8, 82, 10) + rng.uniform(-2.5, 2.5, 10)
    for x in xs_base:
        ang = -math.pi / 2 + (x - 45) / 45 * 0.75 + rng.uniform(-0.22, 0.22)
        largo = rng.uniform(12, 28)
        ux = math.cos(ang)
        if x + ux * largo < 4.0:                         # que la punta no se salga del cuadro
            largo = (x - 4.0) / -ux
        if x + ux * largo > W - 4.0:
            largo = (W - 4.0 - x) / ux
        cristales.append(dict(x=x, y=piso - 1.0, a=ang, l=largo, w=rng.uniform(6.0, 9.5), nace=0))
    # 3) racimos que le salen al cuerpo: caderas, puños, hombros y cabeza (x, y, hacia afuera, n, escala, cuadro)
    racimos = [(31, 100, -2.6, 2, 0.8, 1), (59, 100, -0.55, 2, 0.8, 1),
               (26, 84, -2.35, 3, 0.9, 1), (64, 82, -0.8, 3, 0.9, 1),
               (29, 56, -2.15, 2, 0.85, 2), (61, 56, -1.0, 2, 0.85, 2),
               (40, 30, -1.95, 2, 0.75, 2), (50, 29, -1.2, 2, 0.75, 2)]
    for (xb, yb, a_out, n, esc, nace) in racimos:
        formas = ((-0.4, 13, 5.0), (0.0, 19, 6.5), (0.4, 14, 5.5)) if n == 3 else ((-0.24, 17, 6.0), (0.3, 12, 5.0))
        for (da, lg, an) in formas:
            a = a_out + da + rng.uniform(-0.1, 0.1)
            u = unidad(a)
            b = np.array([xb, yb]) - u * 4.0          # nace adentro del cuerpo
            largo = lg * esc * rng.uniform(0.85, 1.15)
            punta = b + u * largo
            for e, (lo, hi) in ((0, (3.0, W - 3.0)), (1, (3.0, H - 3.0))):
                if punta[e] < lo and u[e] < 0:
                    largo = (b[e] - lo) / -u[e]
                if punta[e] > hi and u[e] > 0:
                    largo = (hi - b[e]) / u[e]
            cristales.append(dict(x=b[0], y=b[1], a=a, l=largo, w=an * esc, nace=nace))
    niebla = [(x, piso - rng.uniform(2, 5), rng.uniform(5, 8), rng.uniform(0.5, 0.9))
              for x in np.linspace(6, 84, 14)]

    cuadros = []
    for f in range(3):
        L = Lienzo(W, H)
        d = densidad(W, H, niebla) * (0.6, 0.85, 1.0)[f]
        L.pintar(d > 0.25, P[5], np.clip((d - 0.25) * 0.6, 0, 0.3) * ventana_borde(H, W, 4))
        # masa de hielo
        tope = topes[f]
        borde_sup = [(x, tope + p * (0.6 + 0.4 * f / 2)) for x, p in zip(xs_masa, picos)]
        masa_pts = [(10.0, piso)] + [(11.0, tope + 6)] + borde_sup + [(79.0, tope + 6), (80.0, piso)]
        masa = mascara(poligono_g(lienzo_g(W, H), masa_pts))
        L.pintar(contorno(masa), P[0], 0.85)
        L.pintar(masa, P[3], alfa_celda)
        L.pintar(masa & arista_facetas, P[4], 0.45)
        borde_m = masa & ~erosionar(masa)
        arriba = borde_m & ~np.roll(masa, -1, axis=0)
        L.pintar(borde_m & (X < 45), P[4], 0.9)
        L.pintar(borde_m & (X >= 45), P[2], 0.85)
        L.pintar(arriba, P[5], 0.9)
        for (x0, y0, y1) in ((22.0, tope + 4, 152.0), (27.0, tope + 8, 150.0)):
            veta = (np.abs((X - x0) - (piso - Y) * 0.35) < 0.75) & masa & (Y > y0) & (Y < y1)
            L.pintar(veta, P[5], 0.6)
        # cristales: los del cuerpo y los grandes del pie
        for c in sorted(cristales, key=lambda c: (c['nace'] == 0, -c['l'])):
            if c['nace'] > f:
                continue
            crece = 1.0 if f == 2 else (0.6 if c['nace'] == f else 0.85)
            if c['nace'] == 0 and f == 0:
                crece = 0.62
            _cristal(L, W, H, (c['x'], c['y']), c['a'], c['l'] * crece, c['w'] * (0.7 + 0.3 * crece))
        for (sx, sy, nace) in ((21, 72, 2), (66, 44, 2), (40, 128, 1), (71, 112, 1), (31, 34, 2),
                               (57, 92, 1), (24, 148, 0), (63, 146, 0)):
            if nace <= f:
                destellito(L, sx, sy, 2 if (sx + f) % 2 else 1, [P[5], P[5], P[4]])
        L.borrar(Y >= piso)                  # nada por debajo del piso
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=45, ay=157, mezcla='normal', fps=12)


# ─── Esquirlas: hielo y vidrio ───────────────────────────────────────────────

def _esquirla(rng, W, H, largo, ancho, pal, alfa_cuerpo, n_vert, alfa_borde=1.0, pts=None):
    """Esquirla poligonal con dos facetas, filo de luz y contorno de 1 px (pts: vértices propios)."""
    c = np.array([W / 2, H / 2])
    if pts is None:
        ang = rng.uniform(0, math.pi)
        base_ang = np.sort(rng.uniform(0, TAU, n_vert))
        while np.max(np.diff(np.r_[base_ang, base_ang[0] + TAU])) > 2.4:
            base_ang = np.sort(rng.uniform(0, TAU, n_vert))
        loc = np.stack([np.cos(base_ang) * largo / 2, np.sin(base_ang) * ancho / 2], 1)
        loc *= rng.uniform(0.75, 1.0, (n_vert, 1))
        pts = rotar_pts(loc, ang) + c
    else:
        pts = np.asarray(pts, np.float64) + c
        n_vert = len(pts)
    big = poligono_g(lienzo_g(W, H), pts)
    cobt, s = sombreado_bisel(big, 1.2)
    m = cobt >= 0.5
    p0 = pts[0]
    p1 = (pts[n_vert // 2] + pts[(n_vert // 2 + 1) % n_vert]) / 2 if n_vert > 3 else (pts[1] + pts[2]) / 2
    d = p1 - p0
    X, Y = centros(W, H)
    lado = ((X - p0[0]) * d[1] - (Y - p0[1]) * d[0]) > 0
    s = s + np.where(lado, 0.08, -0.06)
    idx = tonos_por_umbral(s, (0.5, 0.7, 0.86))          # 0..3
    L = Lienzo(W, H)
    L.pintar(contorno(m), pal[0], alfa_borde)
    L.pintar(m & (idx <= 2), pal[np.clip(idx + 1, 1, 4)], alfa_cuerpo)
    L.pintar(m & (idx == 3), pal[4], min(1.0, alfa_cuerpo + 0.3))
    L.pintar(m & ~erosionar(m) & (s > 0.78), pal[5])
    return L


def efecto_hielo_trozo():
    """6 esquirlas de hielo sueltas (8–16 px) para cuando se rompe el congelado."""
    rng = rng_de('hielo_trozo')
    W = H = 18
    cuadros = []
    for largo, ancho, nv in ((15.5, 8.5, 5), (12.5, 7.5, 4), (10.0, 6.5, 4), (14.0, 6.0, 3),
                             (8.5, 6.5, 5), (12.0, 9.0, 6)):
        L = _esquirla(rng, W, H, largo, ancho, PAL_HIELO, 0.92, nv)
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=9, ay=9, mezcla='normal', fps=0)


def efecto_vidrio():
    """6 esquirlas de vidrio celeste sueltas (8–16 px) para la guardia rota."""
    rng = rng_de('vidrio')
    W = H = 18
    pal = paleta('#2B6E8C', '#6CBCD8', '#A6E2F2', '#D2F5FC', '#F0FDFF', '#FFFFFF')
    formas = [
        ([(-7.5, -2.4), (7.5, 0.0), (-5.5, 3.0)], 20),            # puñal
        ([(-6.0, -4.2), (6.8, -1.0), (-1.8, 4.6)], -35),          # triángulo ancho
        ([(-7.0, -1.1), (7.0, 0.7), (-4.8, 2.0)], 70),            # astilla
        ([(-6.8, -3.0), (2.0, -4.0), (6.8, 1.2), (-4.0, 3.6)], 10),   # cuadrilátero
        ([(-4.8, -3.0), (5.0, -0.6), (-2.0, 3.6)], -60),          # chiquita
        ([(-7.0, 0.0), (-1.0, -3.4), (7.0, 0.6), (0.0, 3.0)], 45),    # rombo
    ]
    cuadros = []
    for pts, giro in formas:
        p = rotar_pts(pts, math.radians(giro))
        L = _esquirla(rng, W, H, 0, 0, pal, 0.66, len(pts), pts=p)
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=9, ay=9, mezcla='normal', fps=0)


# ─── Polvo al caer ───────────────────────────────────────────────────────────

def efecto_polvo():
    """Nube de polvo beige-gris al aterrizar: se abre a los costados y se disipa (pivote en el piso)."""
    W, H = 64, 32
    piso = 30.0
    rng = rng_de('polvo')
    # claro, beige, medio, sombra, hondo
    P = paleta('#EEE5D2', '#CDBFA3', '#A89A7E', '#83775F', '#5E5546')
    X, Y = centros(W, H)
    # bolitas de cada mitad: (x relativo hacia afuera, alto, radio)
    grupo = [(-2.0, 0.0, 4.6), (2.6, -0.5, 5.2), (6.8, 0.4, 3.8), (0.6, -3.8, 3.9), (-5.5, 0.6, 3.2),
             (4.2, -3.2, 3.0), (9.6, 0.8, 2.6)]
    T = [
        dict(gx=3.5, sube=0.0, esc=0.72, alfa=1.0, centro=1.0, deshace=0.0),
        dict(gx=9.5, sube=1.2, esc=0.95, alfa=1.0, centro=0.75, deshace=0.0),
        dict(gx=14.0, sube=3.0, esc=1.06, alfa=0.92, centro=0.4, deshace=0.06),
        dict(gx=17.5, sube=4.8, esc=1.08, alfa=0.8, centro=0.0, deshace=0.22),
        dict(gx=19.5, sube=6.4, esc=1.0, alfa=0.62, centro=0.0, deshace=0.42),
        dict(gx=20.5, sube=7.6, esc=0.86, alfa=0.4, centro=0.0, deshace=0.62),
    ]
    piedras = [(rng.choice([-1, 1]) * rng.uniform(0.6, 1.0), rng.uniform(5, 9), rng.uniform(0.3, 0.9))
               for _ in range(6)]
    jit = rng.uniform(-0.8, 0.8, (2, len(grupo), 2))
    cuadros = []
    for f, t in enumerate(T):
        bolas = []
        for i, lado in enumerate((-1, 1)):
            for j, (dx, dy, r) in enumerate(grupo):
                rr = r * t['esc']
                x = 32 + lado * (t['gx'] + dx * 0.85) + jit[i, j, 0]
                x = min(max(x, rr + 2.5), W - rr - 2.5)
                y = piso - rr * 0.55 - t['sube'] + dy * 0.7 + jit[i, j, 1]
                bolas.append((x, y, rr, 1.0))
        if t['centro'] > 0:
            bolas.append((32.0, piso - 3.0, 5.2 * t['centro'], 1.0))
            bolas.append((28.0, piso - 2.0, 3.6 * t['centro'], 1.0))
            bolas.append((36.0, piso - 2.0, 3.6 * t['centro'], 1.0))
        alt, s = relieve_bolas(W, H, bolas, suavizar=0.5)
        hay = (alt > 0.5) & (Y < piso)
        tono = np.select([s > 0.92, s > 0.78, s > 0.55, s > 0.3], [0, 1, 2, 3], 4)
        borde = hay & ~erosionar(hay)
        nube = Lienzo(W, H)
        nube.pintar(hay, P[tono], np.where(borde, 0.7, 1.0))
        if t['deshace'] > 0:
            ruido = ruido_suave(rng, H, W, 1.4)
            nube.borrar(ruido * 0.85 + np.clip(alt / 6, 0, 1) * 0.3 < t['deshace'] + 0.05)
        nube.escalar_alfa(t['alfa'])
        pied = np.zeros((H, W), bool)
        if f <= 3:
            for lado, v, h in piedras:
                tt = (f + 0.5) / 4
                x = 32 + lado * (6 + v * tt * 3.2)
                y = piso - 1 - (h * 14 * tt - 16 * tt * tt) - 1
                if 2 <= x < W - 2 and 2 <= y < piso:
                    punto_px(pied, x, y)
        nube.pintar(pied, P[4])
        cuadros.append(nube.rgba())
    return dict(cuadros=cuadros, ax=32, ay=30, mezcla='normal', fps=16)


# ─── Estrellitas de mareado ──────────────────────────────────────────────────

def efecto_estrellas():
    """Tres estrellitas amarillas que giran en elipse sobre la cabeza (mareado), loop de 6."""
    W, H = 56, 24
    cx, cy = 28.0, 12.0
    rx, ry = 19.0, 3.4
    # contorno, sombra, amarillo, claro, brillo
    P = paleta('#5C3200', '#E89A00', '#FFD02E', '#FFF09A', '#FFFFFF')
    ATRAS = paleta('#583100', '#C48300', '#E3B026', '#F2D883', '#FBF0C8')
    bases = [1.0, 0.88, 0.78]
    cuadros = []
    for f in range(6):
        L = Lienzo(W, H)
        objetos = []
        for k, b in enumerate(bases):
            a = TAU * f / 6 + TAU * k / 3 + math.pi / 2
            objetos.append((math.sin(a), cx + rx * math.cos(a), cy + ry * math.sin(a), a, b))
        objetos.sort()
        for prof, x, y, a, b in objetos:
            pal = P if prof > -0.35 else ATRAS
            # estela corta sobre la órbita, pegada detrás de la estrella
            for (a0, a1, op) in ((0.22, 0.4, 0.7), (0.4, 0.56, 0.32)):
                aa = a - np.linspace(a0, a1, 5)
                lin = linea_px(W, H, np.stack([cx + rx * np.cos(aa), cy + ry * np.sin(aa)], 1))
                L.pintar(lin, pal[3], op * (1.0 if prof > -0.35 else 0.6))
        for prof, x, y, a, b in objetos:
            pal = P if prof > -0.35 else ATRAS
            Rr = 5.3 * b * (0.86 + 0.14 * (prof + 1) / 2)
            inc = -math.pi / 2 + 0.25 * math.cos(a)
            pts = []
            for i in range(10):
                rr = Rr if i % 2 == 0 else Rr * 0.47
                aa = inc + i * math.pi / 5
                pts.append((x + rr * math.cos(aa), y + rr * math.sin(aa)))
            c, s = sombreado_bisel(poligono_g(lienzo_g(W, H), pts), 1.5)
            m = c >= 0.45
            idx = tonos_por_umbral(s, (0.45, 0.72, 0.9)) + 1
            L.pintar(contorno(m), pal[0])
            L.pintar(m, pal[np.clip(idx, 1, 4)])
            bri = np.zeros((H, W), bool)
            punto_px(bri, x - 1.0, y - 1.0)
            L.pintar(bri & m, pal[4])
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=28, ay=12, mezcla='normal', fps=10)


# ─── Onda expansiva y destello ───────────────────────────────────────────────

def efecto_onda():
    """Anillo de onda expansiva blanco que se agranda y se afina (aditiva)."""
    W = H = 128
    c = np.array([64.0, 64.0])
    rng = rng_de('onda')
    P = paleta('#FFFFFF', '#E6F1FF', '#B4CCEC', '#7C9CC8')
    X, Y = centros(W, H)
    rho = np.hypot(X - c[0], Y - c[1])
    th = np.arctan2(Y - c[1], X - c[0])
    ven = ventana_borde(H, W, 5)
    huecos = rng.uniform(0, 1, 96)
    T = [
        dict(r=15.0, t=7.0, b=1.0, hueco=0.0, adentro=0.45),
        dict(r=31.0, t=5.5, b=0.9, hueco=0.0, adentro=0.22),
        dict(r=43.0, t=4.0, b=0.72, hueco=0.06, adentro=0.1),
        dict(r=51.0, t=2.8, b=0.5, hueco=0.22, adentro=0.04),
        dict(r=56.0, t=1.6, b=0.3, hueco=0.42, adentro=0.0),
    ]
    cuadros = []
    for f, t in enumerate(T):
        g = lienzo_g(W, H)
        disco_g(g, c[0], c[1], t['r'])
        disco_g(g, c[0], c[1], t['r'] - t['t'], valor=0)
        banda = mascara(g)
        if t['hueco'] > 0:
            seg = ((th + math.pi) / TAU * 96).astype(int) % 96
            banda &= huecos[seg] >= t['hueco']
        u = np.clip((t['r'] - rho) / max(t['t'], 1e-3), 0, 1)       # 0 = borde de afuera
        idx = np.digitize(u, [0.3, 0.62])
        alfa = np.array([1.0, 0.85, 0.6])[idx] * (0.55 + 0.45 * t['b'])
        g = lienzo_g(W, H)
        disco_g(g, c[0], c[1], t['r'] - t['t'])
        interior = mascara(g)
        brillo = banda * alfa
        L = halo_de(brillo, 2.6, 1.3 * t['b'], 0.5, 6, [P[1], P[2], P[3]], [0.35, 0.15], ven)
        L.pintar(interior, P[3], t['adentro'] * (np.clip(rho / max(t['r'], 1), 0, 1) ** 2))
        L.pintar(banda, P[np.clip(idx, 0, 2)], alfa)
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=64, ay=64, mezcla='aditiva', fps=20)


def efecto_destello():
    """Destello redondo blanco que se apaga (aditiva)."""
    W = H = 64
    c = np.array([32.0, 32.0])
    P = paleta('#FFFFFF', '#FFFAF0', '#FFF2DC', '#FFE6C0')
    ven = ventana_borde(H, W, 6)
    T = [
        dict(r0=10.5, r1=13.5, a=1.0, halo=1.0),
        dict(r0=7.5, r1=12.0, a=0.9, halo=0.72),
        dict(r0=4.5, r1=8.5, a=0.66, halo=0.42),
        dict(r0=2.0, r1=5.0, a=0.36, halo=0.16),
    ]
    cuadros = []
    for t in T:
        m0 = mascara(disco_g(lienzo_g(W, H), c[0], c[1], t['r0']))
        m1 = mascara(disco_g(lienzo_g(W, H), c[0], c[1], t['r1']))
        brillo = m0 * 1.0 + m1 * 0.55
        L = halo_de(brillo * t['a'], 4.4, 1.2 * t['halo'], 0.6, 12, [P[2], P[3]], [0.35], ven)
        L.pintar(m1, P[1], 0.78 * t['a'])
        L.pintar(m0, P[0], t['a'])
        cuadros.append(L.rgba())
    return dict(cuadros=cuadros, ax=32, ay=32, mezcla='aditiva', fps=20)


# ════════════════════════════════════════════════════════════════════════════
# Atlas
# ════════════════════════════════════════════════════════════════════════════

EFECTOS = [
    ('chispa', efecto_chispa),
    ('chispa_critica', efecto_chispa_critica),
    ('bloqueo', efecto_bloqueo),
    ('mechones', efecto_mechones),
    ('rayo', efecto_rayo),
    ('arco_electrico', efecto_arco_electrico),
    ('tijera', efecto_tijera),
    ('tornado', efecto_tornado),
    ('sillon', efecto_sillon),
    ('spray_nube', efecto_spray_nube),
    ('hielo', efecto_hielo),
    ('hielo_trozo', efecto_hielo_trozo),
    ('polvo', efecto_polvo),
    ('vidrio', efecto_vidrio),
    ('estrellas', efecto_estrellas),
    ('onda', efecto_onda),
    ('destello', efecto_destello),
]

ANCHO_ATLAS = 1024
AIRE = 2


def empaquetar(efectos):
    """Estantes: animaciones de mayor a menor alto, cuadros en orden, de izquierda a derecha."""
    orden = sorted(efectos, key=lambda e: (-e[1]['cuadros'][0].shape[0], e[0]))
    x = y = 0
    alto_estante = 0
    pos = {}
    for nombre, d in orden:
        h, w = d['cuadros'][0].shape[:2]
        lista = []
        for _ in d['cuadros']:
            if x + w > ANCHO_ATLAS:
                x = 0
                y += alto_estante + AIRE
                alto_estante = 0
            lista.append((x, y))
            x += w + AIRE
            alto_estante = max(alto_estante, h)
        pos[nombre] = lista
    alto = y + alto_estante
    alto = int(math.ceil(alto / 4) * 4)
    return pos, alto


def validar(nombre, d):
    """Mismo tamaño en todos los cuadros y nada pegado al borde (nada cortado)."""
    avisos = []
    h, w = d['cuadros'][0].shape[:2]
    for i, c in enumerate(d['cuadros']):
        if c.shape[:2] != (h, w):
            raise ValueError(f'{nombre}: el cuadro {i} mide {c.shape[:2]} y el 0 mide {(h, w)}')
        a = c[..., 3]
        borde = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
        if borde.max() > 3:
            avisos.append(f'{nombre}[{i}]: alfa {borde.max()} en el borde del cuadro')
        if a.max() == 0:
            avisos.append(f'{nombre}[{i}]: cuadro vacío')
    if not (0 <= d['ax'] <= w and 0 <= d['ay'] <= h):
        raise ValueError(f'{nombre}: pivote fuera del cuadro')
    return avisos


def json_legible(anims):
    """El JSON del contrato con un cuadro por línea (cómodo de leer y de comparar)."""
    lineas = ['{', '  "version": 1,', '  "imagen": "efectos.png",', '  "animaciones": {']
    nombres = list(anims)
    for i, nombre in enumerate(nombres):
        a = anims[nombre]
        lineas.append(f'    "{nombre}": {{')
        lineas.append('      "cuadros": [')
        for j, c in enumerate(a['cuadros']):
            coma = ',' if j < len(a['cuadros']) - 1 else ''
            lineas.append('        ' + json.dumps(c, separators=(', ', ': ')) + coma)
        lineas.append('      ],')
        lineas.append(f'      "mezcla": "{a["mezcla"]}",')
        lineas.append(f'      "fps": {a["fps"]}')
        lineas.append('    }' + (',' if i < len(nombres) - 1 else ''))
    lineas += ['  }', '}']
    texto = '\n'.join(lineas) + '\n'
    assert json.loads(texto) == dict(version=1, imagen='efectos.png', animaciones=anims)
    return texto


def main(argv=None):
    ap = argparse.ArgumentParser(description='Genera el atlas de efectos de Corte Final.')
    raiz = Path(__file__).resolve().parents[2]
    ap.add_argument('--salida', type=Path, default=raiz / 'public' / 'juego' / 'efectos')
    ap.add_argument('--solo', nargs='*', help='generar sólo estos efectos (para iterar)')
    args = ap.parse_args(argv)

    efectos = []
    avisos = []
    for nombre, fn in EFECTOS:
        if args.solo and nombre not in args.solo:
            continue
        d = fn()
        avisos += validar(nombre, d)
        efectos.append((nombre, d))
        h, w = d['cuadros'][0].shape[:2]
        print(f'  {nombre:16s} {len(d["cuadros"]):2d} cuadros  {w:3d}x{h:<3d}  pivote ({d["ax"]}, {d["ay"]})'
              f'  {d["mezcla"]:8s} {d["fps"]} fps')

    pos, alto = empaquetar(efectos)
    atlas = np.zeros((alto, ANCHO_ATLAS, 4), np.uint8)
    anims = {}
    for nombre, d in efectos:
        h, w = d['cuadros'][0].shape[:2]
        cuadros = []
        for (x, y), c in zip(pos[nombre], d['cuadros']):
            atlas[y:y + h, x:x + w] = c
            cuadros.append(dict(x=int(x), y=int(y), w=int(w), h=int(h), ax=int(d['ax']), ay=int(d['ay'])))
        anims[nombre] = dict(cuadros=cuadros, mezcla=d['mezcla'], fps=d['fps'])

    args.salida.mkdir(parents=True, exist_ok=True)
    ruta_png = args.salida / 'efectos.png'
    Image.fromarray(atlas).save(ruta_png, optimize=True)
    (args.salida / 'efectos.json').write_text(json_legible(anims), encoding='utf-8')
    peso = ruta_png.stat().st_size
    print(f'atlas {ANCHO_ATLAS}x{alto}  {peso / 1024:.0f} KB  → {ruta_png}')
    if peso >= 1024 * 1024:
        avisos.append(f'el PNG pesa {peso} bytes (≥ 1 MB)')
    for a in avisos:
        print('AVISO:', a, file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())

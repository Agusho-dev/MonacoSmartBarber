"""
Arma la canción de fondo de «Corte Final» (public/juego/audio/neon-dash.mp3) a partir del MP3
original, lista para sonar en bucle sin que se note el empalme.

    python3 scripts/juego/armar_pista.py "~/Downloads/Neon Dash.mp3" public/juego/audio/neon-dash.mp3

Qué hace (30/oct/2026):
  1. Decodifica el original a PCM float 48 kHz estéreo (ffmpeg).
  2. Ubica con precisión de muestra dos ataques: el primer tiempo del tema (A, cerca de --a) y el
     de la tercera sección, que repite la primera y termina en fundido (B, cerca de --b).
  3. Deja el tema hasta B, cocina ahí un fundido de 10 ms hacia una copia de A (cae en el respiro
     que el tema ya tiene antes de ese compás) y agrega 400 ms de continuación.
  4. Codifica con libmp3lame VBR -q:a 5, sin etiquetas ni carátula (≈ 127 kb/s, ≈ 1 MB).
  5. Imprime BUCLE_INICIO y BUCLE_FIN: van a src/lib/juego/audio/pista.ts. ESTÁN ACOPLADOS al
     archivo: si cambia el MP3 y no se actualizan, el bucle salta en cualquier lado.

Los puntos de bucle quedan 100 ms DESPUÉS de cada ataque, sobre audio idéntico, con 300 ms de
cola: si un navegador decodifica el MP3 corrido unos milisegundos, el salto igual no se oye.
Con el original de Neon Dash y el ffmpeg de Homebrew (Lavc 62.28) sale idéntico byte a byte al
que está en el repo.

Requiere ffmpeg, numpy y scipy (pip3 install --user numpy scipy).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from scipy import signal

SR = 48000
FUNDIDO = 0.010  # s; termina justo en el ataque B
MARGEN = 0.100  # s; el punto de bucle va 100 ms después de cada ataque
COLA = 0.300  # s; continuación después del punto de bucle


def ataque(mono, t, ventana=0.012):
    """Comienzo del ataque más fuerte a ±ventana de t (en s): donde la envolvente sube."""
    sos = signal.butter(4, 3000, btype='highpass', fs=SR, output='sos')
    i0 = max(0, int((t - 0.08) * SR))
    i1 = int((t + 0.08) * SR)
    seg = mono[i0:i1]
    e = np.abs(signal.sosfiltfilt(sos, seg)) + np.abs(seg) * 0.5
    e = np.convolve(e, np.ones(48) / 48, mode='same')  # 1 ms
    d = np.diff(e, prepend=e[0])
    lo = int((t - ventana) * SR) - i0
    hi = int((t + ventana) * SR) - i0
    j = lo + int(np.argmax(d[lo:hi]))
    # Retrocede hasta que la envolvente baja al 30 % del salto.
    base = e[max(0, j - 96)]
    while j > lo - 48 and e[j - 1] > base + 0.3 * (e[j] - base):
        j -= 1
    return (i0 + j) / SR


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('original', help='MP3 (o cualquier audio que lea ffmpeg) original')
    ap.add_argument('salida', help='MP3 de salida (public/juego/audio/neon-dash.mp3)')
    ap.add_argument('--a', type=float, default=0.0375, help='segundo aproximado del primer tiempo (A)')
    ap.add_argument('--b', type=float, default=67.085, help='segundo aproximado del ataque donde se empalma (B)')
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        crudo = os.path.join(tmp, 'original.f32')
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-y', '-i', os.path.expanduser(args.original), '-f', 'f32le', '-ac', '2', '-ar', str(SR), crudo],
            check=True,
        )
        x = np.fromfile(crudo, dtype=np.float32).reshape(-1, 2).astype(np.float64)
        mono = x.mean(axis=1)
        a = ataque(mono, args.a)
        b = ataque(mono, args.b)
        ia, ib, nf = int(round(a * SR)), int(round(b * SR)), int(round(FUNDIDO * SR))
        u = (np.arange(nf) + 0.5) / nf
        sale, entra = np.cos(u * np.pi / 2), np.sin(u * np.pi / 2)
        cuerpo = x[: ib - nf]
        fundido = x[ib - nf: ib] * sale[:, None] + x[ia - nf: ia] * entra[:, None]
        sigue = x[ia: ia + int(round((MARGEN + COLA) * SR))]
        pista = np.concatenate([cuerpo, fundido, sigue]).astype(np.float32)

        # El empalme en el PCM: el bucle es [inicio, fin).
        s0, s1 = int(round((a + MARGEN) * SR)), int(round((b + MARGEN) * SR))
        y = np.concatenate([pista[s1 - 4800: s1], pista[s0: s0 + 4800]])
        saltos = np.abs(np.diff(y[:, 0]))

        bucle = os.path.join(tmp, 'bucle.f32')
        pista.tofile(bucle)
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', bucle,
             '-c:a', 'libmp3lame', '-q:a', '5', '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0',
             args.salida],
            check=True,
        )

    info = {
        'A': round(a, 6),
        'B': round(b, 6),
        'duracion': round(len(pista) / SR, 5),
        'largoBucle': round(b - a, 5),
        'saltoEnElEmpalme': round(float(saltos[4799]), 5),
        'p99SaltosVecinos': round(float(np.percentile(saltos, 99)), 5),
        'bytes': os.path.getsize(args.salida),
    }
    print(json.dumps(info, indent=1))
    print('\nEn src/lib/juego/audio/pista.ts:')
    print('export const BUCLE_INICIO = %.5f' % (a + MARGEN))
    print('export const BUCLE_FIN = %.5f' % (b + MARGEN))


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""
Recorte de la hoja de Brian para «Corte Final». El motor es scripts/juego/extraer_stefano.py
(mismas claves del JSON; ver su docstring). Uso, desde MonacoSmartBarber/ y con el candado del modelo:
  TURNO=ml <scratchpad>/herramientas/turno.sh python3 scripts/juego/extraer_brian.py \
      scripts/juego/personajes/brian.json --revision <carpeta> [--solo a,b] [--sin-atlas]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import extraer_stefano  # noqa: E402

if __name__ == '__main__':
    os.environ.setdefault('OMP_NUM_THREADS', '3')
    extraer_stefano.main()

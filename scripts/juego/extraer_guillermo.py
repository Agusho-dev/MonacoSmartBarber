#!/usr/bin/env python3
"""
Atajo: recorta a Guillermo para «Corte Final» con el motor de extraer_gabriel.py (el mismo de las hojas de
18 paneles; ver su docstring). Sin JSON usa scripts/juego/personajes/guillermo.json.

  cd MonacoSmartBarber && OMP_NUM_THREADS=3 python3 scripts/juego/extraer_guillermo.py \\
      [--revision <carpeta>] [--retrato] [--solo a,b] [--detalle anim[:i],...]
"""
import os
import sys

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)
import extraer_gabriel  # noqa: E402

if __name__ == '__main__':
    if len(sys.argv) < 2 or not sys.argv[1].endswith('.json'):
        sys.argv.insert(1, os.path.join(_AQUI, 'personajes', 'guillermo.json'))
    extraer_gabriel.main()

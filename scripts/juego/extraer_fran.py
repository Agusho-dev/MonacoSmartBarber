#!/usr/bin/env python3
"""
Recorte de Fran para «Corte Final» (cuarta tanda, 31/oct/2026): el motor de extraer_gabriel.py (hojas de 18
paneles; ver su docstring de claves) con las extensiones de extraer_chino.py ("pelarFondo" y SIN_MODELO=1;
ver su docstring). Sin JSON usa scripts/juego/personajes/fran.json.

  cd MonacoSmartBarber && TURNO=ml <scratchpad>/herramientas/turno.sh nice -n 15 env OMP_NUM_THREADS=3 \\
      python3 scripts/juego/extraer_fran.py [--revision <carpeta>] [--retrato] [--solo a,b] [--detalle anim[:i],...]
"""
import os
import sys

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)
import extraer_chino  # noqa: E402,F401  (pone las extensiones en el motor)
import extraer_gabriel as G  # noqa: E402

if __name__ == '__main__':
    if len(sys.argv) < 2 or not sys.argv[1].endswith('.json'):
        sys.argv.insert(1, os.path.join(_AQUI, 'personajes', 'fran.json'))
    G.main()

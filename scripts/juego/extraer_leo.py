#!/usr/bin/env python3
"""
Atajo: recorta a Leo para «Corte Final» (cuarta tanda, 31/oct/2026) con el envoltorio de
extraer_lautaro.py (el motor de extraer_gabriel.py más "fondoOscuro", "pelarColor", "abrirZona",
"incluirUltimo", "desaturar", "piernas" y "piso"; ver su docstring). Sin JSON usa
scripts/juego/personajes/leo.json.

  cd MonacoSmartBarber && TURNO=ml <scratchpad>/herramientas/turno.sh nice -n 15 env OMP_NUM_THREADS=3 \\
      python3 scripts/juego/extraer_leo.py [--revision <carpeta>] [--retrato] [--solo a,b] \\
      [--detalle anim[:i],...]
"""
import os
import sys

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)
import extraer_lautaro  # noqa: E402

if __name__ == '__main__':
    if len(sys.argv) < 2 or not sys.argv[1].endswith('.json'):
        sys.argv.insert(1, os.path.join(_AQUI, 'personajes', 'leo.json'))
    extraer_lautaro.main()

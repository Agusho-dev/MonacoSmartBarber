#!/usr/bin/env python3
"""
Extractor de sprites de «Corte Final» para fabri (tanda del 30/oct/2026). El motor vive en
extraer_nico_u.py (envoltorio de extraer_sprites.py y extraer_chipi.py, que no se tocan); este
archivo sólo lo llama. Uso, desde MonacoSmartBarber/ y con el candado del modelo:

  TURNO=ml $SP/herramientas/turno.sh env OMP_NUM_THREADS=3 python3 scripts/juego/extraer_fabri.py \
      scripts/juego/personajes/fabri.json --revision <carpeta> [--solo a,b] [--mascaras] [--retrato]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extraer_nico_u  # noqa: E402

if __name__ == '__main__':
    os.environ.setdefault('OMP_NUM_THREADS', '3')
    extraer_nico_u.main()

#!/usr/bin/env python3
"""
Extractor de Lucas «El Papá» para «Corte Final» (30/oct/2026). La lógica es la de
scripts/juego/extraer_joaquin.py (compartida con Joaquín y Nahuel: ventanas de isnet, sinFondo,
costuras, escala por fila, alias de herramienta1/2, prestados, retrato desde un cuadro).

  cd MonacoSmartBarber && OMP_NUM_THREADS=3 python3 scripts/juego/extraer_lucas.py \
      scripts/juego/personajes/lucas.json [--solo a,b] [--revision <carpeta>] [--retrato] [--detalle a,b]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extraer_joaquin  # noqa: E402

if __name__ == '__main__':
    extraer_joaquin.main()

#!/usr/bin/env python3
"""
Recorte de Nehuen para «Corte Final» (quinta tanda, 14/nov/2026): el motor de extraer_gabriel.py
(hojas de 18 paneles) con las extensiones de extraer_chino.py y extraer_lautaro.py, que pone
extraer_nacho.py (ver sus docstrings; no suma claves propias). Sin JSON usa
scripts/juego/personajes/nehuen.json.

  cd MonacoSmartBarber && TURNO=ml <scratchpad>/herramientas/turno.sh nice -n 15 env OMP_NUM_THREADS=3 \\
      python3 scripts/juego/extraer_nehuen.py [<json>] [--revision <carpeta>] [--retrato] \\
      [--solo a,b] [--detalle anim[:i],...]

Lo propio de la hoja de Nehuen (nehuen_anim.jpg, 1600x900, plantilla de 18 paneles, foto realista; el
detalle, en el "_nota" de cada animación de nehuen.json):
  - Buzo NEGRO sobre un fondo casi del mismo negro. «fondoOscuro» (el del jean de Leo) NO sirve: el
    buzo tiene zonas lisas tan oscuras como el fondo y las agujereaba. El fondo pegado se pela sólo desde
    el borde con «pelarFondo» (lumMax 22, desvío 2,5, 6 pasos) y el que queda encerrado entre las
    piernas o debajo de un arco sale con «excluirFinal» y el contorno medido en la hoja.
  - Casi todos los paneles traen humo gris en el piso: «humo» del motor en la franja de abajo de cada
    panel; los parados y los golpes van con «ancho&panel» o «ancho» según cuál se tragaba menos.
  - El borde de abajo de cada panel tiñe de violeta las suelas: «quitarColor» en esa franja.
  - En SALTAR las gorras de los cuadros más altos se meten en la barra del título: se pinta la barra
    (azul) y el texto antes de inferir.
  - «Desaparecer» (especial 1): los cuadros transparentes y punteados de la hoja no se usan; la
    transparencia la hace el render. La paleta queda en la mano; la paleta y la pelotita sueltas son los
    efectos «paleta» y «pelotita» del atlas.
"""
import os
import sys

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)
import extraer_nacho  # noqa: E402  (pone las extensiones en el motor)

if __name__ == '__main__':
    extraer_nacho.main('nehuen.json')

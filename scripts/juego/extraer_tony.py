#!/usr/bin/env python3
"""
Recorte de Tony para «Corte Final» (quinta tanda, 14/nov/2026): el envoltorio de extraer_nico_m.py (el
motor de extraer_gabriel.py con las extensiones de extraer_chino.py y extraer_lautaro.py, más el
donante por cuadro del injerto; ver su docstring). Sin JSON usa scripts/juego/personajes/tony.json.

  cd MonacoSmartBarber && TURNO=ml <scratchpad>/herramientas/turno.sh nice -n 15 env OMP_NUM_THREADS=3 \\
      python3 scripts/juego/extraer_tony.py [<json>] [--revision <carpeta>] [--retrato] [--solo a,b] \\
      [--detalle anim[:i],...]

Lecciones de esta hoja (tony_anim.jpg, 1448x1086; el detalle, en el "_nota" de cada animación):
  - La hoja es más chica que las otras, pero el quieto mide 120 px como el resto (112-137): la densidad
    del atlas es la misma sin "escalaGlobal" (Brian sí la necesitó: su quieto medía ≈ 97 px).
  - Las filas están dibujadas a otra escala y NO de a fila entera: en la de abajo, daño, KO y levantarse
    van a 0,85 y victoria y burla a 0,78; el ESPECIAL 2, a 0,68 (alto de pie y cabeza medidos a 8x).
  - Jean celeste y camisa caqui sobre el fondo casi negro: "fondoOscuro" (lumMax 40, pelar 2, "cabeza"
    para el pelo oscuro y rizado) saca el fondo encerrado entre las piernas. "humo" del motor NO: el
    jean es gris azulado poco saturado y lo pelaba (perdía la pierna de atrás al correr); el humo gris
    sale por color sólo en la franja de los pies (sat ≤ 0,14 y lum ≤ 175, debajo de las zapatillas).
  - El aura dorada del ESPECIAL 2: "dorados" por color y su filo con "pelarColor"; el humo marrón que
    ilumina (r − b ≥ 25: el jean tiene b > r) por color entre las piernas.
  - El monopatín es utilería: queda en la mano en los cuadros; el que vuela es el efecto «monopatin»
    (contorno medido y la estela azul por color). El papel DESPIDO no va en los cuadros: es el efecto
    «despido», sacado del primer plano con los dedos borrados por "limpiezasColor".
"""
import os
import sys

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)
import extraer_nico_m  # noqa: E402  (pone las extensiones en el motor)

if __name__ == '__main__':
    extraer_nico_m.main('tony.json')

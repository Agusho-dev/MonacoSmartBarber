#!/usr/bin/env python3
"""
Recorte de Nacho para «Corte Final» (quinta tanda, 14/nov/2026). Sin JSON usa
scripts/juego/personajes/nacho.json; extraer_nehuen.py importa este módulo (las extensiones quedan
puestas en el motor).

Es un envoltorio del motor de extraer_gabriel.py (hojas de 18 paneles; ver su docstring: claves del
JSON, --revision, --detalle, --retrato) que carga, SIN tocarlos, los dos envoltorios de la cuarta
tanda, en este orden (no suma claves propias):
  - extraer_chino.py: SIN_MODELO=1, «pelarFondo» (con «bloques»), «limpiezasColor» (inpaint en la
    hoja antes de inferir) y «corteDonante» en el «injerto» (ver su docstring).
  - extraer_lautaro.py: «fondoOscuro» (una pasada o una lista de pasadas por zona), «pelarColor»,
    «abrirZona», «incluirUltimo», «incluirLum», «excluirUltimo», «rellenarUltimo», «desaturar»,
    «piernas» y «piso» (ver su docstring). Con --solo suma solas las animaciones donantes de «piernas».
La limpieza de un cuadro queda encadenada así: motor → «pelarFondo» → «fondoOscuro» y lo demás de
extraer_lautaro.py. Las dos importaciones conviven porque cada una envuelve la función que encuentra
puesta (chino primero, lautaro encima).

  cd MonacoSmartBarber && TURNO=ml <scratchpad>/herramientas/turno.sh nice -n 15 env OMP_NUM_THREADS=3 \\
      python3 scripts/juego/extraer_nacho.py [<json>] [--revision <carpeta>] [--retrato] \\
      [--solo a,b] [--detalle anim[:i],...]

Lo propio de la hoja de Nacho (nacho_anim.jpg, 1536x1024, plantilla de 18 paneles, foto realista; el
detalle, en el "_nota" de cada animación de nacho.json):
  - Remera blanca, pantalón caqui y zapatillas blancas sobre el fondo casi negro: el modelo separa bien
    la ropa. En los parados conviene «ancho&panel» (la del panel se traga el fondo entre las piernas).
  - El borde de abajo del panel corta las piernas a la altura del ruedo en GOLPE 1, LAPTOPAZO, COMBO y
    ESPECIAL 1 (no hay zapatillas): se saca la franja teñida por el borde con «excluir» y se pegan las
    zapatillas de caminar[0] con «piernas» («hasta» = el centro de cada pierna, medido en la hoja).
  - Pega con la laptop: GOLPE BÁSICO 2 es el «Laptopazo» (va en «patada»; herramienta2 es su alias y el
    botón MÁQUINA es el «Remate» del combo, como en las otras hojas de 18). El modelo no ve la laptop
    oscura con borde celeste: entra con «incluirFinal» y su contorno. La laptop sola es el efecto
    «laptop» del atlas.
  - El código flotante, los hologramas, la retícula, el rival (silueta azul), las piedras y el piso
    brillante del Terremoto de código se pintan antes de inferir («pintar») y se restan
    («quitarColor»): los dibuja el render.
"""
import os
import sys

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)
import extraer_chino  # noqa: E402,F401  (SIN_MODELO, pelarFondo, limpiezasColor, corteDonante)
import extraer_lautaro  # noqa: E402  (fondoOscuro, incluirLum, piernas, …)
import extraer_gabriel as G  # noqa: E402


def main(json_por_defecto='nacho.json'):
    if len(sys.argv) < 2 or not sys.argv[1].endswith('.json'):
        sys.argv.insert(1, os.path.join(_AQUI, 'personajes', json_por_defecto))
    extraer_lautaro._sumar_donantes_a_solo()
    G.main()


if __name__ == '__main__':
    main()

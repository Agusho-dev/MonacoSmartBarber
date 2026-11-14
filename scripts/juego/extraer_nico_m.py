#!/usr/bin/env python3
"""
Recorte de Nico M. para «Corte Final» (quinta tanda, 14/nov/2026). extraer_tony.py usa este mismo
envoltorio (importa este módulo: las extensiones quedan puestas). Sin JSON usa
scripts/juego/personajes/nico_m.json.

  cd MonacoSmartBarber && TURNO=ml <scratchpad>/herramientas/turno.sh nice -n 15 env OMP_NUM_THREADS=3 \\
      python3 scripts/juego/extraer_nico_m.py [<json>] [--revision <carpeta>] [--retrato] \\
      [--solo a,b] [--detalle anim[:i],...]

Es el motor de extraer_gabriel.py (hojas de 18 paneles; ver su docstring: claves del JSON, --revision,
--detalle, --retrato) con las extensiones de los dos envoltorios de la cuarta tanda, que se importan
SIN tocarlos y quedan encadenadas (cada uno reemplaza funciones del motor y llama a la anterior):
  - extraer_chino.py: "pelarFondo" (el fondo liso que el modelo se traga al lado de la ropa negra),
    "limpiezasColor" (inpaint en la hoja de lo pintado encima de algo que se quiere recortar; acá, los
    dedos de Tony sobre el papel DESPIDO), "corteDonante" en el "injerto" y SIN_MODELO=1.
  - extraer_lautaro.py: "fondoOscuro" (manchas de fondo negro adentro de la máscara, también como lista
    de pasadas por zona), "pelarColor", "abrirZona", "incluirUltimo", "incluirLum", "excluirUltimo",
    "rellenarUltimo", "desaturar", "piernas" y "piso". Ojo: "piernas", "piso" y "desaturar" extraen
    la animación sin escala y la escalan después; no se mezclan con "injerto" en la misma animación.
El orden de una limpieza por cuadro queda: la del motor (limite, excluir, agregar, incluir,
quitarColor, sombra, humo, pegados, excluirFinal, incluirFinal, cerrar, rellenar) → pelarFondo (+
incluirFinal otra vez) → fondoOscuro → pelarColor → abrirZona → incluirUltimo → incluirLum →
excluirUltimo → rellenarUltimo.

Lo que suma este envoltorio:
  - Un donante por cuadro en el "injerto": "cuadros": {"i": {"donante": [anim, i], "corte",
    "corteDonante"}} pisa al "donante" de la animación (que tiene que estar igual: el motor lo usa con
    --solo). Los primeros planos de Nico M. van sobre las piernas de quieto[0] (de pie) o de golpe[3]
    (el que señala tiene la misma postura que el directo). Con --solo se suman solos a la lista.
  - SIN_MODELO=1 también corta acá (los dos envoltorios lo miran).

Lecciones de esta hoja (el detalle, en el "_nota" de cada animación de nico_m.json):
  - Remera blanca, bermuda cargo negra, GORRA NEGRA y zapatillas blancas sobre el fondo casi negro
    (b − r de 2 a 6 en la bermuda y en el fondo: por color no se separan). La gorra es negra y lisa
    como el fondo: la inferencia «ancho» la pierde en varios cuadros de pegada y "pelarFondo" en
    todo el cuadro se la come en los primeros planos. Lo que anduvo: el contorno de la gorra medido a
    8x ("incluirUltimo"), o "sumar" con la inferencia del panel en la zona de la cabeza. "incluirLum"
    con lumMin 13 se trae fondo pegado a la gorra (el fondo cerca de las cabezas mide de 6 a 15).
  - Los corredores que se pisan: "limite" por cuadro e «ancho&panel» (la del cuadro solo deja un filo
    negro de fondo de 3-6 px que ni pelarFondo ni fondoOscuro sacan: está pegado a la piel, con
    desvío alto).
  - Los dos especiales son primeros planos 1,65 veces más grandes y cortados por el borde del panel
    a la altura de la bermuda: "injerto" con "corteDonante" (escala 0,6 y 0,63). Cortar en el ruedo
    de la remera sobre quieto[0] deja las manos del donante en los bolsillos: completa el brazo que
    cuelga sin escalón. En esos cuadros "pelarFondo" y "humo" van sólo en la franja de abajo ("zona"):
    en todo el cuadro se comían la gorra y el borde de la remera (el blanco de la remera cumple «humo»).
  - En «Espinas» el pelo se para en púas (doradas o negras): es parte del cuerpo y queda en el cuadro.
    Las doradas las da el modelo; las negras vuelven con "incluirLum" y la base del pelo, medida.
"""
import os
import sys

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)
import extraer_chino  # noqa: E402,F401  (pelarFondo, limpiezasColor, corteDonante, SIN_MODELO)
import extraer_lautaro as L  # noqa: E402  (fondoOscuro, incluirLum, piernas, ... ; encadena con chino)
import extraer_gabriel as G  # noqa: E402

_injertar_previo = G.injertar


def injertar(c, inj, opc, extraidos):
    """El injerto del motor (con "corteDonante" de extraer_chino.py) y, además, un donante por cuadro:
    "cuadros": {"i": {"donante": [anim, i], ...}} pisa al de la animación."""
    if opc.get('donante'):
        inj = dict(inj, donante=opc['donante'])
    return _injertar_previo(c, inj, opc, extraidos)


G.injertar = injertar


def _sumar_donantes_por_cuadro_a_solo():
    """Con --solo, el motor sólo suma el donante de la animación: se le suman los de cada cuadro."""
    import json
    if '--solo' not in sys.argv:
        return
    k = sys.argv.index('--solo') + 1
    if k >= len(sys.argv):
        return
    with open(sys.argv[1]) as f:
        cfg = json.load(f)
    solo = [x for x in sys.argv[k].split(',') if x]
    for nombre in list(solo):
        inj = (cfg['animaciones'].get(nombre) or {}).get('injerto') or {}
        for op in (inj.get('cuadros') or {}).values():
            if op.get('donante') and op['donante'][0] not in solo:
                solo.append(op['donante'][0])
    sys.argv[k] = ','.join(solo)


def main(json_por_defecto='nico_m.json'):
    if len(sys.argv) < 2 or not sys.argv[1].endswith('.json'):
        sys.argv.insert(1, os.path.join(_AQUI, 'personajes', json_por_defecto))
    L._sumar_donantes_a_solo()
    _sumar_donantes_por_cuadro_a_solo()
    G.main()


if __name__ == '__main__':
    main()

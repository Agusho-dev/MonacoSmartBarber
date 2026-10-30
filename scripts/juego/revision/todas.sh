#!/bin/bash
# Pelea de revisión de los 13 luchadores en un tamaño, uno por vez. Cada uno pelea contra el que
# le sigue en la lista (así cada luchador aparece de los dos lados) en la arena de su sucursal.
#   scripts/juego/revision/todas.sh <anchoxalto> [ids...]
# Con varios agentes en la Mac, CANDADO=<comando> antepone el candado de Chrome a cada pelea
# (ej. CANDADO="env TURNO=chrome $SP/herramientas/turno.sh"). SALIDA=<carpeta> como en pelea-revision.mjs.
AQUI="$(cd "$(dirname "$0")" && pwd)"
TAM=${1:-844x390}
shift
ORDEN="simon chipi nico_u fabri luciano gabriel guillermo rodrigo joaquin nahuel lucas stefano brian"
IDS="${@:-$ORDEN}"
rival_de() { local prev=""; local first=""; for x in $ORDEN; do [ -z "$first" ] && first=$x; if [ "$prev" = "$1" ]; then echo $x; return; fi; prev=$x; done; echo $first; }
arena_de() { case $1 in simon|nico_u|fabri|luciano) echo rondeau;; gabriel|guillermo) echo caseros;; chipi|nahuel) echo pueyrredon;; *) echo parana;; esac; }
for id in $IDS; do
  rival=$(rival_de $id); arena=$(arena_de $id)
  echo "=== $id contra $rival ($TAM, $arena)"
  $CANDADO node "$AQUI/pelea-revision.mjs" $id $rival $TAM $arena ${SALIDA:+"$SALIDA"} 2>&1 | grep -E "FALTA|ERROR|especial [12]|rendimiento|consola|resultado"
done

#!/bin/bash
# Las 11 peleas contra la CPU del elenco nuevo: cada barbero una vez como jugador y una como rival.
# Uso (desde MonacoSmartBarber/, con el dev server en :3100):
#   TURNO=chrome <scratchpad>/herramientas/turno.sh scripts/juego/integracion/todas-cpu.sh
# Informes y capturas en SALIDA (por defecto, <tmp>/corte-final-integracion).
cd "$(dirname "$0")"
SAL="${SALIDA:-${TMPDIR:-/tmp}/corte-final-integracion}"
OK=0; MAL=0
while read -r a b arena tam; do
  [ -z "$a" ] && continue
  if node pelea-elenco.mjs "$a" "$b" "$arena" "$tam" 9381 > /dev/null 2>&1; then OK=$((OK+1)); else MAL=$((MAL+1)); fi
  tail -1 "$SAL/${a}_vs_${b}_${tam}.txt"
done <<'LISTA'
nico_u fabri rondeau 844x390
fabri luciano rondeau 844x390
luciano gabriel caseros 844x390
gabriel guillermo caseros 844x390
guillermo rodrigo parana 844x390
rodrigo joaquin parana 844x390
joaquin nahuel parana 390x844
nahuel lucas parana 390x844
lucas stefano parana 390x844
stefano brian parana 390x844
brian nico_u rondeau 390x844
LISTA
echo "peleas OK $OK · con fallas $MAL"

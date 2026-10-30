import { Flame, HeartPulse, Orbit, ShieldOff, Snail, Snowflake, Star, Zap } from 'lucide-react'
import type { Lado } from '@/lib/juego/tipos'
import { ESTADOS_HUD, type EstadoHud } from '@/lib/juego/ui/hud'

function IconoEstado({ estado }: { estado: EstadoHud }) {
  switch (estado) {
    case 'congelado':
      return <Snowflake />
    case 'electrocutado':
      return <Zap />
    case 'guardia-rota':
      return <ShieldOff />
    case 'aturdido':
      return <Star />
    case 'mareado':
      return <Orbit />
    case 'quemado':
      return <Flame />
    case 'lento':
      return <Snail />
    case 'curando':
      return <HeartPulse />
  }
}

/**
 * Los íconos de estado al lado del nombre en el HUD (congelado, electrocutado, guardia rota,
 * aturdido, mareado, quemado, lento, curándose). Los prende y apaga hud.ts por `data-on`. Lo usan
 * los dos HUD (contra la CPU y online), así no se desfasan.
 */
export function EstadosHud({ lado }: { lado: Lado }) {
  return (
    <span className="cf-hud__estados">
      {ESTADOS_HUD.map((e) => (
        <span key={e} className="cf-estado" data-estado={e} data-hud={`estado-${lado}-${e}`}>
          <IconoEstado estado={e} />
        </span>
      ))}
    </span>
  )
}

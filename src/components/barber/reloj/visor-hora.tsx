'use client'

import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'

/**
 * La hora del panel del barbero.
 *
 * Existe porque el panel corre en pantalla completa, que esconde la barra de
 * Android, y los barberos salían de pantalla completa sólo para ver la hora.
 * Muestra la hora del DISPOSITIVO —la misma que mostraba esa barra—, no la de
 * la sucursal: es la que el barbero conoce y la que tiene el resto de la tablet.
 *
 * Se actualiza justo al cambiar el minuto (un timeout al próximo borde, no un
 * intervalo que puede llegar 59 segundos tarde) y al volver de un reposo: con la
 * pantalla apagada o el panel en segundo plano Chrome congela los timers, y la
 * hora no puede quedar vieja ni un instante al volver.
 *
 * En el servidor no se dibuja ninguna hora: el render de Vercel corre en UTC y
 * pintaría una hora tres horas corrida hasta hidratar. El visor sale vacío con
 * su tamaño reservado y la hora aparece al montar.
 */

const MINUTO_MS = 60_000

function suscribirAlMinuto(avisar: () => void): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined

  const programar = () => {
    clearTimeout(timeout)
    // +40 ms: que el timeout caiga ya dentro del minuto nuevo, nunca un pelo antes.
    const faltan = MINUTO_MS - (Date.now() % MINUTO_MS) + 40
    timeout = setTimeout(() => {
      avisar()
      programar()
    }, faltan)
  }

  const alVolver = () => {
    if (document.visibilityState !== 'visible') return
    avisar()
    programar()
  }

  programar()
  document.addEventListener('visibilitychange', alVolver)
  window.addEventListener('pageshow', alVolver)
  return () => {
    clearTimeout(timeout)
    document.removeEventListener('visibilitychange', alVolver)
    window.removeEventListener('pageshow', alVolver)
  }
}

const minutoActual = () => Math.floor(Date.now() / MINUTO_MS)
const sinMinutoEnServidor = () => null

/** Minuto actual (ms / 60 000) o null mientras no hay reloj del dispositivo (servidor e hidratación). */
export function useMinutoActual(): number | null {
  return useSyncExternalStore(suscribirAlMinuto, minutoActual, sinMinutoEnServidor)
}

const FORMATO_HORA = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "14:05" → ["14", "05"] con la hora del dispositivo. */
function horaYMinutos(minuto: number): [string, string] {
  const partes = FORMATO_HORA.formatToParts(new Date(minuto * MINUTO_MS))
  const hora = partes.find((p) => p.type === 'hour')?.value ?? '00'
  const minutos = partes.find((p) => p.type === 'minute')?.value ?? '00'
  return [hora, minutos]
}

const TAMANOS = {
  /** Banda de arriba del panel. */
  banda: 'h-[3.75rem] min-w-[10.5rem] rounded-[1.125rem] px-5 text-[3rem] font-semibold max-sm:h-10 max-sm:min-w-[6.25rem] max-sm:rounded-xl max-sm:px-3 max-sm:text-[1.5rem]',
  /** Pantalla de bloqueo (PIN). */
  grande: 'h-32 min-w-[20rem] rounded-[2rem] px-8 text-[5.75rem] font-semibold max-sm:h-24 max-sm:min-w-[14rem] max-sm:rounded-[1.5rem] max-sm:text-[3.75rem]',
} as const

export function VisorHora({
  tamano = 'banda',
  className,
}: {
  tamano?: keyof typeof TAMANOS
  className?: string
}) {
  const minuto = useMinutoActual()
  const [hora, minutos] = minuto === null ? ['00', '00'] : horaYMinutos(minuto)
  const listo = minuto !== null

  return (
    <time
      className={cn('visor-hora select-none', TAMANOS[tamano], className)}
      dateTime={listo ? `${hora}:${minutos}` : undefined}
    >
      {/* Sin hora todavía: el lugar queda reservado y vacío, sin parpadeo de
          cifras (`invisible` también la saca del árbol de accesibilidad). */}
      <span className={cn('inline-flex items-center', !listo && 'invisible')}>
        <span>{hora}</span>
        <span className="visor-dos-puntos">:</span>
        <span>{minutos}</span>
      </span>
    </time>
  )
}

'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Duelo, EstadoDuelo } from '@/lib/juego/online/duelo'
import { Sala, type EstadoSala } from '@/lib/juego/online/sala'
import { publicarDepuracion } from '@/lib/juego/ui/depuracion'

const sinSuscripcion = () => () => {}
const nada = () => null

/**
 * La sala de la sucursal (sólo con sucursal: token del QR o ?s=; sin sucursal no hay sala).
 * La instancia se crea una vez (el constructor es puro) y se conecta en un efecto; con
 * StrictMode se desconecta y reconecta sin problema.
 */
export function useSala(slug: string | null): { sala: Sala | null; estado: EstadoSala | null } {
  const [sala] = useState(() => (slug ? new Sala({ slug, cliente: () => createClient() }) : null))
  useEffect(() => {
    if (!sala) return
    sala.conectar()
    // Gancho de LECTURA para las pruebas (sólo en desarrollo).
    publicarDepuracion('sala', sala)
    return () => sala.desconectar()
  }, [sala])
  const estado = useSyncExternalStore(
    sala ? sala.suscribir : sinSuscripcion,
    sala ? sala.leer : nada,
    nada,
  )
  return { sala, estado }
}

/** El estado del duelo en curso (null si no hay). */
export function useDuelo(duelo: Duelo | null): EstadoDuelo | null {
  return useSyncExternalStore(duelo ? duelo.suscribir : sinSuscripcion, duelo ? duelo.leer : nada, nada)
}

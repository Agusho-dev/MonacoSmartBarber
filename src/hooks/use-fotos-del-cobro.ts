'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  agregarFotos,
  asegurarSesion,
  hidratarFotos,
  quitarFoto,
  reintentarFoto,
  useFotosCorteStore,
  type CobroDeFotos,
  type FotoDelCobro,
} from '@/stores/fotos-corte-store'
import { TOPE_FOTOS_POR_CORTE, type OrigenFoto } from '@/lib/types/fotos-corte'

/** Cada cuánto se pregunta por las fotos del celular mientras hace falta. */
const INTERVALO_MS = 2500

const SIN_FOTOS: FotoDelCobro[] = []

/**
 * Las fotos del corte en el diálogo de cobro. La sesión se abre de forma
 * perezosa: recién con la primera foto (Cámara, Galería) o al mostrar el QR.
 *
 * El estado vive en el store global (src/stores/fotos-corte-store.ts): cerrar
 * el diálogo —o cobrar— no corta las subidas.
 *
 * Polling SIN server actions (un GET al Route Handler, que no se encola con el
 * cobro) y SÓLO mientras sirve: con el QR abierto o, si ya se mostró el QR en
 * este cobro, mientras el diálogo siga abierto (el barbero puede cerrar el QR y
 * seguir sacando fotos con el celular). En pausa con la pestaña oculta.
 */
export function useFotosDelCobro(entradaId: string | null, abierto: boolean) {
  const cobro: CobroDeFotos | undefined = useFotosCorteStore((s) => (entradaId ? s.cobros[entradaId] : undefined))
  const [qrAbierto, setQrAbierto] = useState(false)
  const [esperandoCelular, setEsperandoCelular] = useState(false)

  // Al abrir el cobro: lo que ya había (fotos del celular, o de antes de una recarga).
  useEffect(() => {
    if (!entradaId || !abierto) return
    void hidratarFotos(entradaId)
  }, [entradaId, abierto])

  const sondear = !!entradaId && abierto && (qrAbierto || esperandoCelular)
  useEffect(() => {
    if (!sondear || !entradaId) return
    let vivo = true
    let corriendo = false
    let temporizador: ReturnType<typeof setTimeout> | null = null

    // Encadenado con setTimeout (no setInterval): una consulta lenta no apila otra.
    const tick = async () => {
      temporizador = null
      if (!vivo || corriendo) return
      corriendo = true
      try {
        if (document.visibilityState === 'visible') await hidratarFotos(entradaId)
      } finally {
        corriendo = false
      }
      if (vivo && !temporizador) temporizador = setTimeout(tick, INTERVALO_MS)
    }
    const alVolver = () => {
      if (!vivo || corriendo || document.visibilityState !== 'visible') return
      if (temporizador) clearTimeout(temporizador)
      void tick()
    }

    temporizador = setTimeout(tick, INTERVALO_MS)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      vivo = false
      if (temporizador) clearTimeout(temporizador)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [sondear, entradaId])

  const fotos = useMemo(
    () => (cobro?.fotos ? [...cobro.fotos].sort((a, b) => a.orden - b.orden) : SIN_FOTOS),
    [cobro?.fotos],
  )

  const resumen = useMemo(() => {
    let listas = 0
    let enCurso = 0
    let conError = 0
    for (const f of fotos) {
      if (f.estado === 'lista') listas++
      else if (f.estado === 'error') conError++
      else enCurso++
    }
    const ocupadas = listas + enCurso
    return {
      listas,
      enCurso,
      conError,
      quedan: Math.max(0, TOPE_FOTOS_POR_CORTE - ocupadas),
      enTope: ocupadas >= TOPE_FOTOS_POR_CORTE,
    }
  }, [fotos])

  const agregar = useCallback(
    (archivos: FileList | File[] | null, origen: OrigenFoto = 'tablet') => {
      if (!entradaId || !archivos) return 0
      return agregarFotos(entradaId, Array.from(archivos), origen)
    },
    [entradaId],
  )

  const abrirQr = useCallback(() => {
    if (!entradaId) return
    setQrAbierto(true)
    setEsperandoCelular(true)
    void asegurarSesion(entradaId)
  }, [entradaId])

  const reintentarSesion = useCallback(() => {
    if (entradaId) void asegurarSesion(entradaId)
  }, [entradaId])

  const cerrarQr = useCallback(() => setQrAbierto(false), [])

  const quitar = useCallback(
    (id: string) => {
      if (entradaId) void quitarFoto(entradaId, id)
    },
    [entradaId],
  )

  const reintentar = useCallback(
    (id: string) => {
      if (entradaId) reintentarFoto(entradaId, id)
    },
    [entradaId],
  )

  return {
    fotos,
    resumen,
    sesion: cobro?.sesion ?? null,
    abriendoSesion: cobro?.abriendoSesion ?? false,
    errorSesion: cobro?.errorSesion ?? null,
    agregar,
    quitar,
    reintentar,
    qr: {
      abierto: qrAbierto,
      abrir: abrirQr,
      cerrar: cerrarQr,
      reintentarSesion,
    },
  }
}

export type FotosDelCobroHook = ReturnType<typeof useFotosDelCobro>

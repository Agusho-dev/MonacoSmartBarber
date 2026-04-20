'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Etapas del semáforo del timer del corte activo.
 * - ok:        0–25 min → fondo blanco
 * - heads-up:  25–30 min → celeste
 * - focus:     30–35 min → azul
 * - warn:      35–45 min → amarillo
 * - danger:    45+ min → rojo (pulsante)
 */
export type TimerStage = 'ok' | 'heads-up' | 'focus' | 'warn' | 'danger'

const STAGE_ORDER: TimerStage[] = ['ok', 'heads-up', 'focus', 'warn', 'danger']
const NEXT_BOUNDARIES_MIN = [25, 30, 35, 45, Infinity]

function resolveStage(minutes: number): TimerStage {
  if (minutes >= 45) return 'danger'
  if (minutes >= 35) return 'warn'
  if (minutes >= 30) return 'focus'
  if (minutes >= 25) return 'heads-up'
  return 'ok'
}

function computeMinutes(
  startedAt: string | null | undefined,
  pausedDurationSeconds: number,
  pausedAt: string | null | undefined,
  nowMs: number,
): number | null {
  if (!startedAt) return null
  const start = new Date(startedAt).getTime()
  if (!Number.isFinite(start)) return null
  let elapsedMs = nowMs - start - pausedDurationSeconds * 1000
  if (pausedAt) {
    const pausedSince = new Date(pausedAt).getTime()
    if (Number.isFinite(pausedSince)) {
      elapsedMs -= Math.max(0, nowMs - pausedSince)
    }
  }
  return Math.max(0, elapsedMs) / 60_000
}

interface UseTimerStageOptions {
  startedAt: string | null | undefined
  pausedDurationSeconds?: number
  pausedAt?: string | null | undefined
  onStageChange?: (stage: TimerStage, previous: TimerStage) => void
}

interface UseTimerStageResult {
  stage: TimerStage
  isPaused: boolean
}

/**
 * Retorna la etapa del semáforo del timer. Sólo re-renderiza cuando cruza
 * un umbral (máx. 5 cambios por corte). El timer programa un único setTimeout
 * al próximo boundary y se re-arma recursivamente.
 */
export function useTimerStage({
  startedAt,
  pausedDurationSeconds = 0,
  pausedAt,
  onStageChange,
}: UseTimerStageOptions): UseTimerStageResult {
  // Estado derivado lazy del render inicial — pure function de los props.
  // No depende de Date.now() sincrono durante render: se llama una sola vez en mount.
  const [stage, setStage] = useState<TimerStage>(() => {
    const minutes = computeMinutes(startedAt, pausedDurationSeconds, pausedAt, Date.now())
    return minutes === null ? 'ok' : resolveStage(minutes)
  })

  const onStageChangeRef = useRef(onStageChange)
  useEffect(() => { onStageChangeRef.current = onStageChange }, [onStageChange])

  // Refs espejados para leerlos dentro del timer sin re-armar el effect
  const stageRef = useRef(stage)
  useEffect(() => { stageRef.current = stage }, [stage])

  useEffect(() => {
    // Si no hay started_at: nos aseguramos de que stage sea 'ok' por si el prop
    // cambió desde un valor truthy. Evitamos setState sincrono: usamos rAF.
    if (!startedAt) {
      if (stageRef.current !== 'ok') {
        const id = requestAnimationFrame(() => setStage('ok'))
        return () => cancelAnimationFrame(id)
      }
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const tick = () => {
      if (cancelled) return

      const minutes = computeMinutes(startedAt, pausedDurationSeconds, pausedAt, Date.now())
      if (minutes === null) return

      const next = resolveStage(minutes)
      const prev = stageRef.current

      if (next !== prev) {
        stageRef.current = next
        setStage(next)
        const forward = STAGE_ORDER.indexOf(next) > STAGE_ORDER.indexOf(prev)
        if (forward && onStageChangeRef.current) {
          onStageChangeRef.current(next, prev)
        }
      }

      // Si está pausado, no programamos más ticks — el effect re-inicia al cambiar deps.
      if (pausedAt) return

      const nextBoundary = NEXT_BOUNDARIES_MIN.find(b => b > minutes) ?? Infinity
      if (!Number.isFinite(nextBoundary)) return
      const msUntilBoundary = Math.max(500, (nextBoundary - minutes) * 60_000) + 75
      timeoutId = setTimeout(tick, msUntilBoundary)
    }

    // Primer tick siempre asincrónico para no violar purity rules.
    timeoutId = setTimeout(tick, 0)

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [startedAt, pausedDurationSeconds, pausedAt])

  return { stage, isPaused: !!pausedAt }
}

/**
 * Variante booleana: indica si un timer basado en started_at supera el
 * umbral `thresholdMinutes`. Cambia a `true` una sola vez cuando lo cruza.
 * Útil para el overdue de los descansos.
 */
export function useCrossesThreshold(
  startedAt: string | null | undefined,
  thresholdMinutes: number | null,
): boolean {
  const [crossed, setCrossed] = useState<boolean>(() => {
    if (!startedAt || thresholdMinutes === null || thresholdMinutes <= 0) return false
    const minutes = computeMinutes(startedAt, 0, null, Date.now())
    return minutes !== null && minutes >= thresholdMinutes
  })

  const crossedRef = useRef(crossed)
  useEffect(() => { crossedRef.current = crossed }, [crossed])

  useEffect(() => {
    if (!startedAt || thresholdMinutes === null || thresholdMinutes <= 0) {
      if (crossedRef.current) {
        const id = requestAnimationFrame(() => setCrossed(false))
        return () => cancelAnimationFrame(id)
      }
      return
    }

    const start = new Date(startedAt).getTime()
    if (!Number.isFinite(start)) return

    const thresholdMs = thresholdMinutes * 60_000
    const elapsedMs = Date.now() - start

    if (elapsedMs >= thresholdMs) {
      if (!crossedRef.current) {
        const id = requestAnimationFrame(() => setCrossed(true))
        return () => cancelAnimationFrame(id)
      }
      return
    }

    // Si previamente estaba cruzado pero cambió el startedAt (nuevo descanso),
    // reseteamos asincrónicamente.
    let rafReset: number | null = null
    if (crossedRef.current) {
      rafReset = requestAnimationFrame(() => setCrossed(false))
    }

    const msUntilCross = Math.max(200, thresholdMs - elapsedMs) + 50
    const id = setTimeout(() => setCrossed(true), msUntilCross)
    return () => {
      clearTimeout(id)
      if (rafReset !== null) cancelAnimationFrame(rafReset)
    }
  }, [startedAt, thresholdMinutes])

  return crossed
}

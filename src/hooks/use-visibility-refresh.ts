'use client'

import { useEffect, useRef } from 'react'

/**
 * Custom hook that triggers a callback whenever the page becomes visible again
 * (e.g., when returning from another tab, minimizing Chrome on a tablet, etc.)
 * 
 * Also runs a polling fallback at a configurable interval as a safety net
 * for cases where Supabase Realtime silently disconnects.
 *
 * @param onRefresh - Function to call when the page becomes visible or polling triggers
 * @param pollingIntervalMs - Polling interval in ms (default: 30s). Set to 0 to disable polling.
 */
export function useVisibilityRefresh(
  onRefresh: () => void,
  pollingIntervalMs: number = 30_000
) {
  const onRefreshRef = useRef(onRefresh)
  const lastRefreshRef = useRef(Date.now())

  // Keep the ref updated without triggering re-renders
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    // ── Visibility API: refresh when returning to tab ──
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Only refresh if we've been away for at least 5 seconds
        const elapsed = Date.now() - lastRefreshRef.current
        if (elapsed >= 5_000) {
          lastRefreshRef.current = Date.now()
          onRefreshRef.current()
        }
      }
    }

    // ── Online event: refresh when regaining connectivity ──
    const handleOnline = () => {
      lastRefreshRef.current = Date.now()
      onRefreshRef.current()
    }

    // ── Focus event: backup for tablets that don't fire visibilitychange ──
    const handleFocus = () => {
      const elapsed = Date.now() - lastRefreshRef.current
      if (elapsed >= 5_000) {
        lastRefreshRef.current = Date.now()
        onRefreshRef.current()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleFocus)

    // ── Polling fallback as safety net ──
    let pollingId: ReturnType<typeof setInterval> | null = null
    if (pollingIntervalMs > 0) {
      pollingId = setInterval(() => {
        // Only poll if the page is visible (don't waste resources on hidden tabs)
        if (document.visibilityState === 'visible') {
          lastRefreshRef.current = Date.now()
          onRefreshRef.current()
        }
      }, pollingIntervalMs)
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('focus', handleFocus)
      if (pollingId) clearInterval(pollingId)
    }
  }, [pollingIntervalMs])
}

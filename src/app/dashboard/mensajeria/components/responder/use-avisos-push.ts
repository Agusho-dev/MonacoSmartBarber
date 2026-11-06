'use client'

// Los avisos push de este dispositivo (6/nov/2026). Web Push estándar: el
// service worker es public/sw-avisos.js (scope /dashboard/, sin caché) y el
// servidor firma y cifra cada aviso (src/lib/push/*).
//
// En el iPhone sólo hay avisos con el dashboard AGREGADO A LA PANTALLA DE
// INICIO (iOS 16.4+): en Safari común no existe el permiso. Por eso el primer
// estado posible ahí es «instalar». El permiso se pide sólo al tocar «Activar»
// (iOS lo exige dentro del toque, y pedirlo de entrada lo quema).

import { useCallback, useEffect, useState } from 'react'
import {
  borrarSuscripcionDeAvisos, cambiarPreferenciasDeAvisos, clavePublicaDeAvisos, estadoDeAvisos,
  guardarSuscripcionDeAvisos, probarAvisos, type PreferenciasDeAvisos,
} from '@/lib/actions/avisos-push'

export type EstadoAvisos = 'cargando' | 'no-soportado' | 'instalar' | 'bloqueado' | 'apagado' | 'activo'

const SCOPE = '/dashboard/'

function esIOS(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function esAppInstalada(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function soportaPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** «iPhone · app instalada», «Mac · Chrome»: para reconocer el dispositivo. */
function describirDispositivo(): string {
  const ua = navigator.userAgent
  const equipo = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Computadora'
  const donde = esAppInstalada() ? 'app instalada' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navegador'
  return `${equipo} · ${donde}`
}

function deBase64Url(b64: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (b64.length % 4)) % 4)
  const crudo = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'))
  const salida = new Uint8Array(new ArrayBuffer(crudo.length))
  for (let i = 0; i < crudo.length; i++) salida[i] = crudo.charCodeAt(i)
  return salida
}

async function registroActivo(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw-avisos.js', { scope: SCOPE })
  if (reg.active) return reg
  const sw = reg.installing ?? reg.waiting
  if (sw) {
    await new Promise<void>((listo) => {
      if (sw.state === 'activated') return listo()
      sw.addEventListener('statechange', () => {
        if (sw.state === 'activated') listo()
      })
    })
  }
  return reg
}

async function suscripcionActual(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SCOPE)
  return (await reg?.pushManager.getSubscription()) ?? null
}

function datosDe(sub: PushSubscription): { endpoint: string; p256dh: string; auth: string } | null {
  const j = sub.toJSON()
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null
  return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }
}

export function useAvisosPush() {
  const [estado, setEstado] = useState<EstadoAvisos>('cargando')
  const [preferencias, setPreferencias] = useState<PreferenciasDeAvisos>({ avisarResenas: true, avisarConsultas: true })
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const leer = useCallback(async () => {
    if (!soportaPush()) {
      setEstado(esIOS() && !esAppInstalada() ? 'instalar' : 'no-soportado')
      return
    }
    if (Notification.permission === 'denied') {
      setEstado('bloqueado')
      return
    }
    try {
      const sub = await suscripcionActual()
      const datos = sub ? datosDe(sub) : null
      if (!datos || Notification.permission !== 'granted') {
        setEstado('apagado')
        return
      }
      const r = await estadoDeAvisos(datos.endpoint)
      if (!r.ok) {
        setEstado('apagado')
        return
      }
      if (r.activo) {
        setPreferencias(r.preferencias)
        setEstado('activo')
        // Se vuelve a guardar en silencio: refresca las sucursales que ve la persona.
        void guardarSuscripcionDeAvisos({ ...datos, dispositivo: describirDispositivo() }).catch(() => {})
      } else {
        setEstado('apagado')
      }
    } catch {
      setEstado('apagado')
    }
  }, [])

  useEffect(() => {
    // Diferido: leer el permiso y el service worker no tiene que competir con la carga.
    const t = window.setTimeout(() => { void leer() }, 400)
    return () => window.clearTimeout(t)
  }, [leer])

  /** Pide el permiso y suscribe. Llamarla DIRECTO desde el toque (iOS). */
  const activar = useCallback(async () => {
    setError(null)
    if (!soportaPush()) {
      setEstado(esIOS() && !esAppInstalada() ? 'instalar' : 'no-soportado')
      return false
    }
    setOcupado(true)
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        setEstado(permiso === 'denied' ? 'bloqueado' : 'apagado')
        return false
      }
      const [reg, clave] = await Promise.all([registroActivo(), clavePublicaDeAvisos()])
      if (!clave.ok) throw new Error(clave.error)
      const llave = deBase64Url(clave.clave)
      let sub = await reg.pushManager.getSubscription()
      if (sub) {
        // Una suscripción con otra clave (de una prueba vieja) no sirve: se rehace.
        const actual = sub.options.applicationServerKey
        const misma = actual && new Uint8Array(actual).every((b, i) => b === llave[i])
        if (!misma) {
          await sub.unsubscribe().catch(() => {})
          sub = null
        }
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: llave })
      const datos = datosDe(sub)
      if (!datos) throw new Error('El navegador no dio una suscripción válida.')
      const r = await guardarSuscripcionDeAvisos({ ...datos, dispositivo: describirDispositivo(), ...preferencias })
      if (!r.ok) throw new Error(r.error)
      setPreferencias(r.preferencias)
      setEstado('activo')
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos activar los avisos.')
      return false
    } finally {
      setOcupado(false)
    }
  }, [preferencias])

  const desactivar = useCallback(async () => {
    setError(null)
    setOcupado(true)
    try {
      const sub = await suscripcionActual()
      const datos = sub ? datosDe(sub) : null
      if (datos) {
        const r = await borrarSuscripcionDeAvisos(datos.endpoint)
        if (!r.ok) throw new Error(r.error)
      }
      await sub?.unsubscribe().catch(() => {})
      setEstado('apagado')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron apagar los avisos.')
    } finally {
      setOcupado(false)
    }
  }, [])

  const cambiar = useCallback(async (nuevas: PreferenciasDeAvisos) => {
    const antes = preferencias
    setPreferencias(nuevas)
    setError(null)
    try {
      const sub = await suscripcionActual()
      const datos = sub ? datosDe(sub) : null
      if (!datos) throw new Error('Este dispositivo no tiene los avisos activados.')
      const r = await cambiarPreferenciasDeAvisos(datos.endpoint, nuevas)
      if (!r.ok) throw new Error(r.error)
    } catch (e) {
      setPreferencias(antes)
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    }
  }, [preferencias])

  const probar = useCallback(async () => {
    setError(null)
    setOcupado(true)
    try {
      const sub = await suscripcionActual()
      const datos = sub ? datosDe(sub) : null
      if (!datos) throw new Error('Este dispositivo no tiene los avisos activados.')
      const r = await probarAvisos(datos.endpoint)
      if (!r.ok) throw new Error(r.error)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo mandar la prueba.')
      return false
    } finally {
      setOcupado(false)
    }
  }, [])

  return { estado, preferencias, ocupado, error, activar, desactivar, cambiar, probar, esIOS: typeof navigator !== 'undefined' && esIOS() }
}

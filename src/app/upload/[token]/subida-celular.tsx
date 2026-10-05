'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  Check,
  Clock,
  ImageOff,
  Images,
  Loader2,
  RotateCw,
  Scissors,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { comprimirFotoDeCorte } from '@/lib/image-utils'
import { esVersionDesactualizada, subirAUrlFirmada } from '@/lib/fotos-corte/subida'
import { cantidadDeFotos } from '@/lib/fotos-corte/textos'
import { confirmarSubidaCelular, estadoFotosCelular, pedirSubidaCelular } from '@/lib/actions/fotos-corte'
import type { EstadoCelular } from '@/lib/fotos-corte/contrato'
import { BYTES_MAXIMOS_FOTO, type MotivoErrorFotos } from '@/lib/types/fotos-corte'

type EstadoItem = 'preparando' | 'subiendo' | 'confirmando' | 'lista' | 'error'

interface ItemCelular {
  id: string
  vista: string
  estado: EstadoItem
  progreso: number
  error: string | null
  reintentable: boolean
}

interface DatosItem {
  archivo: File
  blob?: Blob
  contentType?: 'image/webp' | 'image/jpeg'
  rutaSubida?: string
}

const TEXTO_FORMATO = 'Ese formato no se puede subir. Sacá la foto con la cámara o elegí otra.'
const TEXTO_PESADA = 'La foto es muy pesada. Probá con otra.'
const TEXTO_RED = 'No se pudo subir. Tocala para reintentar.'
const TEXTO_VERSION = 'Hay una versión nueva de esta página. Recargala para seguir.'
const NO_REINTENTABLES = new Set<MotivoErrorFotos>(['formato', 'pesada', 'tope', 'cobro_cerrado', 'vencida'])

const PENDIENTES = new Set<EstadoItem>(['preparando', 'subiendo', 'confirmando'])

/** Qué se dibuja: la lista (con cámara y reintentos) o un cierre. */
type Pantalla = 'activa' | 'cerrada' | 'sin_visita' | 'vencida' | 'invalida' | 'error'

function idLocal(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // contexto no seguro
  }
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Página del celular: "Sacar foto" (cámara trasera) y "Elegir de la galería".
 * Cada foto tiene su estado (subiendo con progreso / lista / no se subió, con
 * reintento) y un id estable: la versión anterior tomaba el índice con
 * `uploads.length` dentro del loop y marcaba de verde la miniatura equivocada.
 *
 * Pregunta por el estado de la sesión cada 5 s mientras la página está a la
 * vista: así se entera de que el barbero cobró ("¡Listo!"), de que el código
 * venció o de que el corte se cerró sin cobro, sin Realtime anónimo.
 *
 * Una foto que no se subió NO desaparece porque el barbero cobró: mientras la
 * sesión acepte fotos (los minutos de gracia) se queda la lista con su
 * Reintentar, y el cierre dice cuántas se guardaron y cuáles no entraron.
 */
export function SubidaCelular({ token, inicial }: { token: string; inicial: EstadoCelular }) {
  const [estado, setEstado] = useState<EstadoCelular>(inicial)
  const [items, setItems] = useState<ItemCelular[]>([])
  const [reintentandoEstado, setReintentandoEstado] = useState(false)
  const datos = useRef(new Map<string, DatosItem>())
  const inputCamara = useRef<HTMLInputElement>(null)
  const inputGaleria = useRef<HTMLInputElement>(null)
  const cola = useRef<Promise<void>>(Promise.resolve())
  const vistas = useRef(new Set<string>())

  const editar = useCallback((id: string, cambios: Partial<ItemCelular>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...cambios } : i)))
  }, [])

  const refrescar = useCallback(async (): Promise<number> => {
    try {
      const r = await estadoFotosCelular(token)
      if ('limitado' in r) return 30_000
      setEstado(r)
      return 5_000
    } catch (e) {
      if (esVersionDesactualizada(e)) {
        setEstado((prev) => ({ ...prev, estado: 'error' }))
        return 60_000
      }
      // Sin conexión: se conserva lo último que se sabía y se vuelve a probar.
      return 10_000
    }
  }, [token])

  // Polling encadenado, sólo con la página a la vista y mientras pueda cambiar algo.
  const sigueVivo = estado.estado === 'activa' || (estado.estado === 'cerrada' && estado.aceptaFotos)
  useEffect(() => {
    if (!sigueVivo) return
    let vivo = true
    let corriendo = false
    let temporizador: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      temporizador = null
      if (!vivo || corriendo) return
      corriendo = true
      let espera = 5_000
      try {
        if (document.visibilityState === 'visible') espera = await refrescar()
      } finally {
        corriendo = false
      }
      if (vivo && !temporizador) temporizador = setTimeout(tick, espera)
    }
    const alVolver = () => {
      if (!vivo || corriendo || document.visibilityState !== 'visible') return
      if (temporizador) clearTimeout(temporizador)
      void tick()
    }
    temporizador = setTimeout(tick, 5_000)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      vivo = false
      if (temporizador) clearTimeout(temporizador)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [sigueVivo, refrescar])

  const procesar = useCallback(
    async (id: string) => {
      const d = datos.current.get(id)
      if (!d) return
      try {
        if (!d.blob) {
          editar(id, { estado: 'preparando', progreso: 0, error: null })
          const comprimida = await comprimirFotoDeCorte(d.archivo, { bytesMaximos: BYTES_MAXIMOS_FOTO })
          if (!comprimida.ok) {
            editar(id, {
              estado: 'error',
              error: comprimida.motivo === 'formato' ? TEXTO_FORMATO : TEXTO_PESADA,
              reintentable: false,
            })
            return
          }
          d.blob = comprimida.blob
          d.contentType = comprimida.contentType
        }

        if (!d.rutaSubida) {
          editar(id, { estado: 'subiendo', progreso: 0.02, error: null })
          const pedido = await pedirSubidaCelular(token, { contentType: d.contentType!, bytes: d.blob.size })
          if (!pedido.ok) {
            editar(id, { estado: 'error', error: pedido.error, reintentable: !NO_REINTENTABLES.has(pedido.motivo) })
            if (pedido.motivo === 'vencida' || pedido.motivo === 'cobro_cerrado') void refrescar()
            return
          }
          let ultimo = 0
          const put = await subirAUrlFirmada(pedido.subida.url, d.blob, {
            onProgreso: (f) => {
              if (f === 1 || f - ultimo >= 0.05) {
                ultimo = f
                editar(id, { progreso: Math.max(0.02, f) })
              }
            },
          })
          if (!put.ok) {
            const noSePuede = put.motivo === 'formato' || put.motivo === 'pesada'
            editar(id, {
              estado: 'error',
              error: put.motivo === 'formato' ? TEXTO_FORMATO : put.motivo === 'pesada' ? TEXTO_PESADA : TEXTO_RED,
              reintentable: !noSePuede,
            })
            return
          }
          d.rutaSubida = pedido.subida.ruta
        }

        editar(id, { estado: 'confirmando', progreso: 1 })
        const confirmada = await confirmarSubidaCelular(token, d.rutaSubida)
        if (!confirmada.ok) {
          if (confirmada.motivo === 'no_subida' || confirmada.motivo === 'formato') d.rutaSubida = undefined
          editar(id, {
            estado: 'error',
            error: confirmada.error,
            reintentable: !NO_REINTENTABLES.has(confirmada.motivo),
          })
          // Se cerró o venció mientras subía: la pantalla se pone al día ya.
          if (confirmada.motivo === 'vencida' || confirmada.motivo === 'cobro_cerrado') void refrescar()
          return
        }
        editar(id, { estado: 'lista', error: null })
        setEstado((prev) => ({
          ...prev,
          cantidad: prev.cantidad + 1,
          quedan: Math.max(0, prev.quedan - 1),
        }))
      } catch (e) {
        editar(id, {
          estado: 'error',
          error: esVersionDesactualizada(e) ? TEXTO_VERSION : TEXTO_RED,
          reintentable: !esVersionDesactualizada(e),
        })
      }
    },
    [editar, refrescar, token],
  )

  // De a una: el celular comprime y sube mejor en serie (y las actions de
  // Next van de a una igual).
  const encolar = useCallback(
    (id: string) => {
      cola.current = cola.current.then(() => procesar(id)).catch(() => undefined)
    },
    [procesar],
  )

  const pendientes = items.filter((i) => PENDIENTES.has(i.estado)).length
  const lugar = Math.max(0, estado.quedan - pendientes)
  const fallidas = items.filter((i) => i.estado === 'error')
  const hayReintentables = fallidas.some((i) => i.reintentable)

  const agregar = (archivos: FileList | null) => {
    if (!archivos || archivos.length === 0) return
    const elegidos = Array.from(archivos).slice(0, lugar)
    const nuevos = elegidos.map((archivo) => {
      const id = idLocal()
      datos.current.set(id, { archivo })
      const vista = URL.createObjectURL(archivo)
      vistas.current.add(vista)
      return { id, vista, estado: 'preparando' as const, progreso: 0, error: null, reintentable: true }
    })
    setItems((prev) => [...prev, ...nuevos])
    for (const n of nuevos) encolar(n.id)
  }

  const reintentar = (item: ItemCelular) => {
    if (item.estado !== 'error' || !item.reintentable) return
    editar(item.id, { estado: 'preparando', error: null, progreso: 0 })
    encolar(item.id)
  }

  const quitarConError = (item: ItemCelular) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    URL.revokeObjectURL(item.vista)
    vistas.current.delete(item.vista)
    datos.current.delete(item.id)
  }

  // Al salir de la página, las vistas previas (blob:) se liberan.
  useEffect(() => {
    const creadas = vistas.current
    const mapa = datos.current
    return () => {
      creadas.forEach((u) => URL.revokeObjectURL(u))
      creadas.clear()
      mapa.clear()
    }
  }, [])

  const enviadas = items.filter((i) => i.estado === 'lista').length
  const sinVisita = estado.estado === 'cerrada' && estado.cerradaSinVisita
  // Con el cobro hecho, la lista sigue mientras haya algo que mirar: fotos
  // subiendo, o fallidas que todavía se pueden reintentar (gracia). Recién
  // después, el cierre con el resultado.
  const pantalla: Pantalla = sinVisita
    ? 'sin_visita'
    : estado.estado === 'activa'
      ? 'activa'
      : estado.estado === 'cerrada'
        ? pendientes > 0 || (estado.aceptaFotos && hayReintentables)
          ? 'activa'
          : 'cerrada'
        : pendientes > 0
          ? 'activa'
          : estado.estado
  const deQuien = estado.cliente ? ` de ${estado.cliente}` : ' del cliente'
  // "Juan P." ya termina en punto: sin esto quedaba "Juan P.. Ya podés…"
  const fin = estado.cliente?.endsWith('.') ? '' : '.'

  return (
    <main className="flex min-h-dvh flex-col bg-neutral-950 text-white">
      <Encabezado estado={estado} />

      {pantalla === 'activa' ? (
        <section className="flex flex-1 flex-col px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
          <h1 className="text-[26px] font-black leading-tight tracking-tight">
            Fotos del corte{estado.cliente && <> de <span className="text-emerald-400">{estado.cliente}</span></>}
          </h1>
          {estado.barbero && <p className="mt-1 text-sm text-white/60">con {estado.barbero}</p>}

          {estado.estado === 'cerrada' &&
            (!estado.aceptaFotos || hayReintentables ? (
              <p className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                {estado.aceptaFotos
                  ? 'El cobro ya se cerró. Tenés unos minutos para reintentar las que no se subieron: tocalas.'
                  : 'El cobro ya se cerró y pasó el tiempo para sumar fotos: las que se están subiendo pueden no guardarse.'}
              </p>
            ) : (
              <p className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                El cobro ya se cerró: las fotos que se están subiendo igual quedan en la ficha.
              </p>
            ))}

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={() => inputCamara.current?.click()}
              disabled={lugar === 0 || !estado.aceptaFotos}
              className="flex h-16 items-center justify-center gap-3 rounded-2xl bg-emerald-500 text-lg font-bold text-neutral-950 shadow-lg shadow-emerald-500/20 transition-[transform,background-color] duration-150 hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-40 motion-safe:active:scale-[0.98]"
            >
              <Camera className="size-6" aria-hidden />
              Sacar foto
            </button>
            <button
              type="button"
              onClick={() => inputGaleria.current?.click()}
              disabled={lugar === 0 || !estado.aceptaFotos}
              className="flex h-14 items-center justify-center gap-2.5 rounded-2xl border border-white/15 bg-white/5 text-base font-semibold text-white/90 transition-[transform,background-color] duration-150 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-40 motion-safe:active:scale-[0.98]"
            >
              <Images className="size-5" aria-hidden />
              Elegir de la galería
            </button>
          </div>

          <input
            ref={inputCamara}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            tabIndex={-1}
            onChange={(e) => {
              agregar(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={inputGaleria}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            tabIndex={-1}
            onChange={(e) => {
              agregar(e.target.files)
              e.target.value = ''
            }}
          />

          {items.length === 0 && (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-3xl border border-dashed border-white/15 px-6 py-8 text-center">
              <Images className="size-7 text-white/30" aria-hidden />
              <p className="text-sm text-white/50">Las fotos que saques aparecen acá y en la tablet del local.</p>
            </div>
          )}

          {items.length > 0 && (
            <ul className="mt-6 grid grid-cols-3 gap-2" aria-label="Fotos de este corte">
              {items.map((item) => (
                <li key={item.id} className="relative aspect-square animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none">
                  <button
                    type="button"
                    onClick={() => reintentar(item)}
                    disabled={item.estado !== 'error' || !item.reintentable}
                    aria-label={
                      item.estado === 'lista'
                        ? 'Foto enviada'
                        : item.estado === 'error'
                          ? (item.error ?? 'No se pudo subir')
                          : 'Subiendo foto'
                    }
                    className={cn(
                      'relative block size-full overflow-hidden rounded-2xl border bg-white/5',
                      item.estado === 'error' ? 'border-red-500/60' : 'border-white/10',
                    )}
                  >
                    {/* blob: del celular: next/image no lo optimiza */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.vista} alt="" className="size-full object-cover" />
                    {PENDIENTES.has(item.estado) && (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55">
                        <Loader2 className="size-6 animate-spin motion-reduce:animate-none" aria-hidden />
                        {item.estado === 'subiendo' && (
                          <span className="text-xs font-bold tabular-nums">{Math.round(item.progreso * 100)} %</span>
                        )}
                      </span>
                    )}
                    {item.estado === 'lista' && (
                      <span className="absolute bottom-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-emerald-500" aria-hidden>
                        <Check className="size-3.5 text-neutral-950" />
                      </span>
                    )}
                    {item.estado === 'error' && (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-950/70 px-1 text-center">
                        {item.reintentable ? <RotateCw className="size-5" aria-hidden /> : <AlertCircle className="size-5" aria-hidden />}
                        <span className="text-[11px] font-bold leading-tight">{item.reintentable ? 'Reintentar' : 'No se puede'}</span>
                      </span>
                    )}
                  </button>
                  {item.estado === 'error' && (
                    <button
                      type="button"
                      onClick={() => quitarConError(item)}
                      aria-label="Descartar esta foto"
                      className="absolute -right-2 -top-2 flex size-11 items-center justify-center"
                    >
                      <span className="flex size-6 items-center justify-center rounded-full bg-white text-neutral-950 shadow">
                        <X className="size-3.5" aria-hidden />
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-1.5" aria-live="polite">
            {enviadas > 0 && (
              <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                <Check className="size-4" aria-hidden />
                {cantidadDeFotos(enviadas)} {enviadas === 1 ? 'enviada' : 'enviadas'}
              </p>
            )}
            {items.some((i) => i.estado === 'error') && (
              <p className="flex items-start gap-1.5 text-sm text-red-300" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {[...items].reverse().find((i) => i.estado === 'error')?.error}
              </p>
            )}
            {lugar === 0 && estado.estado === 'activa' && (
              <p className="text-sm text-amber-300">Ya están las 12 fotos que entran por corte.</p>
            )}
          </div>

          {estado.cantidad > 0 && (
            <p className="mt-auto pt-8 text-center text-xs text-white/40">
              Este corte ya tiene {cantidadDeFotos(estado.cantidad)} (entre la tablet y el celular).
            </p>
          )}
        </section>
      ) : pantalla === 'cerrada' ? (
        <Final
          icono={
            fallidas.length > 0 ? (
              <span className="flex size-20 items-center justify-center rounded-full bg-amber-500/15">
                <AlertTriangle className="size-10 text-amber-300" aria-hidden />
              </span>
            ) : (
              <span className="flex size-24 items-center justify-center rounded-full border-2 border-emerald-400 bg-emerald-500/15 animate-pro-celebrate motion-reduce:animate-none">
                <Check className="size-12 text-emerald-300" aria-hidden />
              </span>
            )
          }
          titulo={
            items.length === 0
              ? 'Este cobro ya se cerró.'
              : fallidas.length === 0
                ? '¡Listo!'
                : enviadas === 0
                  ? 'No se guardó ninguna foto.'
                  : `Se guardaron ${enviadas} de ${items.length} fotos.`
          }
          texto={
            items.length === 0
              ? estado.cantidad > 0
                ? `Las fotos quedaron en la ficha${deQuien}${fin} Ya podés cerrar esta pestaña.`
                : 'Ya podés cerrar esta pestaña.'
              : fallidas.length === 0
                ? `${enviadas === 1 ? 'La foto quedó' : `Las ${enviadas} fotos quedaron`} en la ficha${deQuien}${fin} Ya podés cerrar esta pestaña.`
                : fallidas.length === 1
                  ? 'Ésta no entró:'
                  : `Estas ${fallidas.length} no entraron:`
          }
        >
          {fallidas.length > 0 && <NoEntraron items={fallidas} />}
          {estado.aceptaFotos && (
            <>
              <button
                type="button"
                onClick={() => inputCamara.current?.click()}
                className="mt-2 min-h-11 rounded-xl px-4 text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
              >
                ¿Te faltó una? Sumá otra foto
              </button>
              <input
                ref={inputCamara}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                tabIndex={-1}
                onChange={(e) => {
                  agregar(e.target.files)
                  e.target.value = ''
                }}
              />
            </>
          )}
        </Final>
      ) : pantalla === 'sin_visita' ? (
        <Final
          icono={
            <span className="flex size-20 items-center justify-center rounded-full bg-white/10">
              <ImageOff className="size-10 text-white/70" aria-hidden />
            </span>
          }
          titulo="Este corte se cerró sin fotos."
          texto={
            items.length > 0
              ? 'Ya no se pueden subir, y las que mandaste no quedaron en la ficha. Podés cerrar esta pestaña.'
              : 'Ya no se pueden subir. Podés cerrar esta pestaña.'
          }
        />
      ) : pantalla === 'vencida' ? (
        <Final
          icono={
            <span className="flex size-20 items-center justify-center rounded-full bg-amber-500/15">
              <Clock className="size-10 text-amber-300" aria-hidden />
            </span>
          }
          titulo="Este código venció."
          texto="Generá uno nuevo desde la tablet."
        />
      ) : pantalla === 'error' ? (
        <Final
          icono={
            <span className="flex size-20 items-center justify-center rounded-full bg-red-500/15">
              <AlertTriangle className="size-10 text-red-300" aria-hidden />
            </span>
          }
          titulo="No pudimos cargar las fotos."
          texto="Revisá la conexión y probá de nuevo."
        >
          <button
            type="button"
            disabled={reintentandoEstado}
            onClick={async () => {
              setReintentandoEstado(true)
              try {
                await refrescar()
              } finally {
                setReintentandoEstado(false)
              }
            }}
            className="mt-2 flex h-12 items-center gap-2 rounded-2xl bg-white px-6 font-semibold text-neutral-950 disabled:opacity-60"
          >
            {reintentandoEstado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCw className="size-4" aria-hidden />}
            Reintentar
          </button>
        </Final>
      ) : (
        <Final
          icono={
            <span className="flex size-20 items-center justify-center rounded-full bg-red-500/15">
              <X className="size-10 text-red-300" aria-hidden />
            </span>
          }
          titulo="Este código no es válido."
          texto="Generá uno nuevo desde la tablet."
        />
      )}
    </main>
  )
}

function Encabezado({ estado }: { estado: EstadoCelular }) {
  const org = estado.organizacion
  return (
    <header className="flex items-center gap-3 px-5 pb-5 pt-[max(env(safe-area-inset-top),1.25rem)]">
      {org?.logoUrl ? (
        // Logo de la barbería: puede venir de cualquier host, no pasa por next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={org.logoUrl} alt="" className="size-10 rounded-xl bg-white/10 object-cover" />
      ) : (
        <span className="flex size-10 items-center justify-center rounded-xl bg-white/10" aria-hidden>
          <Scissors className="size-5 text-white/70" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">{org?.nombre ?? 'Fotos del corte'}</p>
        {org && <p className="text-xs text-white/50">Fotos del corte</p>}
      </div>
    </header>
  )
}

/**
 * Las fotos que no entraron, con el motivo de cada una: el cierre las nombra en
 * vez de decir "¡Listo!". Una que falló por la red ya no se puede reintentar
 * (se cerró el cobro): su "Tocala para reintentar" no se repite acá.
 */
function NoEntraron({ items }: { items: ItemCelular[] }) {
  return (
    <ul className="mt-1 w-full max-w-xs space-y-2 text-left" aria-label="Fotos que no se guardaron">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-950/40 p-2">
          {/* blob: del celular: next/image no lo optimiza */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.vista} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
          <span className="text-xs leading-snug text-red-100/90">
            {item.reintentable ? 'No llegó a subirse antes de que se cerrara el cobro.' : (item.error ?? 'No se pudo subir.')}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Final({
  icono,
  titulo,
  texto,
  children,
}: {
  icono: React.ReactNode
  titulo: string
  texto: string
  children?: React.ReactNode
}) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-16 text-center">
      {icono}
      <h1 className="text-balance text-2xl font-black tracking-tight">{titulo}</h1>
      <p className="max-w-xs text-pretty text-sm text-white/60">{texto}</p>
      {children}
    </section>
  )
}

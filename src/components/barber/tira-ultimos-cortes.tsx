'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { AlertTriangle, Camera, ImageIcon, RefreshCw, Scissors, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { descripcionDelServicio, fechaLarga, haceCuanto, primerNombre } from '@/lib/fotos-corte/textos'
import { useUltimosCortes, type EstadoUltimosCortes } from '@/hooks/use-ultimos-cortes'
import type { CorteDelCliente } from '@/lib/types/fotos-corte'
import { VisorFotos, type FotoDelVisor } from './visor-fotos'

/**
 * Los últimos cortes de un cliente: cuándo, qué, con quién y sus fotos.
 *
 * API (la usan la tarjeta activa del panel, la ficha y el pop-up de asesoría):
 *
 *   // Se trae sola (una server action por cliente, con caché compartida):
 *   <TiraUltimosCortes clientId={id} limite={3} variante="completa" />
 *
 *   // Controlada: el padre ya pidió los datos con useUltimosCortes (p. ej. para
 *   // mostrar también las notas del cliente con la MISMA llamada):
 *   const { estado, reintentar } = useUltimosCortes(id, { limite: 6 })
 *   <TiraUltimosCortes estado={estado} onReintentar={reintentar} />
 *
 * Variantes:
 *   · `compacta`: una fila con scroll lateral de tarjetas de alto fijo
 *     (miniatura + "hace 3 semanas" + "Corte + Barba · con Nico"). Para lugares
 *     chicos: la tarjeta del cronómetro.
 *   · `completa`: una lista; cada corte con todas sus fotos. Para la ficha y la
 *     asesoría.
 *
 * Tono: `heredado` sobre los fondos de color de la tarjeta del cronómetro
 * (toma el color del texto de afuera y oscurece con negro translúcido);
 * `neutro` en superficies normales (diálogos, hojas).
 *
 * Estados explícitos: cargando, error con Reintentar (nunca "sin historial"
 * por un error), primera visita y cortes sin fotos (que hoy son casi todos:
 * igual se muestran, porque "Corte + Barba · con Nico · hace 3 semanas" ya
 * sirve). Tocar una foto abre el visor a pantalla completa.
 */
export interface TiraUltimosCortesProps {
  /** Cliente. Con `estado` no se usa para pedir nada. null/undefined = no se dibuja. */
  clientId?: string | null
  /** Cortes a mostrar (1–12). Por defecto 6. */
  limite?: number
  variante?: 'compacta' | 'completa'
  tono?: 'heredado' | 'neutro'
  /** Modo controlado (ver arriba). */
  estado?: EstadoUltimosCortes
  onReintentar?: () => void
  /** Sucursal donde se atiende ahora: la de cada corte se muestra sólo si es otra. */
  sucursalActualId?: string | null
  /** Encabezado; null lo oculta. */
  titulo?: string | null
  className?: string
}

export function TiraUltimosCortes({
  clientId,
  limite = 6,
  variante = 'compacta',
  tono = 'neutro',
  estado: estadoExterno,
  onReintentar,
  sucursalActualId = null,
  titulo = 'Últimos cortes',
  className,
}: TiraUltimosCortesProps) {
  const propio = useUltimosCortes(estadoExterno ? null : clientId ?? null, { limite })
  const estado = estadoExterno ?? propio.estado
  const reintentar = onReintentar ?? propio.reintentar
  const [fotoAbierta, setFotoAbierta] = useState<number | null>(null)

  const superficie = tono === 'heredado' ? 'bg-black/10' : 'border bg-muted/40'
  const apagado = tono === 'heredado' ? 'opacity-70' : 'text-muted-foreground'

  // Todas las fotos de la tira en un solo visor: se pasa de un corte al otro.
  const { fotosDelVisor, inicioDe } = useMemo(() => {
    const fotos: FotoDelVisor[] = []
    const inicio = new Map<string, number>()
    if (estado.tipo === 'listo') {
      for (const corte of estado.datos.cortes) {
        inicio.set(corte.visitId, fotos.length)
        const epigrafe = epigrafeDe(corte, sucursalActualId)
        corte.fotos.forEach((f, i) =>
          fotos.push({
            id: f.id,
            src: f.url,
            alt: `Corte del ${fechaLarga(corte.fecha)}${corte.fotos.length > 1 ? `, foto ${i + 1}` : ''}`,
            epigrafe,
          }),
        )
      }
    }
    return { fotosDelVisor: fotos, inicioDe: inicio }
  }, [estado, sucursalActualId])

  if (estado.tipo === 'inactivo') return null

  const encabezado = titulo ? (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className={cn('text-[11px] font-bold uppercase tracking-wider', apagado)}>{titulo}</h3>
      {estado.tipo === 'listo' && estado.datos.totalVisitas > 0 && (
        <span className={cn('text-[11px] tabular-nums', apagado)}>
          {estado.datos.totalVisitas} {estado.datos.totalVisitas === 1 ? 'visita' : 'visitas'}
        </span>
      )}
    </div>
  ) : null

  if (estado.tipo === 'cargando') {
    return (
      <section className={className} aria-busy="true" aria-label={titulo ?? 'Últimos cortes'}>
        {encabezado}
        <div className={cn('flex gap-2 overflow-hidden', variante === 'completa' && 'flex-col')}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                'shrink-0 rounded-2xl motion-safe:animate-pulse',
                tono === 'heredado' ? 'bg-black/10' : 'bg-muted',
                variante === 'compacta' ? 'h-[72px] w-[220px]' : 'h-28 w-full',
              )}
            />
          ))}
        </div>
      </section>
    )
  }

  if (estado.tipo === 'error') {
    return (
      <section className={className} aria-label={titulo ?? 'Últimos cortes'}>
        {encabezado}
        <div
          role="alert"
          className={cn(
            'flex items-center gap-3 rounded-2xl py-2 pl-3 pr-1.5',
            tono === 'heredado' ? 'bg-black/10' : 'border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
          )}
        >
          <AlertTriangle className="size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">No pudimos cargar su historial.</p>
            {estado.error !== 'No pudimos cargar su historial.' && (
              <p className="text-xs opacity-80">{estado.error}</p>
            )}
          </div>
          <button
            type="button"
            onClick={reintentar}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
          >
            <RefreshCw className="size-4" aria-hidden />
            Reintentar
          </button>
        </div>
      </section>
    )
  }

  const { cortes, totalVisitas } = estado.datos
  if (totalVisitas === 0 || cortes.length === 0) {
    return (
      <section className={className} aria-label={titulo ?? 'Últimos cortes'}>
        {encabezado}
        <p className={cn('flex items-center gap-2 rounded-2xl px-3 py-3 text-sm', superficie)}>
          <Sparkles className="size-4 shrink-0 opacity-70" aria-hidden />
          Primera visita: todavía no tiene historial.
        </p>
      </section>
    )
  }

  const hayFotos = cortes.some((c) => c.fotos.length > 0)

  return (
    <section className={className} aria-label={titulo ?? 'Últimos cortes'}>
      {encabezado}

      {variante === 'compacta' ? (
        <ul
          className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Cortes anteriores"
        >
          {cortes.map((corte) => (
            <li key={corte.visitId} className="w-[220px] shrink-0 snap-start">
              <TarjetaCompacta
                corte={corte}
                superficie={superficie}
                apagado={apagado}
                sucursalActualId={sucursalActualId}
                onAbrirFoto={() => setFotoAbierta(inicioDe.get(corte.visitId) ?? 0)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2" aria-label="Cortes anteriores">
          {cortes.map((corte) => (
            <li key={corte.visitId}>
              <FilaCompleta
                corte={corte}
                superficie={superficie}
                apagado={apagado}
                sucursalActualId={sucursalActualId}
                // Si ningún corte tiene fotos, lo dice UNA vez abajo, no en cada fila.
                marcarSinFotos={hayFotos}
                onAbrirFoto={(i) => setFotoAbierta((inicioDe.get(corte.visitId) ?? 0) + i)}
              />
            </li>
          ))}
        </ul>
      )}

      {!hayFotos && (
        <p className={cn('mt-2 flex items-center gap-1.5 text-xs', apagado)}>
          <Camera className="size-3.5 shrink-0" aria-hidden />
          Todavía no hay fotos de sus cortes.
        </p>
      )}

      <VisorFotos fotos={fotosDelVisor} indice={fotoAbierta} onIndice={setFotoAbierta} />
    </section>
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function epigrafeDe(corte: CorteDelCliente, sucursalActualId: string | null): string {
  const partes = [haceCuanto(corte.fecha)]
  const barbero = primerNombre(corte.barbero?.nombre)
  if (barbero) partes.push(`con ${barbero}`)
  const servicio = descripcionDelServicio(corte.servicio, corte.extras)
  if (servicio) partes.push(servicio)
  if (corte.sucursal && corte.sucursal.id !== sucursalActualId && corte.sucursal.nombre) {
    partes.push(corte.sucursal.nombre)
  }
  return partes.join(' · ')
}

interface PiezaProps {
  corte: CorteDelCliente
  superficie: string
  apagado: string
  sucursalActualId: string | null
}

function TarjetaCompacta({ corte, superficie, apagado, sucursalActualId, onAbrirFoto }: PiezaProps & { onAbrirFoto: () => void }) {
  const servicio = descripcionDelServicio(corte.servicio, corte.extras) ?? 'Corte'
  const barbero = primerNombre(corte.barbero?.nombre)
  const otraSucursal = corte.sucursal && corte.sucursal.id !== sucursalActualId ? corte.sucursal.nombre : null
  const portada = corte.fotos[0]

  return (
    <div className={cn('flex h-[72px] items-center gap-2.5 overflow-hidden rounded-2xl p-1.5 pr-3', superficie)}>
      {portada ? (
        <button
          type="button"
          onClick={onAbrirFoto}
          aria-label={`Ver ${corte.fotos.length === 1 ? 'la foto' : `las ${corte.fotos.length} fotos`} del corte de ${haceCuanto(corte.fecha)}`}
          className="group relative size-[60px] shrink-0 overflow-hidden rounded-xl bg-black/10 outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <Image
            src={portada.url}
            alt=""
            fill
            sizes="60px"
            className="object-cover motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-105 group-active:scale-95"
          />
          {corte.fotos.length > 1 && (
            <span className="absolute bottom-1 right-1 rounded-full bg-black/65 px-1.5 text-[10px] font-bold leading-4 text-white">
              +{corte.fotos.length - 1}
            </span>
          )}
        </button>
      ) : (
        <div className="flex size-[60px] shrink-0 items-center justify-center rounded-xl bg-black/[0.06]" aria-hidden>
          <Scissors className="size-5 opacity-40" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold leading-tight">{haceCuanto(corte.fecha)}</p>
        <p className={cn('line-clamp-2 text-xs leading-snug', apagado)}>
          {servicio}
          {barbero && ` · con ${barbero}`}
          {otraSucursal && ` · ${otraSucursal}`}
        </p>
      </div>
    </div>
  )
}

function FilaCompleta({
  corte,
  superficie,
  apagado,
  sucursalActualId,
  marcarSinFotos,
  onAbrirFoto,
}: PiezaProps & { marcarSinFotos: boolean; onAbrirFoto: (indice: number) => void }) {
  const servicio = descripcionDelServicio(corte.servicio, corte.extras) ?? 'Corte'
  const barbero = primerNombre(corte.barbero?.nombre)
  const otraSucursal = corte.sucursal && corte.sucursal.id !== sucursalActualId ? corte.sucursal.nombre : null

  return (
    <div className={cn('rounded-2xl p-3', superficie)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">{servicio}</p>
          <p className={cn('mt-0.5 text-xs', apagado)}>
            {haceCuanto(corte.fecha)}
            {barbero && ` · con ${barbero}`}
            {otraSucursal && ` · ${otraSucursal}`}
          </p>
        </div>
        <span className={cn('shrink-0 text-[11px] tabular-nums', apagado)}>{fechaLarga(corte.fecha)}</span>
      </div>

      {corte.fotos.length > 0 ? (
        <ul className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {corte.fotos.map((foto, i) => (
            <li key={foto.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onAbrirFoto(i)}
                aria-label={`Ver la foto ${i + 1} del corte de ${haceCuanto(corte.fecha)}`}
                className="group relative block size-24 overflow-hidden rounded-xl bg-black/10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Image
                  src={foto.url}
                  alt=""
                  fill
                  sizes="96px"
                  className="object-cover motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-105 group-active:scale-95"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : marcarSinFotos ? (
        <p className={cn('mt-2 flex items-center gap-1.5 text-xs', apagado)}>
          <ImageIcon className="size-3.5" aria-hidden />
          Sin fotos
        </p>
      ) : null}
    </div>
  )
}

'use client'

// Las cuentas de cobro y su conexión con Mercado Pago. Una tarjeta por cuenta
// de MP: "barberia.monaco · Caseros y Paraná" es UNA tarjeta aunque esté
// cargada en dos sucursales. Orden: con error, sin confirmar, sin conectar (por
// % de plata), al día. Una cuenta desactivada con cobros en el período también
// se muestra: los clientes tienen el alias guardado y siguen transfiriendo.
//
// Escritorio: grilla de 4, plegada si todas están al día. Celular: una línea
// ("Cuentas: 14 de 16 conectadas · 1 con error ›") que abre una hoja.

import Link from 'next/link'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Ellipsis,
  Landmark,
  Link2,
  Loader2,
  Plug,
  RefreshCw,
  Unplug,
  XCircle,
} from 'lucide-react'
import type { CuentaConciliacion } from '@/lib/conciliacion-mp/contrato'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { plata, plural, vencimientoCortoAR } from './formato'
import { estaConectada, estadoVivoDeCuenta, faltaConfirmar, lineaCuentas, tieneError, type ResumenCuentas } from './logica'
import { useAhora } from './use-pantalla'
import type { EstadoSync, EstadoSyncCuenta } from './use-sincronizacion'
import { TONO, estiloCuenta } from './visual'

export interface AccionesCuenta {
  onConectar: (c: CuentaConciliacion) => void
  onSeguirLink: (c: CuentaConciliacion) => void
  onSincronizar: (c: CuentaConciliacion) => void
  onConfirmar: (c: CuentaConciliacion) => void
  onDesconectar: (c: CuentaConciliacion) => void
  onMarcarBanco: (c: CuentaConciliacion, esBanco: boolean) => void
}

interface PropsTarjeta {
  cuenta: CuentaConciliacion
  sync: EstadoSyncCuenta | undefined
  totalSync: number
  syncActivo: boolean
  puedeGestionar: boolean
  ocupada: boolean
  acciones: AccionesCuenta
}

/** "Caseros y Paraná" */
export function listaSucursales(c: CuentaConciliacion): string {
  const n = c.sucursales.map((s) => s.nombre)
  if (n.length <= 1) return n[0] ?? ''
  return `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`
}

function LineaSync({ s, total }: { s: EstadoSyncCuenta; total: number }) {
  switch (s.fase) {
    case 'en_cola':
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          En espera para leer
        </p>
      )
    case 'leyendo':
      return (
        <p className="flex items-center gap-1.5 text-xs text-zinc-200">
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          Sincronizando <span className="tabular-nums">{s.posicion}/{total}</span>
        </p>
      )
    case 'listo':
      return (
        <p className="flex items-center gap-1.5 text-xs text-zinc-200">
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
          Leída recién{s.detalle ? <span className="text-muted-foreground"> · {s.detalle}</span> : null}
        </p>
      )
    case 'omitida':
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          {s.detalle}
        </p>
      )
    case 'error':
      return (
        <p className="flex items-start gap-1.5 text-xs text-red-300">
          <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>No se pudo leer{s.detalle ? `: ${s.detalle}` : ''}</span>
        </p>
      )
  }
}

export function TarjetaCuenta({ cuenta: c, sync, totalSync, syncActivo, puedeGestionar, ocupada, acciones }: PropsTarjeta) {
  // "Al día · Leída hace 8 min" lo escribe el servidor al calcular: con el reloj de la pantalla se recuenta.
  const ahora = useAhora()
  const vivo = estadoVivoDeCuenta(c, ahora)
  const conectada = estaConectada(c)
  const sinConfirmar = faltaConfirmar(c)
  const e = estiloCuenta(vivo.estado, c.confirmada, conectada)
  const t = TONO[e.tono]
  const Icono = e.icono
  const sucursales = listaSucursales(c)
  const titular = [c.titular, sucursales].filter(Boolean).join(' · ')
  // Desconectar mientras se la está leyendo dejaba la cuenta otra vez "conectada" sin tokens al
  // terminar la lectura: se espera a que termine.
  const leyendo = sync?.fase === 'leyendo'

  const menu: { texto: string; icono: typeof Plug; accion: () => void; deshabilitado?: boolean }[] = []
  if (puedeGestionar) {
    if (conectada) {
      menu.push({ texto: 'Leer ahora', icono: RefreshCw, accion: () => acciones.onSincronizar(c), deshabilitado: syncActivo })
      menu.push({ texto: 'Desconectar', icono: Unplug, accion: () => acciones.onDesconectar(c), deshabilitado: leyendo })
    } else if (c.estado === 'sin_conectar') {
      // Se aplica a TODAS las cuentas de cobro con ese alias (el aviso lo dice).
      menu.push({ texto: 'No es de Mercado Pago (banco)', icono: Landmark, accion: () => acciones.onMarcarBanco(c, true) })
    } else if (c.estado === 'banco') {
      menu.push({ texto: 'Es de Mercado Pago', icono: Plug, accion: () => acciones.onMarcarBanco(c, false) })
    }
  }

  return (
    <article
      aria-label={`Cuenta ${c.alias ?? 'sin alias'}`}
      className={cn(
        'flex min-h-[88px] min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-3',
        c.estado === 'sin_conectar' && 'border-dashed border-white/20',
        tieneError(c) && 'border-red-500/40',
        sinConfirmar && 'border-amber-500/40',
        !c.activa && 'bg-card/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* "Desactivada" va arriba y no al lado: en la tarjeta de 148 px le comía el alias. */}
          {!c.activa && <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Desactivada</p>}
          <p className="truncate font-mono text-[13px] font-semibold text-zinc-100">{c.alias ?? 'Sin alias'}</p>
          {titular && <p className="truncate text-xs text-muted-foreground">{titular}</p>}
        </div>
        {menu.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 size-8 shrink-0" aria-label={`Más acciones de ${c.alias ?? 'la cuenta'}`}>
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu.map((m) => (
                <DropdownMenuItem key={m.texto} disabled={ocupada || m.deshabilitado === true} onSelect={m.accion}>
                  <m.icono className="size-4" aria-hidden />
                  {m.texto}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {sync ? (
        <LineaSync s={sync} total={totalSync} />
      ) : (
        <p className="flex items-start gap-1.5 text-xs">
          <Icono className={cn('mt-px size-3.5 shrink-0', t.texto)} aria-hidden />
          <span className="min-w-0">
            <span className={cn('font-medium', t.texto)}>{e.etiqueta}</span>
            {vivo.detalle && vivo.detalle !== e.etiqueta && <span className="text-muted-foreground"> · {vivo.detalle}</span>}
          </span>
        </p>
      )}

      <p className="text-xs text-zinc-400 tabular-nums">
        {c.periodo.cobros > 0 ? (
          <>
            {plural(c.periodo.cobros, 'cobro')} · {plata(c.periodo.montoSistema)}
            {c.periodo.paraRevisar > 0 && <span className="text-amber-300"> · {c.periodo.paraRevisar} para revisar</span>}
          </>
        ) : (
          <span className="text-muted-foreground/80">Sin cobros en el período</span>
        )}
      </p>

      {sinConfirmar && (
        <p className="text-xs leading-snug text-amber-200/90">
          Autorizó la cuenta de Mercado Pago de {c.titularMp ?? 'otra persona'}
          {c.emailMp ? ` (${c.emailMp})` : ''}.
        </p>
      )}

      {c.linkPendiente && !conectada && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Link2 className="mt-px size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            Link {c.linkPendiente.abierto ? 'abierto' : 'enviado'} · vence {vencimientoCortoAR(c.linkPendiente.venceEn)}
          </span>
        </p>
      )}

      {c.estado === 'sin_alias' && puedeGestionar && (
        <Link href="/dashboard/finanzas?tab=cuentas" className="text-xs text-[var(--tex-texto)] underline-offset-4 hover:underline">
          Cargale el alias en Cuentas de cobro
        </Link>
      )}

      {puedeGestionar && (
        <AccionesPrincipales
          c={c}
          estado={vivo.estado}
          conectada={conectada}
          sinConfirmar={sinConfirmar}
          ocupada={ocupada}
          syncActivo={syncActivo}
          leyendo={leyendo}
          acciones={acciones}
        />
      )}
    </article>
  )
}

function AccionesPrincipales({
  c,
  estado,
  conectada,
  sinConfirmar,
  ocupada,
  syncActivo,
  leyendo,
  acciones,
}: {
  c: CuentaConciliacion
  /** El estado contado con el reloj de la pantalla (una "Al día" de hace 40 min ya está atrasada). */
  estado: CuentaConciliacion['estado']
  conectada: boolean
  sinConfirmar: boolean
  ocupada: boolean
  syncActivo: boolean
  /** Esta cuenta se está leyendo ahora: no se desconecta hasta que termine. */
  leyendo: boolean
  acciones: AccionesCuenta
}) {
  const boton = 'h-9 gap-1.5 px-3 text-xs sm:h-8'
  if (sinConfirmar) {
    return (
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        <Button size="sm" className={boton} disabled={ocupada} onClick={() => acciones.onConfirmar(c)}>
          {ocupada ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
          Es correcta
        </Button>
        <Button size="sm" variant="outline" className={boton} disabled={ocupada || leyendo} onClick={() => acciones.onDesconectar(c)}>
          No, desconectar
        </Button>
      </div>
    )
  }
  if (c.estado === 'sin_conectar') {
    return (
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {c.linkPendiente ? (
          <Button size="sm" variant="secondary" className={boton} onClick={() => acciones.onSeguirLink(c)}>
            <Link2 className="size-3.5" aria-hidden />
            Ver el link
          </Button>
        ) : (
          <Button size="sm" variant="secondary" className={boton} onClick={() => acciones.onConectar(c)}>
            <Plug className="size-3.5" aria-hidden />
            Conectar
          </Button>
        )}
      </div>
    )
  }
  if (c.estado === 'revocada') {
    return (
      <div className="mt-auto pt-1">
        <Button size="sm" variant="outline" className={cn(boton, 'border-red-500/40 text-red-200 hover:bg-red-500/10')} onClick={() => acciones.onConectar(c)}>
          <Plug className="size-3.5" aria-hidden />
          Volver a autorizar
        </Button>
      </div>
    )
  }
  if (conectada && (estado === 'error' || estado === 'atrasada')) {
    return (
      <div className="mt-auto pt-1">
        <Button
          size="sm"
          variant="outline"
          className={cn(boton, estado === 'error' && 'border-red-500/40 text-red-200 hover:bg-red-500/10')}
          disabled={ocupada || syncActivo}
          onClick={() => acciones.onSincronizar(c)}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {estado === 'error' ? 'Reintentar' : 'Leer ahora'}
        </Button>
      </div>
    )
  }
  return null
}

interface PropsGrilla {
  cuentas: CuentaConciliacion[]
  sync: EstadoSync
  puedeGestionar: boolean
  ocupada: string | null
  acciones: AccionesCuenta
  className?: string
}

export function GrillaCuentas({ cuentas, sync, puedeGestionar, ocupada, acciones, className }: PropsGrilla) {
  return (
    <div className={cn('grid gap-3', className)}>
      {cuentas.map((c) => (
        <TarjetaCuenta
          key={c.id}
          cuenta={c}
          sync={c.cuentaMpId ? sync.cuentas[c.cuentaMpId] : undefined}
          totalSync={sync.total}
          syncActivo={sync.activo}
          puedeGestionar={puedeGestionar}
          ocupada={ocupada === c.id}
          acciones={acciones}
        />
      ))}
    </div>
  )
}

/** Escritorio: la grilla, plegada a una línea cuando todo está al día. */
export function SeccionCuentas({
  cuentas,
  resumen,
  sync,
  plegada,
  onPlegar,
  puedeGestionar,
  ocupada,
  acciones,
}: {
  cuentas: CuentaConciliacion[]
  resumen: ResumenCuentas
  sync: EstadoSync
  plegada: boolean
  onPlegar: (v: boolean) => void
  puedeGestionar: boolean
  ocupada: string | null
  acciones: AccionesCuenta
}) {
  return (
    <section id="cuentas" aria-labelledby="cuentas-titulo" className="hidden scroll-mt-20 lg:block">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="cuentas-titulo" className="text-sm font-semibold">
            Cuentas de cobro
          </h2>
          <p className="truncate text-xs text-muted-foreground">{lineaCuentas(resumen)}</p>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" aria-expanded={!plegada} aria-controls="cuentas-grilla" onClick={() => onPlegar(!plegada)}>
          {plegada ? `Ver las ${cuentas.length} cuentas` : 'Plegar'}
          <ChevronDown className={cn('size-4 transition-transform', !plegada && 'rotate-180')} aria-hidden />
        </Button>
      </div>
      <div id="cuentas-grilla" hidden={plegada}>
        {!plegada && (
          <GrillaCuentas
            cuentas={cuentas}
            sync={sync}
            puedeGestionar={puedeGestionar}
            ocupada={ocupada}
            acciones={acciones}
            // Las dos con min-[…]: Tailwind ordena las arbitrarias antes que xl: y un xl: le ganaría a la de 1400.
            className="grid-cols-2 min-[1280px]:grid-cols-3 min-[1400px]:grid-cols-4"
          />
        )}
      </div>
    </section>
  )
}

/** Celular: una línea que abre la hoja con las tarjetas. */
export function LineaCuentas({ resumen, sync, onAbrir }: { resumen: ResumenCuentas; sync: EstadoSync; onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-white/[0.03] lg:hidden"
    >
      <span className="min-w-0">
        <span>
          Cuentas: {resumen.conectadas} de {resumen.conectables} conectadas
          {resumen.conError > 0 && <span className="text-red-300"> · {resumen.conError} con error</span>}
          {resumen.sinConfirmar > 0 && <span className="text-amber-300"> · {resumen.sinConfirmar} sin confirmar</span>}
        </span>
        {sync.activo && (
          <span className="block text-xs text-muted-foreground">
            Leyendo Mercado Pago… {Math.min(sync.hechas + 1, sync.total)} de {sync.total}
          </span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

export function HojaCuentas({
  abierta,
  onCerrar,
  cuentas,
  resumen,
  sync,
  puedeGestionar,
  ocupada,
  acciones,
}: {
  abierta: boolean
  onCerrar: () => void
  cuentas: CuentaConciliacion[]
  resumen: ResumenCuentas
  sync: EstadoSync
  puedeGestionar: boolean
  ocupada: string | null
  acciones: AccionesCuenta
}) {
  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && onCerrar()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[88dvh] gap-0 rounded-t-2xl p-0"
        onOpenAutoFocus={(e) => {
          const cuerpo = (e.currentTarget instanceof HTMLElement ? e.currentTarget : document).querySelector<HTMLElement>('[data-cuerpo-cuentas]')
          if (cuerpo) {
            e.preventDefault()
            cuerpo.focus({ preventScroll: true })
          }
        }}
      >
        <SheetHeader className="flex-row items-start justify-between gap-3 border-b border-white/[0.06] px-4 pt-4 pb-3">
          <div className="min-w-0">
            <SheetTitle>Cuentas de cobro</SheetTitle>
            <SheetDescription className="text-xs">{lineaCuentas(resumen)}</SheetDescription>
          </div>
          <Button variant="ghost" size="sm" className="-mr-2 h-10 shrink-0" onClick={onCerrar}>
            Cerrar
          </Button>
        </SheetHeader>
        <div data-cuerpo-cuentas tabIndex={-1} className="overflow-y-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none">
          <GrillaCuentas
            cuentas={cuentas}
            sync={sync}
            puedeGestionar={puedeGestionar}
            ocupada={ocupada}
            acciones={acciones}
            className="grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2"
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

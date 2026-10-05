'use client'

import {
  AlertTriangle,
  Check,
  Loader2,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { vibrate } from '@/lib/barber-feedback'
import {
  TOPE_UNIDADES_POR_PRODUCTO,
  lineasVigentes,
  totalDeLineas,
  unidadesDeLineas,
  type LineaDeProducto,
  type ProductoParaCobro,
} from '@/lib/productos/reglas'
import type { EstadoProductos } from '@/hooks/use-productos-de-sucursal'

interface SelectorProductosProps {
  estado: EstadoProductos
  seleccion: LineaDeProducto[]
  onCambiar: (seleccion: LineaDeProducto[]) => void
  onReintentar: () => void
  /**
   * `compacta` en el cobro de un servicio, donde los productos son un agregado
   * (tarjetas más bajas y un resumen al pie); `completa` en la venta directa,
   * donde son todo lo que se vende.
   */
  variante?: 'completa' | 'compacta'
  /** Mientras se registra el cobro no se puede cambiar lo que se está cobrando. */
  deshabilitado?: boolean
  className?: string
}

const TITULO_ERROR = 'No pudimos cargar los productos de la sucursal.'

/**
 * Mosaico táctil de productos: tocar una tarjeta agrega una unidad (como en
 * cualquier caja de mostrador) y el stepper − n + ajusta. El stock del sistema
 * se MUESTRA pero no bloquea: está desfasado (en Paraná el producto más vendido
 * figura en 0) y frenar la venta por un dato de carga es perder la venta. El
 * tope de unidades es el mismo que valida el servidor.
 */
export function SelectorProductos({
  estado,
  seleccion,
  onCambiar,
  onReintentar,
  variante = 'completa',
  deshabilitado = false,
  className,
}: SelectorProductosProps) {
  if (estado.tipo === 'cargando') return <EstadoCargando variante={variante} className={className} />
  if (estado.tipo === 'error') {
    return <EstadoError mensaje={estado.mensaje} onReintentar={onReintentar} className={className} />
  }
  if (estado.productos.length === 0) return <EstadoVacio className={className} />

  const cantidadDe = (id: string) => seleccion.find((l) => l.id === id)?.quantity ?? 0

  // Conserva el orden en que se eligieron (es el orden del ticket que el
  // barbero tiene en la cabeza) y saca la línea cuando llega a 0.
  function cambiarCantidad(id: string, cantidad: number) {
    const acotada = Math.max(0, Math.min(TOPE_UNIDADES_POR_PRODUCTO, cantidad))
    if (acotada === 0) {
      onCambiar(seleccion.filter((l) => l.id !== id))
      return
    }
    const existe = seleccion.some((l) => l.id === id)
    onCambiar(
      existe
        ? seleccion.map((l) => (l.id === id ? { ...l, quantity: acotada } : l))
        : [...seleccion, { id, quantity: acotada }],
    )
  }

  const vigentes = lineasVigentes(estado.productos, seleccion)
  const unidades = unidadesDeLineas(vigentes)

  return (
    <div className={cn('space-y-2', className)}>
      {estado.errorAlActualizar && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 py-1 pl-3 pr-1 text-xs text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">No pudimos actualizar la lista: algún precio o stock puede estar viejo.</span>
          <button
            type="button"
            onClick={onReintentar}
            disabled={estado.actualizando}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
          >
            {estado.actualizando ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden />
            )}
            Reintentar
          </button>
        </div>
      )}

      <ul className="grid grid-cols-2 gap-2 sm:gap-3" aria-label="Productos de la sucursal">
        {estado.productos.map((p) => (
          <li key={p.id} className="min-w-0">
            <TarjetaProducto
              producto={p}
              cantidad={cantidadDe(p.id)}
              onCantidad={(n) => cambiarCantidad(p.id, n)}
              compacta={variante === 'compacta'}
              deshabilitado={deshabilitado}
            />
          </li>
        ))}
      </ul>

      {variante === 'compacta' && unidades > 0 && (
        <p className="text-right text-xs text-muted-foreground tabular-nums">
          {unidades} {unidades === 1 ? 'unidad' : 'unidades'} ·{' '}
          <span className="font-semibold text-foreground">
            {formatCurrency(totalDeLineas(estado.productos, vigentes))}
          </span>
        </p>
      )}
    </div>
  )
}

// ─── Tarjeta ────────────────────────────────────────────────────────────────

interface TarjetaProductoProps {
  producto: ProductoParaCobro
  cantidad: number
  onCantidad: (cantidad: number) => void
  compacta: boolean
  deshabilitado: boolean
}

function TarjetaProducto({ producto, cantidad, onCantidad, compacta, deshabilitado }: TarjetaProductoProps) {
  const elegido = cantidad > 0
  const enTope = cantidad >= TOPE_UNIDADES_POR_PRODUCTO

  return (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-2xl border-2 bg-card',
        'transition-[border-color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none',
        elegido ? 'border-primary bg-primary/5 shadow-sm' : 'border-border',
        deshabilitado && 'opacity-60',
      )}
    >
      <button
        type="button"
        disabled={deshabilitado || enTope}
        onClick={() => {
          vibrate(8)
          onCantidad(cantidad + 1)
        }}
        aria-label={
          elegido
            ? `Sumar otra unidad de ${producto.name}`
            : `Agregar ${producto.name}, ${formatCurrency(producto.sale_price)}`
        }
        className={cn(
          'flex flex-1 flex-col items-start gap-1 text-left outline-none',
          'transition-[background-color,transform] duration-150 motion-reduce:transition-none',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          'active:bg-primary/10 motion-safe:active:scale-[0.98]',
          'disabled:cursor-not-allowed disabled:active:scale-100',
          !elegido && 'hover:bg-muted/50',
          compacta ? 'min-h-[76px] p-3' : 'min-h-[96px] p-3.5',
        )}
      >
        <span
          className={cn(
            'line-clamp-2 break-words pr-7 font-semibold leading-tight',
            compacta ? 'text-sm' : 'text-base',
          )}
        >
          {producto.name}
        </span>
        <span className={cn('font-bold tabular-nums', compacta ? 'text-sm' : 'text-lg')}>
          {formatCurrency(producto.sale_price)}
        </span>
        <ChipStock stock={producto.stock} cantidad={cantidad} />
      </button>

      {elegido && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground animate-in zoom-in-50 duration-200 motion-reduce:animate-none"
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      )}

      {elegido && (
        <div className="flex items-center justify-between gap-1 border-t border-primary/20 p-1 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          <button
            type="button"
            disabled={deshabilitado}
            onClick={() => {
              vibrate(6)
              onCantidad(cantidad - 1)
            }}
            aria-label={cantidad === 1 ? `Quitar ${producto.name}` : `Restar una unidad de ${producto.name}`}
            className={cn(
              'flex size-11 items-center justify-center rounded-xl transition-colors motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
              cantidad === 1 ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted',
            )}
          >
            {cantidad === 1 ? <Trash2 className="size-5" aria-hidden /> : <Minus className="size-5" aria-hidden />}
          </button>

          {/* La región viva es estable; lo que se re-monta (para el "salto" del número) es el span de adentro. */}
          <span aria-live="polite" aria-atomic="true" className="min-w-8 text-center">
            <span
              key={cantidad}
              className="inline-block text-lg font-black tabular-nums animate-in zoom-in-90 duration-150 motion-reduce:animate-none"
            >
              {cantidad}
            </span>
            <span className="sr-only"> {cantidad === 1 ? 'unidad' : 'unidades'} de {producto.name}</span>
          </span>

          <button
            type="button"
            disabled={deshabilitado || enTope}
            onClick={() => {
              vibrate(6)
              onCantidad(cantidad + 1)
            }}
            aria-label={`Sumar una unidad de ${producto.name}`}
            className={cn(
              'flex size-11 items-center justify-center rounded-xl transition-colors hover:bg-muted motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
            )}
          >
            <Plus className="size-5" aria-hidden />
          </button>
        </div>
      )}

      {enTope && (
        <p className="px-3 pb-2 text-[11px] font-medium text-muted-foreground">
          Máximo {TOPE_UNIDADES_POR_PRODUCTO} por venta
        </p>
      )}
    </div>
  )
}

/**
 * El stock que dice el sistema. Ámbar cuando no alcanza, pero sin bloquear:
 * el que manda es el estante, y el aviso deja la diferencia a la vista del
 * encargado.
 */
function ChipStock({ stock, cantidad }: { stock: number | null; cantidad: number }) {
  if (stock === null) return null

  if (stock <= 0 || cantidad > stock) {
    // Hace salto de línea en vez de truncarse: en un teléfono la tarjeta mide
    // ~165 px y "Sin stock en el s…" ya no dice nada.
    return (
      <span className="mt-0.5 inline-flex max-w-full items-start gap-1 rounded-lg bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium leading-snug text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
        <span>
          {stock <= 0 ? 'Sin stock en el sistema' : `${stock === 1 ? 'Queda 1' : `Quedan ${stock}`} en el sistema`}
        </span>
      </span>
    )
  }

  return (
    <span className="mt-0.5 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium leading-tight text-muted-foreground">
      {stock === 1 ? 'Queda 1' : `Quedan ${stock}`}
    </span>
  )
}

// ─── Estados ────────────────────────────────────────────────────────────────

function EstadoCargando({ variante, className }: { variante: 'completa' | 'compacta'; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true">
      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Cargando productos…
      </p>
      <div className="grid grid-cols-2 gap-2 sm:gap-3" aria-hidden>
        {[0, 1].map((i) => (
          <Skeleton
            key={i}
            className={cn('rounded-2xl motion-reduce:animate-none', variante === 'compacta' ? 'h-[76px]' : 'h-24')}
          />
        ))}
      </div>
    </div>
  )
}

function EstadoError({
  mensaje,
  onReintentar,
  className,
}: {
  mensaje: string
  onReintentar: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{TITULO_ERROR}</p>
        {/* El motivo sólo si dice algo más (sesión vencida, sin acceso). */}
        {mensaje !== TITULO_ERROR && <p className="mt-0.5 text-xs opacity-90">{mensaje}</p>}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-11 shrink-0 border-amber-500/50"
        onClick={onReintentar}
      >
        <RefreshCw className="mr-1.5 size-4" aria-hidden />
        Reintentar
      </Button>
    </div>
  )
}

function EstadoVacio({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-dashed p-3 text-muted-foreground',
        className,
      )}
    >
      <Package className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p className="text-sm">
        Esta sucursal no tiene productos activos.
        <span className="mt-0.5 block text-xs">Se cargan desde el panel, en Servicios y Productos.</span>
      </p>
    </div>
  )
}

'use client'

/**
 * Tarjeta «Corte Final» de /dashboard/configuracion: prende o apaga, por sucursal, el QR
 * del juego en la tablet de check-in (`branches.juego_qr_kiosko`, mig 233). Mismo esquema
 * que la asesoría en la entrada: cambio optimista que se confirma con el dato que quedó
 * en la base, y si falla el interruptor vuelve solo. Ver ../.claude/rules/juego.md.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, Gamepad2, Info, Loader2, QrCode, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  actualizarJuegoSucursal,
  obtenerJuegoSucursales,
  type SucursalJuego,
} from '@/lib/actions/juego-config'
import { ARENAS, IDS_ARENAS } from '@/lib/juego/arenas'
import { cn } from '@/lib/utils'

export interface DatosJuego {
  sucursales: SucursalJuego[]
  puedeEditar: boolean
}

interface Props {
  inicial: DatosJuego | null
  errorInicial: string | null
}

const SIN_CONEXION = 'Revisá la conexión y probá de nuevo.'

function sinClave<T>(registro: Record<string, T>, clave: string): Record<string, T> {
  const copia = { ...registro }
  delete copia[clave]
  return copia
}

/** La miniatura de la arena de esa sucursal (null si no tiene: p. ej. la de prueba). */
function miniaturaDe(slug: string): string | null {
  const id = IDS_ARENAS.find((a) => ARENAS[a].sucursalSlug === slug)
  return id ? ARENAS[id].miniatura : null
}

export function JuegoCard({ inicial, errorInicial }: Props) {
  const [datos, setDatos] = useState<DatosJuego | null>(inicial)
  const [error, setError] = useState<string | null>(errorInicial)
  const [recargando, setRecargando] = useState(false)
  /** Valor que se muestra mientras el servidor confirma (se descarta al volver la respuesta). */
  const [optimista, setOptimista] = useState<Record<string, boolean>>({})
  const [guardando, setGuardando] = useState<Record<string, true>>({})

  async function recargar() {
    setRecargando(true)
    try {
      const r = await obtenerJuegoSucursales()
      if (r.ok) {
        setDatos({ sucursales: r.sucursales, puedeEditar: r.puedeEditar })
        setError(null)
      } else {
        setError(r.error)
      }
    } catch {
      setError(SIN_CONEXION)
    } finally {
      setRecargando(false)
    }
  }

  if (!datos) {
    return (
      <Card>
        <CardHeader>
          <TituloCard />
        </CardHeader>
        <CardContent>
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-medium">No pudimos cargar el juego</p>
                <p className="text-xs text-muted-foreground">{error ?? 'Error desconocido.'}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={recargar} disabled={recargando} className="shrink-0">
              {recargando ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const { sucursales, puedeEditar } = datos
  const prendida = (s: SucursalJuego) => optimista[s.id] ?? s.juego_qr_kiosko
  const prendidas = sucursales.filter(prendida)
  // «Probar el juego» abre la arena de la primera sucursal que lo tenga prendido (o la primera).
  const slugPrueba = (prendidas[0] ?? sucursales[0])?.slug ?? 'rondeau'

  async function alternar(s: SucursalJuego, activo: boolean) {
    if (!puedeEditar || guardando[s.id]) return
    setOptimista((p) => ({ ...p, [s.id]: activo }))
    setGuardando((p) => ({ ...p, [s.id]: true }))
    try {
      const r = await actualizarJuegoSucursal(s.id, activo)
      if (!r.ok) {
        toast.error('No pudimos guardar el cambio', {
          description: r.error.startsWith('No pudimos guardar el cambio') ? 'Probá de nuevo.' : r.error,
        })
        return
      }
      // Manda lo que quedó en la base, no lo que se pidió.
      const { sucursal } = r
      setDatos((d) =>
        d
          ? {
              ...d,
              sucursales: d.sucursales.map((x) =>
                x.id === sucursal.id ? { ...x, juego_qr_kiosko: sucursal.juego_qr_kiosko } : x,
              ),
            }
          : d,
      )
      const nombre = sucursal.name || s.name
      toast.success(
        sucursal.juego_qr_kiosko ? `Juego activado en ${nombre}` : `Juego desactivado en ${nombre}`,
        {
          description: sucursal.juego_qr_kiosko
            ? 'La tablet muestra el QR desde el próximo check-in.'
            : 'La tablet deja de mostrar el QR desde el próximo check-in.',
        },
      )
    } catch {
      toast.error('No pudimos guardar el cambio', { description: SIN_CONEXION })
    } finally {
      // Sin la sobreescritura optimista vuelve a mandar el dato: el nuevo si se
      // guardó, el de antes si no (el interruptor se revierte solo).
      setOptimista((p) => sinClave(p, s.id))
      setGuardando((p) => sinClave(p, s.id))
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <TituloCard />
            <CardDescription className="max-w-2xl leading-relaxed">
              El juego de pelea con los barberos para que la espera se haga corta. Después del check-in, la tablet le
              muestra al cliente un QR: juega en su celular, ve cuántos tiene adelante y, cuando lo llaman, el juego se
              pausa y le avisa.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'shrink-0 gap-1.5 px-2.5 py-1',
              prendidas.length > 0 ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'text-muted-foreground',
            )}
          >
            <span
              aria-hidden="true"
              className={cn('size-1.5 rounded-full', prendidas.length > 0 ? 'bg-amber-400' : 'bg-muted-foreground/50')}
            />
            {prendidas.length > 0
              ? `Activo en ${prendidas.length} ${prendidas.length === 1 ? 'sucursal' : 'sucursales'}`
              : 'Apagado'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3"
          >
            <p className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
              {error}
            </p>
            <Button variant="ghost" size="sm" onClick={recargar} disabled={recargando}>
              {recargando ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Reintentar
            </Button>
          </div>
        )}

        {!puedeEditar && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="size-3.5" />
            Sólo lectura: para cambiar esto necesitás el permiso «Modificar configuración general».
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
          {/* ── Dónde: un interruptor por sucursal ── */}
          <section className="min-w-0 space-y-2.5" aria-labelledby="juego-sucursales">
            <h3 id="juego-sucursales" className="text-sm font-medium">
              QR en la tablet de check-in
            </h3>
            {sucursales.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No tenés sucursales a tu cargo.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {sucursales.map((s) => {
                  const on = prendida(s)
                  const ocupada = !!guardando[s.id]
                  const bloqueada = !puedeEditar || ocupada
                  const mini = miniaturaDe(s.slug)
                  return (
                    <li key={s.id}>
                      <label
                        htmlFor={`juego-suc-${s.id}`}
                        className={cn(
                          'flex min-h-16 items-center gap-3 px-3.5 py-2.5 transition-colors',
                          bloqueada ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-muted/40',
                        )}
                      >
                        {/* La arena de ese local: cada sucursal pelea en su propio salón. */}
                        <span
                          aria-hidden="true"
                          className={cn(
                            'relative h-10 w-[72px] shrink-0 overflow-hidden rounded-md border bg-muted bg-cover bg-center transition-[filter,opacity]',
                            on ? 'opacity-100' : 'opacity-60 grayscale',
                          )}
                          style={mini ? { backgroundImage: `url(${mini})` } : undefined}
                        >
                          {!mini && <Gamepad2 className="absolute inset-0 m-auto size-4 text-muted-foreground" />}
                          {on && (
                            <span className="absolute bottom-1 right-1 flex size-4 items-center justify-center rounded-sm bg-black/70 text-amber-300">
                              <QrCode className="size-3" />
                            </span>
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{s.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {on ? 'Muestra el QR después del check-in' : 'Apagado'}
                            {!s.is_active ? ' · Sucursal inactiva' : ''}
                          </p>
                        </div>
                        {ocupada && (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Guardando" />
                        )}
                        <Switch
                          id={`juego-suc-${s.id}`}
                          checked={on}
                          disabled={bloqueada}
                          onCheckedChange={(v) => void alternar(s, v)}
                          aria-label={`Mostrar el juego en la tablet de ${s.name}`}
                        />
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* ── Probarlo antes de prenderlo ── */}
          <aside className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-medium">Probalo antes de prenderlo</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              El juego se abre en cualquier celular con el link, aunque el QR esté apagado. Los clientes sólo llegan por
              el QR de la tablet.
            </p>
            <Button asChild variant="outline" size="sm" className="w-full">
              <a href={`/juego?s=${encodeURIComponent(slugPrueba)}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Probar el juego
              </a>
            </Button>
          </aside>
        </div>

        <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            El cambio se ve en la tablet con el próximo check-in, sin recargarla. Con el QR a la vista, el cartel de
            «¡Tomá asiento!» queda 15 segundos en vez de 5 y tiene un botón «Listo» para el que viene atrás.
          </span>
        </p>
      </CardContent>
    </Card>
  )
}

function TituloCard() {
  return (
    <CardTitle className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
        <Gamepad2 className="size-4" />
      </span>
      Corte Final · el juego de la espera
    </CardTitle>
  )
}

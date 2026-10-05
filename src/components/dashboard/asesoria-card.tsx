'use client'

/**
 * Card de /dashboard/configuracion: «Asesoría en la entrada» (migración 217).
 *
 * Un interruptor POR SUCURSAL (`branches.asesoria_habilitada`, nace apagado):
 * así se puede probar en Test sin publicarlo en los locales. Al prenderlo, la
 * tablet de check-in de esa sucursal suma «¿No sabés qué hacerte?» debajo de
 * los servicios y «Pedir asesoría» en «Mi turno»; en el panel, la tarjeta del
 * cliente lleva el sello «Asesoría» y el barbero ve el pedido al empezar.
 *
 * Prender una sucursal se CONFIRMA (hallazgos asesoria-01 y
 * seguridad-y-despliegue-02): un panel con la versión anterior no sabe cobrar
 * una asesoría (la lista de servicios del cobro viejo no ofrece los principales
 * de la tablet y deja cobrar sin servicio: el corte queda en $0 o como un
 * adicional). El diálogo pide recargar todas las pantallas de la sucursal antes.
 *
 * «Cómo le va» (hallazgo asesoria-05): cuántos la pidieron, cuántos terminaron
 * cobrados, cuántos se cerraron como «Solo asesoría» sin visita y el ticket
 * promedio, por sucursal y por barbero (`obtenerMetricasAsesoria`).
 *
 * La vista previa dibuja la banda REAL del kiosko (`AsesoriaKioskBand`,
 * deshabilitada) sobre el fondo que esa tablet usa de verdad, con la variante
 * clara u oscura que elige el kiosko para ese color.
 *
 * Los cambios son optimistas y se revierten si el servidor no confirma: la
 * pantalla nunca muestra prendido algo que en la base quedó apagado.
 *
 * Colores sin `dark:`: el dashboard es oscuro por los tokens de `:root` y nunca
 * lleva la clase `.dark`, así que una variante `dark:` no se aplicaría nunca y
 * el fucsia «claro» quedaría sin contraste sobre la card.
 */

import { Fragment, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Info,
  Loader2,
  MessageCircleQuestionMark,
  MonitorSmartphone,
  RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AsesoriaKioskBand } from '@/components/checkin/asesoria-kiosk-band'
import {
  TerminalGlobalStyles,
  TerminalSectionGlow,
  terminalBodyMuted,
  terminalH2,
} from '@/components/checkin/terminal-theme'
import {
  actualizarAsesoriaSucursal,
  obtenerAsesoriaSucursales,
  obtenerMetricasAsesoria,
  type MetricasAsesoria,
  type MetricasAsesoriaSucursal,
  type ResultadoMetricasAsesoria,
  type SucursalAsesoria,
} from '@/lib/actions/asesoria'
import { resolveCheckinBackground } from '@/lib/checkin-bg'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface DatosAsesoria {
  sucursales: SucursalAsesoria[]
  /** `settings.manage`: sin él la card es de sólo lectura. */
  puedeEditar: boolean
}

interface Props {
  inicial: DatosAsesoria | null
  errorInicial: string | null
  /** «Cómo le va» de los últimos 30 días, leído por la página junto con la card. */
  metricasIniciales: ResultadoMetricasAsesoria
}

const SIN_CONEXION = 'Se cortó la conexión. Revisá tu internet y probá de nuevo.'

function sinClave<T>(registro: Record<string, T>, clave: string): Record<string, T> {
  if (!(clave in registro)) return registro
  const copia = { ...registro }
  delete copia[clave]
  return copia
}

export function AsesoriaCard({ inicial, errorInicial, metricasIniciales }: Props) {
  const [datos, setDatos] = useState<DatosAsesoria | null>(inicial)
  const [error, setError] = useState<string | null>(errorInicial)
  const [recargando, setRecargando] = useState(false)
  /** Valor que se muestra mientras el servidor confirma (se descarta al volver la respuesta). */
  const [optimista, setOptimista] = useState<Record<string, boolean>>({})
  const [guardando, setGuardando] = useState<Record<string, true>>({})
  /** Sucursal de la vista previa (null = la primera con asesoría, o la primera). */
  const [vistaId, setVistaId] = useState<string | null>(null)
  /** Sucursal que se está por prender: espera que confirmen que recargaron sus pantallas. */
  const [confirmar, setConfirmar] = useState<SucursalAsesoria | null>(null)
  const [pantallasRecargadas, setPantallasRecargadas] = useState(false)

  async function recargar() {
    setRecargando(true)
    try {
      const r = await obtenerAsesoriaSucursales()
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

  // ── Carga inicial fallida: sin datos no hay nada que prender ──
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
                <p className="text-sm font-medium">No pudimos cargar la asesoría en la entrada</p>
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
  const activa = (s: SucursalAsesoria) => optimista[s.id] ?? s.asesoria_habilitada
  const activas = sucursales.filter(activa)
  const sucursalVista =
    sucursales.find((s) => s.id === vistaId) ?? sucursales.find(activa) ?? sucursales[0] ?? null

  async function alternar(s: SucursalAsesoria, habilitada: boolean) {
    if (!puedeEditar || guardando[s.id]) return
    // La vista previa acompaña a la sucursal que se acaba de tocar.
    setVistaId(s.id)
    setOptimista((p) => ({ ...p, [s.id]: habilitada }))
    setGuardando((p) => ({ ...p, [s.id]: true }))
    try {
      const r = await actualizarAsesoriaSucursal(s.id, habilitada)
      if (!r.ok) {
        // El título ya dice qué pasó; el detalle, por qué (permiso, sesión…).
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
                x.id === sucursal.id ? { ...x, asesoria_habilitada: sucursal.asesoria_habilitada } : x,
              ),
            }
          : d,
      )
      const nombre = sucursal.name || s.name
      toast.success(
        sucursal.asesoria_habilitada ? `Asesoría activada en ${nombre}` : `Asesoría desactivada en ${nombre}`,
      )
    } catch {
      toast.error('No pudimos guardar el cambio', { description: SIN_CONEXION })
    } finally {
      // Sin la sobreescritura optimista vuelve a mandar el dato: el nuevo si se
      // guardó, el de antes si no (o sea, el interruptor se revierte solo).
      setOptimista((p) => sinClave(p, s.id))
      setGuardando((p) => sinClave(p, s.id))
    }
  }

  /**
   * Apagar es inmediato. Prender pasa por el diálogo: hasta que todas las
   * pantallas de la sucursal tengan la versión nueva, un panel viejo puede
   * cobrar la asesoría en $0 o como un adicional (ver la cabecera).
   */
  function pedirAlternar(s: SucursalAsesoria, habilitada: boolean) {
    if (!puedeEditar || guardando[s.id]) return
    if (!habilitada) {
      void alternar(s, false)
      return
    }
    setVistaId(s.id)
    setPantallasRecargadas(false)
    setConfirmar(s)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <TituloCard />
              <CardDescription className="max-w-2xl leading-relaxed">
                Suma en la tablet de check-in la opción “¿No sabés qué hacerte?”: el cliente pide asesoría sin costo. En
                el panel, su tarjeta lleva el sello “Asesoría” y el barbero ve el pedido al empezar el corte.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'shrink-0 gap-1.5 px-2.5 py-1',
                activas.length > 0
                  ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300'
                  : 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn('size-1.5 rounded-full', activas.length > 0 ? 'bg-fuchsia-500' : 'bg-muted-foreground/50')}
              />
              {activas.length > 0
                ? `Activa en ${activas.length} ${activas.length === 1 ? 'sucursal' : 'sucursales'}`
                : 'Apagada'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
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

          <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
            {/* ── Dónde: un interruptor por sucursal ── */}
            <section className="min-w-0 space-y-2.5" aria-labelledby="as-sucursales">
              <h3 id="as-sucursales" className="text-sm font-medium">
                Dónde se ofrece
              </h3>
              {sucursales.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No tenés sucursales a tu cargo.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {sucursales.map((s) => {
                    const on = activa(s)
                    const ocupada = !!guardando[s.id]
                    const bloqueada = !puedeEditar || ocupada
                    return (
                      <li key={s.id}>
                        <label
                          htmlFor={`as-suc-${s.id}`}
                          className={cn(
                            'flex min-h-14 items-center gap-3 px-3.5 py-2.5 transition-colors',
                            bloqueada ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-muted/40',
                          )}
                        >
                          <MiniTablet fondo={s.fondo_checkin} activa={on} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{s.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {on ? 'Ofreciendo asesoría' : 'Apagada'}
                              {!s.is_active ? ' · Sucursal inactiva' : ''}
                            </p>
                          </div>
                          {ocupada && (
                            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Guardando" />
                          )}
                          <Switch
                            id={`as-suc-${s.id}`}
                            checked={on}
                            disabled={bloqueada}
                            onCheckedChange={(v) => pedirAlternar(s, v)}
                            aria-label={`Ofrecer asesoría en ${s.name}`}
                          />
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* ── Cómo se ve ── */}
            {sucursalVista && (
              <VistaPrevia
                sucursales={sucursales}
                vista={sucursalVista}
                activaEnVista={activa(sucursalVista)}
                onElegirVista={setVistaId}
              />
            )}
          </div>

          {/* ── Cómo le va ── */}
          <SeccionMetricas inicial={metricasIniciales} hayActivas={activas.length > 0} />

          <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Al cobrar, el barbero elige el servicio que hizo. Si no se hizo nada, la cierra como “Solo asesoría”: no
              cuenta como corte, ni como visita, ni suma puntos. A un cliente con turno no se le ofrece: un turno no tiene
              esa salida.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Prender una sucursal: depende de que TODAS sus pantallas tengan la
          versión nueva (hallazgos asesoria-01 y seguridad-y-despliegue-02).
          Apagar no pasa por acá. */}
      <AlertDialog
        open={!!confirmar}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmar(null)
            setPantallasRecargadas(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Prender la asesoría en {confirmar?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              La tablet de check-in de {confirmar?.name} va a ofrecer “¿No sabés qué hacerte?” debajo de los servicios y
              “Pedir asesoría” en “Mi turno”. Al cobrar, el barbero elige el servicio que hizo o la cierra como “Solo
              asesoría”. La podés apagar cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Antes de prenderla en {confirmar?.name}: recargá el panel en TODAS las tablets de los barberos, el kiosko, la
              TV y las PCs de la recepción. Un panel sin recargar no sabe cobrar una asesoría: puede dejar el corte en $0 o
              cobrarlo como un adicional.
            </span>
          </p>
          <label
            htmlFor="as-pantallas"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40"
          >
            <Checkbox
              id="as-pantallas"
              checked={pantallasRecargadas}
              onCheckedChange={(v) => setPantallasRecargadas(v === true)}
              className="mt-0.5"
            />
            <span className="space-y-1 leading-relaxed">
              <span className="flex items-center gap-1.5 font-medium">
                <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" />
                Ya las recargué
              </span>
              <span className="block text-xs text-muted-foreground">
                Las tablets de los barberos, el kiosko, la TV y las PCs de la recepción de {confirmar?.name}.
              </span>
            </span>
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Después, probala de punta a punta en {confirmar?.name}: anotá a alguien con “¿No sabés qué hacerte?”, atendelo
            y cobralo eligiendo el servicio. Que ande en la sucursal de prueba no alcanza: los servicios de cada local
            pueden estar configurados distinto.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pantallasRecargadas}
              onClick={() => {
                const s = confirmar
                setConfirmar(null)
                setPantallasRecargadas(false)
                if (s) void alternar(s, true)
              }}
            >
              Prender
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════

function TituloCard() {
  return (
    <CardTitle className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-fuchsia-500/10 text-fuchsia-400">
        <MessageCircleQuestionMark className="size-4" />
      </span>
      Asesoría en la entrada
    </CardTitle>
  )
}

/** El color de la tablet de esa sucursal, con el ícono encendido si la asesoría se ve ahí. */
function MiniTablet({ fondo, activa }: { fondo: string; activa: boolean }) {
  const { css, isLight } = resolveCheckinBackground(fondo)
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 shadow-inner"
      style={{ background: css }}
    >
      <MessageCircleQuestionMark
        className={cn(
          'size-4 motion-safe:transition-colors motion-safe:duration-300',
          activa
            ? isLight
              ? 'text-fuchsia-600'
              : 'text-fuchsia-300'
            : isLight
              ? 'text-zinc-400'
              : 'text-white/30',
        )}
      />
    </span>
  )
}

/**
 * «Así la ve el cliente»: el paso «¿Qué te vas a hacer?» de la tablet en
 * miniatura —los servicios como siluetas, para no inventar nombres— con la
 * banda real debajo, sobre el fondo de la sucursal elegida.
 */
function VistaPrevia({
  sucursales,
  vista,
  activaEnVista,
  onElegirVista,
}: {
  sucursales: SucursalAsesoria[]
  vista: SucursalAsesoria
  activaEnVista: boolean
  onElegirVista: (id: string) => void
}) {
  const fondo = resolveCheckinBackground(vista.fondo_checkin)
  const variante = fondo.isLight ? 'clara' : 'oscura'

  return (
    <section className="min-w-0 space-y-2.5" aria-labelledby="as-vista">
      {/* La banda usa las clases de vidrio del kiosko (checkin-glass-*). */}
      <TerminalGlobalStyles />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="as-vista" className="text-sm font-medium">
          Así la ve el cliente
        </h3>
        {sucursales.length > 1 && (
          <div role="group" aria-label="Sucursal de la vista previa" className="flex flex-wrap gap-1.5">
            {sucursales.map((s) => {
              const elegida = s.id === vista.id
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={elegida}
                  onClick={() => onElegirVista(s.id)}
                  className={cn(CLASE_CHIP, elegida ? CLASE_CHIP_ELEGIDO : CLASE_CHIP_LIBRE)}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full border border-white/25"
                    style={{ background: resolveCheckinBackground(s.fondo_checkin).css }}
                  />
                  {s.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div
        className="relative isolate overflow-hidden rounded-2xl border shadow-inner"
        style={{ background: fondo.css, color: fondo.isLight ? '#18181b' : '#f4f4f5' }}
      >
        {!fondo.isLight && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03)_0%,transparent_60%)]"
            />
            <TerminalSectionGlow />
          </>
        )}

        {/* La key re-monta la muestra al cambiar de sucursal: un fundido corto
            en vez de un salto de color. */}
        <div
          key={vista.id}
          className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-4 py-6 md:gap-5 md:px-6 md:py-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
        >
          <div aria-hidden="true" className="text-center">
            <p className={cn(terminalH2, fondo.isLight && 'text-zinc-900')}>¿Qué te vas a hacer?</p>
            <p className={cn('mt-0.5 text-sm md:mt-2 md:text-lg', fondo.isLight ? 'text-zinc-600' : terminalBodyMuted)}>
              Elegí tu servicio
            </p>
          </div>

          <div aria-hidden="true" className="grid w-full gap-3 md:gap-4">
            {[0, 1].map((i) => (
              <div
                key={i}
                className={cn(
                  'flex h-14 items-center justify-between rounded-xl px-5 md:h-16 md:rounded-2xl md:px-7',
                  fondo.isLight ? 'border border-zinc-300 bg-white shadow-sm' : 'checkin-glass-surface border border-white/15',
                )}
              >
                <span
                  className={cn(
                    'h-3 rounded-full',
                    i === 0 ? 'w-24' : 'w-36',
                    fondo.isLight ? 'bg-zinc-200' : 'bg-white/15',
                  )}
                />
                <span className={cn('h-3 w-14 rounded-full', fondo.isLight ? 'bg-zinc-200' : 'bg-white/15')} />
              </div>
            ))}
          </div>

          <AsesoriaKioskBand variante={variante} deshabilitada />
        </div>
      </div>

      {/* Sin «ya aparece»: una tablet que no se recargó todavía no la muestra. */}
      <p className="text-xs text-muted-foreground">
        {activaEnVista
          ? `En ${vista.name} está prendida: la tablet la muestra debajo de los servicios. Si alguna no la muestra, recargala.`
          : `En ${vista.name} está apagada: la tablet no la muestra.`}
      </p>
    </section>
  )
}

/** Chips de selección de la card (sucursal de la vista previa y período de las métricas). */
const CLASE_CHIP = cn(
  'inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-medium',
  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'motion-safe:transition-[background-color,border-color,color] motion-safe:duration-150',
)
const CLASE_CHIP_ELEGIDO = 'border-foreground bg-foreground text-background'
const CLASE_CHIP_LIBRE = 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'

// ═══════════════════════════════════════════════════════════════════════════
// «Cómo le va» (hallazgo asesoria-05)
// ═══════════════════════════════════════════════════════════════════════════

const PERIODOS_DIAS = [7, 30, 90] as const

/**
 * Cómo terminó cada pedido, en el orden del desglose. Los colores son la
 * identidad de cada resultado en la barra, la leyenda y los tiles (el texto
 * nunca va en color): verde = se cobró, fucsia = la asesoría sola, ámbar = se
 * fue sin atenderse, celeste = todavía en la fila. Validados como paleta
 * categórica sobre la card oscura (validador de dataviz, modo oscuro,
 * superficie #0a0a0a): banda de luminosidad, croma, separación con daltonismo
 * entre vecinos (peor par 18,6) y contraste ≥ 3:1. Si se cambian o reordenan,
 * hay que volver a validar: con deuteranopía, el fucsia pegado a un celeste de
 * luminosidad parecida (sky-500) da ΔE 1,8, o sea indistinguibles; por eso el
 * celeste va al final, lejos del fucsia, y en su tono más oscuro.
 */
const COLOR_DE = {
  cobradas: 'bg-emerald-600',
  soloAsesoria: 'bg-fuchsia-500',
  salieron: 'bg-amber-600',
  pendientes: 'bg-sky-600',
} as const satisfies Partial<Record<keyof MetricasAsesoria, string>>

const DESGLOSE: ReadonlyArray<{ clave: keyof typeof COLOR_DE; etiqueta: string; color: string }> = [
  { clave: 'cobradas', etiqueta: 'Se cobraron', color: COLOR_DE.cobradas },
  { clave: 'soloAsesoria', etiqueta: 'Solo asesoría', color: COLOR_DE.soloAsesoria },
  { clave: 'salieron', etiqueta: 'Se fueron', color: COLOR_DE.salieron },
  { clave: 'pendientes', etiqueta: 'En la fila', color: COLOR_DE.pendientes },
]

function numero(n: number): string {
  return n.toLocaleString('es-AR')
}

/** Porcentaje entero de `parte` sobre `total`, o null si no hay base. */
function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 100) : null
}

/** Las que el barbero ATENDIÓ: se cobraron o se cerraron como solo asesoría. */
function atendidas(m: MetricasAsesoria): number {
  return m.cobradas + m.soloAsesoria
}

/**
 * «Cómo le va»: la lectura viene de la página (30 días); cambiar el período o
 * actualizar vuelve a pedirla. Mientras carga se ve lo anterior atenuado (sin
 * saltos). Un error se muestra como error con «Reintentar», nunca como ceros
 * (Known Risk #5/#13). Sin `settings.view` la sección no se muestra.
 */
function SeccionMetricas({ inicial, hayActivas }: { inicial: ResultadoMetricasAsesoria; hayActivas: boolean }) {
  const [resultado, setResultado] = useState<ResultadoMetricasAsesoria>(inicial)
  const [dias, setDias] = useState<number>(inicial.ok ? inicial.dias : 30)
  const [cargando, setCargando] = useState(false)
  /** Sólo manda la última respuesta: tocar 7 y 90 seguido no deja pintada la de 7. */
  const pedidoRef = useRef(0)

  async function cargar(nuevosDias: number) {
    const pedido = ++pedidoRef.current
    setDias(nuevosDias)
    setCargando(true)
    try {
      const r = await obtenerMetricasAsesoria({ dias: nuevosDias })
      if (pedido === pedidoRef.current) setResultado(r)
    } catch {
      if (pedido === pedidoRef.current) setResultado({ ok: false, error: SIN_CONEXION })
    } finally {
      if (pedido === pedidoRef.current) setCargando(false)
    }
  }

  if (!resultado.ok && resultado.sinPermiso) return null

  return (
    <section className="min-w-0 space-y-3 border-t pt-6" aria-labelledby="as-metricas">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-0.5">
          <h3 id="as-metricas" className="text-sm font-medium">
            Cómo le va
          </h3>
          <p className="text-xs text-muted-foreground">
            Los que la pidieron en los últimos {dias} días y cómo terminó cada uno, por sucursal y barbero.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div role="group" aria-label="Período" className="flex gap-1.5">
            {PERIODOS_DIAS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={p === dias}
                onClick={() => void cargar(p)}
                className={cn(CLASE_CHIP, p === dias ? CLASE_CHIP_ELEGIDO : CLASE_CHIP_LIBRE)}
              >
                {p} días
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            onClick={() => void cargar(dias)}
            disabled={cargando}
            aria-label="Actualizar"
            title="Actualizar"
          >
            {cargando ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      {!resultado.ok ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
            {resultado.error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void cargar(dias)} disabled={cargando} className="shrink-0">
            {cargando ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Reintentar
          </Button>
        </div>
      ) : (
        <div
          aria-busy={cargando || undefined}
          className={cn('space-y-4 motion-safe:transition-opacity motion-safe:duration-200', cargando && 'opacity-60')}
        >
          {resultado.total.pidieron === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
              <MessageCircleQuestionMark className="size-5 text-muted-foreground/70" />
              <p className="max-w-sm text-sm text-muted-foreground">
                {hayActivas
                  ? `Nadie la pidió en los últimos ${resultado.dias} días.`
                  : 'Todavía no hay pedidos. Aparecen acá cuando la prendas en una sucursal y alguien la pida en la tablet.'}
              </p>
            </div>
          ) : (
            <>
              <TilesMetricas m={resultado.total} />
              <DesgloseMetricas m={resultado.total} />
              <TablaMetricas sucursales={resultado.sucursales} />
            </>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        “Atendidas” son las que se cobraron más las que quedaron en solo asesoría. “Se fueron” salieron de la fila sin
        atenderse (no se presentó, vencidas a la noche, pasaron a otra sucursal). El barbero es el que lo atendió;
        “Sin barbero asignado” es Menor espera que todavía nadie tomó. El ticket promedio es el importe final de la
        visita, con descuentos.
      </p>
    </section>
  )
}

function TilesMetricas({ m }: { m: MetricasAsesoria }) {
  const base = atendidas(m)
  const pctCobradas = porcentaje(m.cobradas, base)
  const pctSolo = porcentaje(m.soloAsesoria, base)
  const tiles: Array<{ etiqueta: string; valor: string; detalle: string; color?: string }> = [
    {
      etiqueta: 'Pidieron asesoría',
      valor: numero(m.pidieron),
      detalle: m.pendientes > 0 ? `${numero(m.pendientes)} todavía en la fila` : 'En la tablet de entrada',
    },
    {
      etiqueta: 'Se cobraron',
      valor: numero(m.cobradas),
      detalle: pctCobradas !== null ? `${pctCobradas}% de las atendidas` : 'Ninguna atendida todavía',
      color: COLOR_DE.cobradas,
    },
    {
      etiqueta: 'Solo asesoría',
      valor: numero(m.soloAsesoria),
      detalle: pctSolo !== null ? `${pctSolo}% de las atendidas · sin visita` : 'Ninguna atendida todavía',
      color: COLOR_DE.soloAsesoria,
    },
    {
      etiqueta: 'Ticket promedio',
      valor: m.ticketPromedio !== null ? formatCurrency(m.ticketPromedio) : '—',
      detalle: m.ticketPromedio !== null ? 'De las que se cobraron' : 'Sin cobros todavía',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.etiqueta} className="rounded-lg border bg-muted/20 p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {t.color && <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-[2px]', t.color)} />}
            {t.etiqueta}
          </p>
          <p className="mt-0.5 text-xl font-semibold">{t.valor}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t.detalle}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * Cómo terminaron los pedidos, como una sola barra partida (parte de un todo).
 * Las separaciones son huecos de 2 px del color de la card, no bordes; la
 * leyenda lleva los números, así que el color nunca es lo único que informa.
 */
function DesgloseMetricas({ m }: { m: MetricasAsesoria }) {
  const partes = DESGLOSE.map((d) => ({ ...d, valor: m[d.clave] }))
  const resumen =
    `De ${numero(m.pidieron)} que la pidieron: ` +
    partes.map((p) => `${p.etiqueta.toLowerCase()} ${numero(p.valor)}`).join(', ')

  return (
    <div className="space-y-2">
      <div role="img" aria-label={resumen} className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-[4px]">
        {partes
          .filter((p) => p.valor > 0)
          .map((p) => (
            <div
              key={p.clave}
              title={`${p.etiqueta}: ${numero(p.valor)} (${porcentaje(p.valor, m.pidieron)}%)`}
              className={cn('h-full min-w-1', p.color)}
              style={{ flexGrow: p.valor, flexBasis: 0 }}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {partes.map((p) => (
          <li key={p.clave} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn('size-2.5 shrink-0 rounded-[3px]', p.color, p.valor === 0 && 'opacity-40')}
            />
            <span className="text-muted-foreground">{p.etiqueta}</span>
            <span className="font-medium tabular-nums">{numero(p.valor)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Por sucursal (fila con sus totales) y, debajo, cada barbero. */
function TablaMetricas({ sucursales }: { sucursales: MetricasAsesoriaSucursal[] }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3">Sucursal y barbero</TableHead>
            <TableHead className="text-right">Pidieron</TableHead>
            <TableHead className="text-right">Se cobraron</TableHead>
            <TableHead className="text-right">Solo asesoría</TableHead>
            <TableHead className="text-right">Se fueron</TableHead>
            <TableHead className="text-right">En la fila</TableHead>
            <TableHead className="pr-3 text-right">Ticket promedio</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sucursales.map((s) => (
            <Fragment key={s.branchId}>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableCell className="pl-3 font-medium">{s.nombre}</TableCell>
                <CeldasMetricas m={s} destacadas />
              </TableRow>
              {s.barberos.map((b) => (
                <TableRow key={`${s.branchId}-${b.barberoId ?? 'sin-barbero'}`}>
                  <TableCell className={cn('pl-7', b.barberoId ? 'text-foreground' : 'italic text-muted-foreground')}>
                    {b.nombre}
                  </TableCell>
                  <CeldasMetricas m={b} />
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CeldasMetricas({ m, destacadas = false }: { m: MetricasAsesoria; destacadas?: boolean }) {
  const pctSolo = porcentaje(m.soloAsesoria, atendidas(m))
  const celda = cn('text-right tabular-nums', destacadas && 'font-medium')
  return (
    <>
      <TableCell className={celda}>{numero(m.pidieron)}</TableCell>
      <TableCell className={celda}>{numero(m.cobradas)}</TableCell>
      <TableCell className={celda}>
        {numero(m.soloAsesoria)}
        {pctSolo !== null && m.soloAsesoria > 0 && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{pctSolo}%</span>
        )}
      </TableCell>
      <TableCell className={celda}>{numero(m.salieron)}</TableCell>
      <TableCell className={celda}>{numero(m.pendientes)}</TableCell>
      <TableCell className={cn(celda, 'pr-3')}>
        {m.ticketPromedio !== null ? formatCurrency(m.ticketPromedio) : '—'}
      </TableCell>
    </>
  )
}

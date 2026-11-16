'use client'

/**
 * Tarjeta «Corte Final» de /dashboard/configuracion: prende o apaga, por sucursal, el QR
 * del juego en la tablet de check-in (`branches.juego_qr_kiosko`, mig 233). Mismo esquema
 * que la asesoría en la entrada: cambio optimista que se confirma con el dato que quedó
 * en la base, y si falla el interruptor vuelve solo. Ver ../.claude/rules/juego.md.
 *
 * «Jugar como dueño»: abre el juego con el pase que deja ver y elegir a los personajes de los
 * dueños (`crearPaseDuenos`; el pase, en src/lib/juego/pase.ts). Lo ve quien ve la tarjeta.
 *
 * «PIN de dueños» (mig 239): en el juego, 5 toques al logo de Monaco y el PIN dan el mismo pase.
 * Muestra si hay PIN y desde cuándo (nunca el PIN); ponerlo y quitarlo pide `settings.manage`. Si la
 * tabla no está (la migración sin aplicar), sólo esta sección muestra el error.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { QRCodeSVG } from 'qrcode.react'
import { AlertTriangle, Copy, Crown, ExternalLink, Gamepad2, Info, KeyRound, Loader2, QrCode, RefreshCw, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  actualizarJuegoSucursal,
  crearPaseDuenos,
  guardarPinDuenos,
  obtenerJuegoSucursales,
  obtenerPinDuenos,
  quitarPinDuenos,
  type EstadoPinDuenos,
  type SucursalJuego,
} from '@/lib/actions/juego-config'
import { esAppInstalada } from '@/lib/app-instalable'
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
  /** El último pase de dueños que se pidió (para abrirlo, copiarlo o escanearlo desde otro celular). */
  const [pase, setPase] = useState<{ url: string; venceEn: number } | null>(null)
  const [pidiendoPase, setPidiendoPase] = useState(false)

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

  async function jugarComoDueno() {
    if (pidiendoPase) return
    // La pestaña se abre YA, dentro del toque: después de esperar al servidor, Safari del iPhone la
    // bloquearía. En la app instalada window.open no dice si abrió (y abre la hoja de Safari): ahí no
    // se abre nada solo y queda el enlace de abajo, como en «Pedir reseña» de Clientes.
    const ventana = esAppInstalada() ? null : window.open('', '_blank')
    setPidiendoPase(true)
    try {
      const r = await crearPaseDuenos()
      if (!r.ok) {
        ventana?.close()
        toast.error('No pudimos abrir el juego', { description: r.error })
        return
      }
      setPase({ url: r.url, venceEn: r.venceEn })
      if (ventana) {
        ventana.opener = null
        ventana.location.href = r.url
      }
    } catch {
      ventana?.close()
      toast.error('No pudimos abrir el juego', { description: SIN_CONEXION })
    } finally {
      setPidiendoPase(false)
    }
  }

  async function copiarPase() {
    if (!pase) return
    try {
      await navigator.clipboard.writeText(pase.url)
      toast.success('Enlace copiado', { description: 'Pegalo en el navegador del celular donde vas a jugar.' })
    } catch {
      toast.error('No se pudo copiar', { description: 'Mantené apretado «Abrir el juego» y copiá el enlace.' })
    }
  }

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

          <div className="min-w-0 space-y-3">
            {/* ── Probarlo antes de prenderlo ── */}
            <aside className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">Probalo antes de prenderlo</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                El juego se abre en cualquier celular con el link, aunque el QR esté apagado. Los clientes sólo llegan
                por el QR de la tablet.
              </p>
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={`/juego?s=${encodeURIComponent(slugPrueba)}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  Probar el juego
                </a>
              </Button>
            </aside>

            {/* ── Los personajes de los dueños: sólo con el pase ── */}
            <aside className="space-y-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4" aria-labelledby="juego-duenos">
              <p id="juego-duenos" className="flex items-center gap-2 text-sm font-medium">
                <Crown className="size-4 text-amber-400" aria-hidden="true" />
                Jugar como dueño
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Los Bosses (los personajes de los dueños) no los ve ningún cliente: aparecen sólo en el navegador donde abras este
                pase, durante 90 días. Esas peleas no van al ranking.
              </p>
              <Button variant="outline" size="sm" className="w-full" onClick={() => void jugarComoDueno()} disabled={pidiendoPase}>
                {pidiendoPase ? <Loader2 className="animate-spin" /> : <Crown />}
                Jugar como dueño
              </Button>
              {pase && (
                <div className="space-y-2.5 border-t border-amber-500/20 pt-3">
                  <div className="mx-auto w-fit rounded-xl bg-white p-2.5">
                    <QRCodeSVG
                      value={pase.url}
                      size={184}
                      bgColor="#ffffff"
                      fgColor="#000000"
                      level="M"
                      marginSize={1}
                      title="Pase de dueños de Corte Final"
                    />
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    Para jugar en otro celular, escanealo con la cámara.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button asChild variant="outline" size="sm">
                      <a href={pase.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink />
                        Abrir el juego
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void copiarPase()}>
                      <Copy />
                      Copiar enlace
                    </Button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Vale hasta el {format(new Date(pase.venceEn * 1000), "d 'de' MMMM 'de' yyyy", { locale: es })}. Con
                    este enlace cualquiera ve a los Bosses: no lo compartas con clientes.
                  </p>
                </div>
              )}
              <PinDuenos puedeEditar={puedeEditar} />
            </aside>
          </div>
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

/** Lo que sale del input: sólo números, hasta 8. */
function soloDigitos(valor: string): string {
  return valor.replace(/[^0-9]/g, '').slice(0, 8)
}

/**
 * «PIN de dueños»: si hay PIN y desde cuándo (nunca lo muestra), ponerlo o cambiarlo con «Repetir
 * PIN», y quitarlo. Se carga sola al montar (una action nueva: `obtenerJuegoSucursales` no cambió de
 * forma, Known Risk #38). Un error acá (la tabla sin migrar, la red) no toca el resto de la tarjeta.
 */
function PinDuenos({ puedeEditar }: { puedeEditar: boolean }) {
  const [estado, setEstado] = useState<EstadoPinDuenos | null>(null)
  const [pin, setPin] = useState('')
  const [repetir, setRepetir] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [quitando, setQuitando] = useState(false)
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)
  const [errorForm, setErrorForm] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    obtenerPinDuenos()
      .then((r) => {
        if (vivo) setEstado(r)
      })
      .catch(() => {
        if (vivo) setEstado({ ok: false, error: SIN_CONEXION })
      })
    return () => {
      vivo = false
    }
  }, [])

  async function reintentar() {
    setEstado(null)
    try {
      setEstado(await obtenerPinDuenos())
    } catch {
      setEstado({ ok: false, error: SIN_CONEXION })
    }
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (guardando) return
    if (pin.length < 4) return setErrorForm('El PIN tiene que tener de 4 a 8 números.')
    if (pin !== repetir) return setErrorForm('Los dos PIN no coinciden.')
    setErrorForm(null)
    setGuardando(true)
    try {
      const r = await guardarPinDuenos(pin, repetir)
      if (!r.ok) {
        setErrorForm(r.error)
        return
      }
      setEstado({ ok: true, configurado: true, desde: r.desde })
      setPin('')
      setRepetir('')
      toast.success('PIN de dueños guardado', { description: 'En el juego: tocá 5 veces el logo de Monaco y poné el PIN.' })
    } catch {
      setErrorForm(SIN_CONEXION)
    } finally {
      setGuardando(false)
    }
  }

  async function quitar() {
    if (quitando) return
    if (!confirmarQuitar) return setConfirmarQuitar(true)
    setQuitando(true)
    try {
      const r = await quitarPinDuenos()
      if (!r.ok) {
        toast.error('No pudimos quitar el PIN', { description: r.error })
        return
      }
      setEstado({ ok: true, configurado: false, desde: null })
      toast.success('PIN de dueños quitado')
    } catch {
      toast.error('No pudimos quitar el PIN', { description: SIN_CONEXION })
    } finally {
      setQuitando(false)
      setConfirmarQuitar(false)
    }
  }

  const configurado = estado?.ok === true && estado.configurado
  const desde = estado?.ok === true && estado.desde ? new Date(estado.desde) : null

  return (
    <div className="space-y-2.5 border-t border-amber-500/20 pt-3" aria-labelledby="juego-pin-duenos">
      <p id="juego-pin-duenos" className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="size-4 text-amber-400" aria-hidden="true" />
        PIN de dueños
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        En el juego: tocá 5 veces el logo de Monaco y poné el PIN.
      </p>

      {estado === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Revisando el PIN…
        </p>
      ) : !estado.ok ? (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {estado.error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void reintentar()}>
            <RefreshCw />
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs">
            {configurado ? (
              <>
                <Badge variant="secondary" className="mr-1.5">
                  Activo
                </Badge>
                {desde ? `Desde el ${format(desde, "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}` : 'Hay un PIN puesto'}
              </>
            ) : (
              <span className="text-muted-foreground">Todavía no hay PIN: el gesto del logo no sirve hasta que pongas uno.</span>
            )}
          </p>

          {puedeEditar ? (
            <form className="space-y-2" onSubmit={(e) => void guardar(e)} noValidate>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="juego-pin" className="text-xs">
                    {configurado ? 'PIN nuevo' : 'PIN'}
                  </Label>
                  <Input
                    id="juego-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={8}
                    placeholder="6 números"
                    value={pin}
                    onChange={(e) => {
                      setPin(soloDigitos(e.target.value))
                      setErrorForm(null)
                    }}
                    disabled={guardando}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="juego-pin-repetir" className="text-xs">
                    Repetir PIN
                  </Label>
                  <Input
                    id="juego-pin-repetir"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={8}
                    value={repetir}
                    onChange={(e) => {
                      setRepetir(soloDigitos(e.target.value))
                      setErrorForm(null)
                    }}
                    disabled={guardando}
                  />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                De 4 a 8 números; te recomendamos 6. Es uno solo para los 4 dueños. Cambiarlo no saca a los dueños de
                los celulares donde ya entraron.
              </p>
              {errorForm && (
                <p className="text-xs text-destructive" role="alert">
                  {errorForm}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button type="submit" size="sm" disabled={guardando || pin.length < 4 || repetir.length < 4}>
                  {guardando ? <Loader2 className="animate-spin" /> : <KeyRound />}
                  Guardar
                </Button>
                {configurado && (
                  <Button
                    type="button"
                    variant={confirmarQuitar ? 'destructive' : 'outline'}
                    size="sm"
                    onClick={() => void quitar()}
                    onBlur={() => setConfirmarQuitar(false)}
                    disabled={quitando}
                  >
                    {quitando ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    {confirmarQuitar ? '¿Seguro?' : 'Quitar PIN'}
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Para ponerlo o cambiarlo hace falta el permiso de editar la configuración.
            </p>
          )}
        </>
      )}
    </div>
  )
}

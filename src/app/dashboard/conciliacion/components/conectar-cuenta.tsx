'use client'

// Conectar una cuenta de cobro con su cuenta de Mercado Pago (spec D).
//
//   1. Recomendado: que la autorice el titular desde su celular con un link
//      (WhatsApp, QR o copiar). Nadie pasa contraseñas.
//      "Es mi cuenta": el dueño la autoriza ahora (OAuth desde el dashboard).
//      Plegado: pegar un access token de producción (verificar → confirmar).
//      "Esta cuenta no es de Mercado Pago": queda como banco (sin verificar).
//   2. Esperando: polling cada 3 s del estado del link (se corta al cerrar).
//   3. Conectada: primera lectura (60 días) y verificación contra los cobros
//      de los últimos 7 días: si no aparece ninguno, probablemente autorizaron
//      OTRA cuenta.
//   4. Si llegó por link, el dueño confirma que es la cuenta correcta.
//
// Diálogo de 480 en escritorio; pantalla completa en el celular.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Landmark,
  Loader2,
  MessageCircle,
  QrCode,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  CuentaConciliacion,
  EstadoLink,
  IdentidadMP,
  LinkConexion,
} from '@/lib/conciliacion-mp/contrato'
import {
  anularLinkConexion,
  confirmarCuentaMP,
  conectarCuentaManual,
  crearLinkConexion,
  desconectarCuentaMP,
  estadoLinkConexion,
  iniciarConexionPropia,
  marcarCuentaBanco,
  obtenerConciliacion,
  sincronizarCuentaMP,
  verificarTokenManual,
} from '@/lib/actions/conciliacion-mp'
import { TexCara } from '@/components/tex/tex-cara'
import { TexPose } from '@/components/tex/tex-pose'
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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { vencimientoAR } from './formato'
import { listaSucursales } from './cuentas'
import { verificarCuenta, type Verificacion } from './logica'
import { copiarTexto, llamar } from './llamar'
import { hoyEnArgentina, limitesISO, sumarDias } from './periodo'
import { SetupOAuth } from './setup-oauth'
import { useEsAncho, useHidratado } from './use-pantalla'

export type InicioConectar =
  | { tipo: 'normal' }
  /** Seguir un link que ya se mandó (la URL no se puede recuperar: se guarda sólo su hash). */
  | { tipo: 'link'; linkId: string; venceEn: string }
  /** Volvió del OAuth hecho desde el dashboard (`?conectada=<id>`). */
  | { tipo: 'post_oauth'; cuentaMpId: string }

interface Props {
  abierto: boolean
  cuenta: CuentaConciliacion | null
  inicio: InicioConectar
  oauthDisponible: boolean
  urlRedireccion: string
  /** huboCambios: se creó o anuló un link, se conectó, confirmó o desconectó la cuenta. */
  onCerrar: (huboCambios: boolean) => void
  /** Terminó la primera lectura (aunque la hoja ya se haya cerrado): la pantalla recalcula. */
  onLeida?: () => void
  /** Algo cambió (link, conexión, confirmación): la pantalla recalcula al cerrar, también si se cerró con "atrás". */
  onCambio?: () => void
}

interface PropsFlujo extends Omit<Props, 'onCerrar' | 'onCambio'> {
  onCerrar: () => void
  onCambio: () => void
}

type Paso =
  | { tipo: 'inicio' }
  | { tipo: 'esperando'; linkId: string; venceEn: string; estado: EstadoLink }
  | {
      tipo: 'conectada'
      cuentaMpId: string
      titularMp: string | null
      viaLink: boolean
      fase: 'leyendo' | 'verificando' | 'listo'
      verificacion: Verificacion | null
      cuentaFinal: CuentaConciliacion | null
      error: string | null
      confirmada: boolean
    }
  | { tipo: 'banco' }

const RE_TOKEN = /^APP_USR-[A-Za-z0-9_-]{8,}$/
const ERROR_TOKEN = 'Ese token no es válido o es de prueba. Necesitamos uno de producción (APP_USR-…).'

function pasoInicial(inicio: InicioConectar): Paso {
  if (inicio.tipo === 'link') return { tipo: 'esperando', linkId: inicio.linkId, venceEn: inicio.venceEn, estado: 'pendiente' }
  if (inicio.tipo === 'post_oauth') {
    return {
      tipo: 'conectada',
      cuentaMpId: inicio.cuentaMpId,
      titularMp: null,
      viaLink: false,
      fase: 'leyendo',
      verificacion: null,
      cuentaFinal: null,
      error: null,
      confirmada: true,
    }
  }
  return { tipo: 'inicio' }
}

function esperar(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms))
}

/** "Lucas" de "Lucas Gómez": para hablarle al dueño del titular. */
function nombreDePila(nombre: string | null | undefined): string | null {
  const n = (nombre ?? '').trim().split(/\s+/)[0]
  return n ? n : null
}

export function ConectarCuenta(props: Props) {
  const anchoAhora = useEsAncho()
  // Hasta hidratar no se sabe si es diálogo (escritorio) u hoja (celular): si se
  // dibujara uno y después el otro, el flujo se montaría dos veces.
  const hidratado = useHidratado()
  // Y una vez abierto, la variante queda fija: girar el celular (390 → 844 px)
  // cambiaba de hoja a diálogo, React desmontaba el flujo y se perdían el QR, la
  // espera del link (de un link mandado antes sólo queda el hash: no se puede
  // recuperar) y la primera lectura en curso. Cada apertura monta esto de nuevo
  // (key={apertura}), así que la próxima vez se elige según el ancho de ese momento.
  const [anchoAlAbrir, setAnchoAlAbrir] = useState<boolean | null>(null)
  if (hidratado && anchoAlAbrir === null) setAnchoAlAbrir(anchoAhora)
  const ancho = anchoAlAbrir ?? anchoAhora
  const cambios = useRef(false)
  const { cuenta } = props
  const accion = cuenta?.estado === 'revocada' ? 'Volver a autorizar' : 'Conectar'
  const alias = cuenta?.alias ?? null
  const subtitulo = cuenta
    ? [cuenta.titular ? `Cuenta de ${cuenta.titular}` : null, listaSucursales(cuenta) || null].filter(Boolean).join(' · ')
    : 'Cuenta de Mercado Pago'

  if (!hidratado) return null

  // Cerrar con la X, Esc o tocando afuera también avisa si algo cambió: si no,
  // la tarjeta seguiría diciendo "Sin conectar" con la cuenta ya conectada.
  const cerrar = () => props.onCerrar(cambios.current)
  const cuerpo = (
    <Flujo
      {...props}
      onCerrar={cerrar}
      onCambio={() => {
        cambios.current = true
        props.onCambio?.()
      }}
    />
  )

  if (ancho) {
    return (
      <Dialog open={props.abierto} onOpenChange={(v) => !v && cerrar()}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[480px]"
          onOpenAutoFocus={enfocarCuerpo}
        >
          <Encabezado accion={accion} alias={alias} subtitulo={subtitulo} onCerrar={cerrar} dialogo />
          {cuerpo}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Sheet open={props.abierto} onOpenChange={(v) => !v && cerrar()}>
      <SheetContent side="bottom" showCloseButton={false} className="h-dvh max-h-dvh gap-0 overflow-y-auto p-0" onOpenAutoFocus={enfocarCuerpo}>
        <Encabezado accion={accion} alias={alias} subtitulo={subtitulo} onCerrar={cerrar} />
        {cuerpo}
      </SheetContent>
    </Sheet>
  )
}

/** Al abrir, el foco va al cuerpo del flujo: Radix lo pondría en la X y quedaría un anillo sobre algo que nadie tocó. */
function enfocarCuerpo(e: Event) {
  const raiz: ParentNode = e.currentTarget instanceof HTMLElement ? e.currentTarget : document
  const cuerpo = raiz.querySelector<HTMLElement>('[data-cuerpo-conectar]')
  if (cuerpo) {
    e.preventDefault()
    cuerpo.focus({ preventScroll: true })
  }
}

function Encabezado({
  accion,
  alias,
  subtitulo,
  onCerrar,
  dialogo,
}: {
  accion: string
  alias: string | null
  subtitulo: string
  onCerrar: () => void
  dialogo?: boolean
}) {
  const Titulo = dialogo ? DialogTitle : SheetTitle
  const Descripcion = dialogo ? DialogDescription : SheetDescription
  return (
    <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-white/[0.06] bg-background/95 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
      <div className="min-w-0 flex-1">
        <Titulo className="truncate text-lg leading-tight font-semibold">
          {accion} {alias ? <span className="font-mono">{alias}</span> : 'la cuenta'}
        </Titulo>
        <Descripcion className="mt-0.5 truncate text-sm text-muted-foreground">{subtitulo}</Descripcion>
      </div>
      <Button variant="ghost" size="icon" className="-mr-2 size-10 shrink-0" onClick={onCerrar} aria-label="Cerrar">
        <X className="size-4" />
      </Button>
    </div>
  )
}

function Flujo({ abierto, cuenta, inicio, oauthDisponible, urlRedireccion, onCerrar, onCambio, onLeida }: PropsFlujo) {
  const [paso, setPaso] = useState<Paso>(() => pasoInicial(inicio))
  const [link, setLink] = useState<LinkConexion | null>(null)
  const linkRef = useRef<LinkConexion | null>(null)
  const [creandoLink, setCreandoLink] = useState(false)
  const [errorLink, setErrorLink] = useState<string | null>(null)
  const [mostrarQR, setMostrarQR] = useState(false)
  const [linkAMano, setLinkAMano] = useState(false)
  const [yendoOAuth, setYendoOAuth] = useState(false)
  const [errorOAuth, setErrorOAuth] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [confirmarDesconexion, setConfirmarDesconexion] = useState(false)
  const montado = useRef(true)

  const paymentAccountId = cuenta?.paymentAccountIds[0] ?? null
  const titularPila = nombreDePila(cuenta?.titular) ?? 'el titular'

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  // ── 3. Primera lectura + verificación ─────────────────────────────────────
  async function primeraLectura(cuentaMpId: string) {
    onCambio()
    let errorSync: string | null = null
    // Una lectura puede cortar por tiempo (60 días de movimientos): se sigue
    // hasta que quede al día, con tope de cuatro vueltas.
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      const r = await llamar(() => sincronizarCuentaMP(cuentaMpId, { origen: 'manual' }))
      // Si cerraron la hoja mientras se leía, la vuelta que estaba en curso igual terminó en el
      // servidor: la pantalla (que sigue montada) recalcula con lo leído. Antes se cortaba sin
      // avisar y quedaba lo que se había recalculado al cerrar, con la lectura a medias. Lo que
      // falta de los 60 días lo completan las lecturas siguientes (al abrir, Sincronizar, el cron).
      if (!montado.current) {
        onLeida?.()
        return
      }
      if (r.ok !== true) {
        errorSync = r.error || 'No se pudo leer la cuenta.'
        break
      }
      if (r.omitida === 'candado') {
        await esperar(3000)
        if (!montado.current) {
          onLeida?.()
          return
        }
        continue
      }
      const hasta = r.sincronizadaHasta ? Date.parse(r.sincronizadaHasta) : Number.NaN
      if (!Number.isFinite(hasta) || Date.now() - hasta < 10 * 60_000) break
    }
    onLeida?.()
    setPaso((p) => (p.tipo === 'conectada' ? { ...p, fase: 'verificando' } : p))

    const hoy = hoyEnArgentina()
    const semana = { desde: sumarDias(hoy, -7), hasta: sumarDias(hoy, -1) }
    const { desde, hasta } = limitesISO(semana)
    const r = await llamar(() => obtenerConciliacion({ desde, hasta }))
    if (!montado.current) return
    if (!r.ok) {
      setPaso((p) => (p.tipo === 'conectada' ? { ...p, fase: 'listo', error: errorSync ?? r.error } : p))
      return
    }
    const cuentaFinal = r.cuentas.find((c) => c.cuentaMpId === cuentaMpId) ?? null
    setPaso((p) =>
      p.tipo === 'conectada'
        ? {
            ...p,
            fase: 'listo',
            verificacion: verificarCuenta(r, cuentaMpId),
            cuentaFinal,
            error: errorSync,
            confirmada: cuentaFinal ? cuentaFinal.confirmada : !p.viaLink,
            titularMp: p.titularMp ?? cuentaFinal?.titularMp ?? null,
          }
        : p,
    )
  }

  // La vuelta del OAuth hecho desde el dashboard arranca directo en la lectura.
  const primeraLecturaRef = useRef(primeraLectura)
  useEffect(() => {
    primeraLecturaRef.current = primeraLectura
  })
  const [postOAuth] = useState(inicio.tipo === 'post_oauth' ? inicio.cuentaMpId : null)
  useEffect(() => {
    if (postOAuth) void primeraLecturaRef.current(postOAuth)
  }, [postOAuth])

  // ── 2. Esperando: polling cada 3 s mientras la hoja está abierta ──────────
  const linkEsperando = paso.tipo === 'esperando' && (paso.estado === 'pendiente' || paso.estado === 'abierto') ? paso.linkId : null
  useEffect(() => {
    if (!abierto || !linkEsperando) return
    let vivo = true
    const tick = async () => {
      if (document.hidden) return
      const r = await llamar(() => estadoLinkConexion(linkEsperando))
      if (!vivo || !r.ok) return
      if (r.estado === 'conectada' && r.cuentaMpId) {
        vivo = false
        const id = r.cuentaMpId
        setPaso({
          tipo: 'conectada',
          cuentaMpId: id,
          titularMp: r.titularMp,
          viaLink: true,
          fase: 'leyendo',
          verificacion: null,
          cuentaFinal: null,
          error: null,
          confirmada: false,
        })
        void primeraLecturaRef.current(id)
        return
      }
      setPaso((p) => (p.tipo === 'esperando' && p.linkId === linkEsperando && p.estado !== r.estado ? { ...p, estado: r.estado } : p))
    }
    const intervalo = window.setInterval(() => void tick(), 3000)
    return () => {
      vivo = false
      window.clearInterval(intervalo)
    }
  }, [abierto, linkEsperando])

  // ── 1. El link ────────────────────────────────────────────────────────────
  async function asegurarLink(nuevo = false): Promise<LinkConexion | null> {
    if (!nuevo && linkRef.current) return linkRef.current
    if (!paymentAccountId) {
      setErrorLink('Esta cuenta no tiene una cuenta de cobro asociada.')
      return null
    }
    setCreandoLink(true)
    setErrorLink(null)
    const r = await llamar(() => crearLinkConexion(paymentAccountId))
    setCreandoLink(false)
    if (!r.ok) {
      setErrorLink(r.error)
      return null
    }
    linkRef.current = r.link
    setLink(r.link)
    setLinkAMano(false)
    onCambio()
    setPaso({ tipo: 'esperando', linkId: r.link.id, venceEn: r.link.venceEn, estado: 'pendiente' })
    return r.link
  }

  async function mandarPorWhatsApp(nuevo = false) {
    // La pestaña se abre YA, dentro del toque: después de un await el navegador la bloquearía.
    const actual = nuevo ? null : linkRef.current
    if (actual) {
      window.open(actual.urlWhatsApp, '_blank', 'noopener,noreferrer')
      return
    }
    const ventana = window.open('', '_blank')
    const l = await asegurarLink(nuevo)
    if (!l) {
      ventana?.close()
      return
    }
    if (ventana) {
      ventana.opener = null
      ventana.location.href = l.urlWhatsApp
    } else {
      window.location.href = l.urlWhatsApp
    }
  }

  async function copiarLink(nuevo = false) {
    // Safari sólo deja escribir en el portapapeles dentro del toque: con
    // ClipboardItem la promesa del link nuevo viaja adentro del mismo gesto.
    if (!nuevo && linkRef.current) {
      if (await copiarTexto(linkRef.current.url)) toast.success('Link copiado.')
      else setLinkAMano(true)
      return
    }
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const blob = asegurarLink(nuevo).then((l) => {
        if (!l) throw new Error('sin link')
        return new Blob([l.url], { type: 'text/plain' })
      })
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
        toast.success('Link copiado.')
        return
      } catch {
        // Si el link se creó y lo que falló fue el portapapeles, se ofrece a mano.
        if (linkRef.current) setLinkAMano(true)
        return
      }
    }
    const l = await asegurarLink(nuevo)
    if (!l) return
    if (await copiarTexto(l.url)) toast.success('Link copiado.')
    else setLinkAMano(true)
  }

  async function verQR(nuevo = false) {
    const l = await asegurarLink(nuevo)
    if (l) setMostrarQR(true)
  }

  async function anular() {
    if (paso.tipo !== 'esperando') return
    setOcupado(true)
    setErrorAccion(null)
    const r = await llamar(() => anularLinkConexion(paso.linkId))
    setOcupado(false)
    if (!r.ok) {
      setErrorAccion(r.error ?? 'No se pudo anular el link.')
      return
    }
    onCambio()
    linkRef.current = null
    setLink(null)
    setMostrarQR(false)
    setPaso({ tipo: 'inicio' })
    toast.success('Link anulado.')
  }

  async function autorizarYo() {
    if (!paymentAccountId) return
    setYendoOAuth(true)
    setErrorOAuth(null)
    const r = await llamar(() => iniciarConexionPropia(paymentAccountId))
    if (!r.ok) {
      setYendoOAuth(false)
      setErrorOAuth(r.error)
      return
    }
    window.location.href = r.url
  }

  async function marcarBanco() {
    if (!paymentAccountId) return
    setOcupado(true)
    setErrorAccion(null)
    // Una sola llamada: el servidor lo aplica a todas las cuentas de cobro de la tarjeta (mismo alias).
    const r = await llamar(() => marcarCuentaBanco(paymentAccountId, true))
    setOcupado(false)
    if (!r.ok) {
      setErrorAccion(r.error ?? 'No se pudo guardar.')
      return
    }
    toast.success(`${cuenta?.alias ?? 'La cuenta'} queda como cuenta de banco, en todas las cuentas de cobro con ese alias.`)
    onCambio()
    onCerrar()
  }

  async function confirmar(cuentaMpId: string) {
    setOcupado(true)
    setErrorAccion(null)
    const r = await llamar(() => confirmarCuentaMP(cuentaMpId))
    setOcupado(false)
    if (!r.ok) {
      setErrorAccion(r.error ?? 'No se pudo confirmar.')
      return
    }
    onCambio()
    setPaso((p) => (p.tipo === 'conectada' ? { ...p, confirmada: true } : p))
    toast.success('Listo: la cuenta quedó confirmada.')
  }

  async function desconectar(cuentaMpId: string) {
    setOcupado(true)
    setErrorAccion(null)
    const r = await llamar(() => desconectarCuentaMP(cuentaMpId))
    setOcupado(false)
    if (!r.ok) {
      setErrorAccion(r.error ?? 'No se pudo desconectar.')
      return
    }
    toast.success('Cuenta desconectada.')
    onCambio()
    onCerrar()
  }

  // El token manual vive en su propio componente: se borra al desmontarse.
  function conectadaManual(cuentaMpId: string, titular: string | null) {
    onCambio()
    setPaso({
      tipo: 'conectada',
      cuentaMpId,
      titularMp: titular,
      viaLink: false,
      fase: 'leyendo',
      verificacion: null,
      cuentaFinal: null,
      error: null,
      confirmada: true,
    })
    void primeraLectura(cuentaMpId)
  }


  return (
    <div data-cuerpo-conectar tabIndex={-1} className="space-y-4 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none">
      {paso.tipo === 'inicio' && (
        <>
          <OpcionLink
            titularPila={titularPila}
            oauthDisponible={oauthDisponible}
            urlRedireccion={urlRedireccion}
            creando={creandoLink}
            error={errorLink}
            onWhatsApp={() => void mandarPorWhatsApp()}
            onQR={() => void verQR()}
            onCopiar={() => void copiarLink()}
          />

          <div className="space-y-1.5">
            <Button
              variant="outline"
              className="h-11 w-full justify-start gap-2.5"
              disabled={!oauthDisponible || yendoOAuth || !paymentAccountId}
              onClick={() => void autorizarYo()}
            >
              {yendoOAuth ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserRound className="size-4" aria-hidden />}
              {yendoOAuth ? 'Abriendo Mercado Pago…' : 'Es mi cuenta: autorizarla ahora'}
            </Button>
            {errorOAuth && (
              <p role="alert" className="text-xs text-red-300">
                {errorOAuth}
              </p>
            )}
          </div>

          {paymentAccountId && (
            <TokenManual
              paymentAccountId={paymentAccountId}
              abiertoInicial={!oauthDisponible}
              onConectada={conectadaManual}
            />
          )}

          <button
            type="button"
            onClick={() => setPaso({ tipo: 'banco' })}
            className="flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <Landmark className="size-4" aria-hidden />
            Esta cuenta no es de Mercado Pago
          </button>
        </>
      )}

      {paso.tipo === 'banco' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-4">
          <p className="flex items-center gap-2 font-medium">
            <Landmark className="size-4" aria-hidden />
            ¿Es una cuenta de banco?
          </p>
          <p className="text-sm text-muted-foreground">
            Sus cobros van a figurar como «Sin verificar» y no cuentan como conciliados. Se controlan con el comprobante.
          </p>
          <p className="text-sm text-muted-foreground">
            {cuenta?.alias ? (
              <>
                Se aplica a todas las cuentas de cobro con el alias <span className="font-mono text-zinc-200">{cuenta.alias}</span>
                {cuenta.sucursales.length > 1 ? ` (${listaSucursales(cuenta)})` : ''}.
              </>
            ) : (
              'Se aplica a todas las cuentas de cobro con este alias.'
            )}
          </p>
          {errorAccion && (
            <p role="alert" className="text-sm text-red-300">
              {errorAccion}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button className="h-10" onClick={() => void marcarBanco()} disabled={ocupado}>
              {ocupado && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Sí, es de un banco
            </Button>
            <Button variant="ghost" className="h-10" onClick={() => setPaso({ tipo: 'inicio' })} disabled={ocupado}>
              Volver
            </Button>
          </div>
        </div>
      )}

      {paso.tipo === 'esperando' && (
        <Esperando
          titularPila={titularPila}
          venceEn={paso.venceEn}
          estado={paso.estado}
          link={link}
          mostrarQR={mostrarQR && link != null}
          linkAMano={linkAMano}
          creando={creandoLink}
          ocupado={ocupado}
          error={errorLink ?? errorAccion}
          onWhatsApp={() => void mandarPorWhatsApp(link == null || paso.estado === 'vencido' || paso.estado === 'anulado')}
          onQR={() => (mostrarQR ? setMostrarQR(false) : void verQR(link == null || paso.estado === 'vencido' || paso.estado === 'anulado'))}
          onCopiar={() => void copiarLink(link == null || paso.estado === 'vencido' || paso.estado === 'anulado')}
          onAnular={() => void anular()}
        />
      )}

      {paso.tipo === 'conectada' && (
        <Conectada
          paso={paso}
          alias={cuenta?.alias ?? paso.cuentaFinal?.alias ?? null}
          ocupado={ocupado}
          error={errorAccion}
          confirmarDesconexion={confirmarDesconexion}
          onPedirDesconexion={() => setConfirmarDesconexion(true)}
          onCancelarDesconexion={() => setConfirmarDesconexion(false)}
          onConfirmar={() => void confirmar(paso.cuentaMpId)}
          onDesconectar={() => void desconectar(paso.cuentaMpId)}
          onListo={onCerrar}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function OpcionLink({
  titularPila,
  oauthDisponible,
  urlRedireccion,
  creando,
  error,
  onWhatsApp,
  onQR,
  onCopiar,
}: {
  titularPila: string
  oauthDisponible: boolean
  urlRedireccion: string
  creando: boolean
  error: string | null
  onWhatsApp: () => void
  onQR: () => void
  onCopiar: () => void
}) {
  return (
    <div className={cn('space-y-3 rounded-xl border p-4', oauthDisponible ? 'border-white/15 bg-white/[0.03]' : 'border-white/10')}>
      <div>
        <p className="text-[11px] font-semibold tracking-wider text-[var(--tex-texto)] uppercase">Recomendado</p>
        <p className="mt-1 font-medium text-zinc-100">Que la autorice {titularPila} desde su celular</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Le mandás un link, entra con su usuario de Mercado Pago y toca Autorizar. Nadie te pasa contraseñas.
        </p>
      </div>
      {oauthDisponible ? (
        <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          <Button className="h-11 gap-1.5 min-[380px]:col-span-2 sm:h-10" onClick={onWhatsApp} disabled={creando}>
            {creando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MessageCircle className="size-4" aria-hidden />}
            Mandar por WhatsApp
          </Button>
          <Button variant="outline" className="h-11 gap-1.5 sm:h-10" onClick={onQR} disabled={creando}>
            <QrCode className="size-4" aria-hidden />
            Mostrar QR
          </Button>
          <Button variant="outline" className="h-11 gap-1.5 sm:h-10" onClick={onCopiar} disabled={creando}>
            <Copy className="size-4" aria-hidden />
            Copiar link
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-sm text-amber-200/90">
            Para mandar links falta configurar la aplicación de Mercado Pago (una sola vez). Mientras tanto podés pegar un access token.
          </p>
          <SetupOAuth urlRedireccion={urlRedireccion} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

/** El borde punteado que corre mientras se espera; se llena en 300 ms al conectarse. */
function BordeEspera({ lleno, children }: { lleno: boolean; children: ReactNode }) {
  return (
    <div className="relative rounded-xl p-4">
      {/* El trazo va centrado sobre el borde de la caja (el SVG no recorta): sin calc() en atributos de SVG. */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {lleno ? (
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            rx="14"
            fill="none"
            stroke="rgb(52 211 153 / 0.7)"
            strokeWidth="1.5"
            pathLength={1}
            strokeDasharray="1"
            className="cmp-llena"
          />
        ) : (
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            rx="14"
            fill="none"
            stroke="rgb(255 255 255 / 0.3)"
            strokeWidth="1.5"
            strokeDasharray="6 6"
            className="cmp-hormigas"
          />
        )}
      </svg>
      {children}
    </div>
  )
}

function Esperando({
  titularPila,
  venceEn,
  estado,
  link,
  mostrarQR,
  linkAMano,
  creando,
  ocupado,
  error,
  onWhatsApp,
  onQR,
  onCopiar,
  onAnular,
}: {
  titularPila: string
  venceEn: string
  estado: EstadoLink
  link: LinkConexion | null
  mostrarQR: boolean
  linkAMano: boolean
  creando: boolean
  ocupado: boolean
  error: string | null
  onWhatsApp: () => void
  onQR: () => void
  onCopiar: () => void
  onAnular: () => void
}) {
  const muerto = estado === 'vencido' || estado === 'anulado'
  // Sin la URL (un link mandado antes: sólo se guarda su hash) reenviar crea uno nuevo.
  const nuevo = link == null || muerto
  return (
    <div className="space-y-4">
      <BordeEspera lleno={false}>
        <div className="flex items-start gap-3" aria-live="polite">
          {muerto ? (
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
          ) : (
            <TexCara tamano={40} estado="reposo" className="mt-0.5" />
          )}
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-zinc-100">
              {estado === 'vencido'
                ? 'El link venció.'
                : estado === 'anulado'
                  ? 'Ese link ya no sirve.'
                  : `Esperando que ${titularPila} autorice…`}
            </p>
            <p className="text-sm text-muted-foreground">
              {muerto ? 'Mandale uno nuevo.' : `El link vence el ${vencimientoAR(venceEn)}.`}
            </p>
          </div>
        </div>
        {mostrarQR && link && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={link.url} size={220} bgColor="#ffffff" fgColor="#000000" level="M" marginSize={1} title={`Link para ${titularPila}`} />
            </div>
            <p className="text-xs text-muted-foreground">Que lo escanee con la cámara del celular.</p>
          </div>
        )}
        {linkAMano && link && (
          <div className="mt-4 space-y-1">
            <p className="text-xs text-muted-foreground">No se pudo copiar solo. Copialo de acá:</p>
            <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Link para autorizar" />
          </div>
        )}
      </BordeEspera>

      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        <Button className="h-11 gap-1.5 min-[380px]:col-span-2 sm:h-10" onClick={onWhatsApp} disabled={creando || ocupado}>
          {creando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MessageCircle className="size-4" aria-hidden />}
          {nuevo ? 'Mandar un link nuevo por WhatsApp' : 'Reenviar por WhatsApp'}
        </Button>
        <Button variant="outline" className="h-11 gap-1.5 sm:h-10" onClick={onQR} disabled={creando || ocupado}>
          <QrCode className="size-4" aria-hidden />
          {mostrarQR ? 'Ocultar QR' : 'Mostrar QR'}
        </Button>
        <Button variant="outline" className="h-11 gap-1.5 sm:h-10" onClick={onCopiar} disabled={creando || ocupado}>
          <Copy className="size-4" aria-hidden />
          Copiar link
        </Button>
      </div>
      {nuevo && !muerto && (
        <p className="text-xs text-muted-foreground">El link que ya mandaste sigue andando. Uno nuevo lo reemplaza.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {!muerto && (
        <Button variant="ghost" className="h-10 text-muted-foreground" onClick={onAnular} disabled={ocupado}>
          {ocupado && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Anular el link
        </Button>
      )}
    </div>
  )
}

function Conectada({
  paso,
  alias,
  ocupado,
  error,
  confirmarDesconexion,
  onPedirDesconexion,
  onCancelarDesconexion,
  onConfirmar,
  onDesconectar,
  onListo,
}: {
  paso: Extract<Paso, { tipo: 'conectada' }>
  /** null: la cuenta todavía no figura en la pantalla (volvió del OAuth antes de recalcular). */
  alias: string | null
  ocupado: boolean
  error: string | null
  confirmarDesconexion: boolean
  onPedirDesconexion: () => void
  onCancelarDesconexion: () => void
  onConfirmar: () => void
  onDesconectar: () => void
  onListo: () => void
}) {
  const v = paso.verificacion
  const quien = paso.titularMp ?? paso.cuentaFinal?.titularMp ?? null
  const enCuenta = alias ?? 'esta cuenta'
  const email = paso.cuentaFinal?.emailMp ?? null
  const coincide = paso.fase === 'listo' && v?.tipo === 'coincide'
  const sospecha = paso.fase === 'listo' && (v?.tipo === 'ninguno' || v?.tipo === 'parcial')

  return (
    <div className="space-y-4">
      <BordeEspera lleno>
        <div className="flex items-start gap-3" aria-live="polite">
          {coincide ? (
            <TexPose pose="logro" alto={56} entrada="logro" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden />
          )}
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-zinc-100">
              {alias ? (
                <>
                  <span className="font-mono">{alias}</span> conectada{quien ? ` como ${quien}` : ''}.
                </>
              ) : (
                `La cuenta quedó conectada${quien ? ` como ${quien}` : ''}.`
              )}
            </p>
            {paso.fase === 'leyendo' && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Traigo los últimos 60 días…
              </p>
            )}
            {paso.fase === 'verificando' && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Comparo con los cobros de los últimos 7 días…
              </p>
            )}
            {paso.fase === 'listo' && v?.tipo === 'coincide' && (
              <p className="text-sm text-emerald-300">
                Coincide: encontramos {v.encontrados} de los {v.total} cobros de los últimos 7 días.
              </p>
            )}
            {paso.fase === 'listo' && v?.tipo === 'parcial' && (
              <p className="text-sm text-amber-200">
                Sólo encontramos {v.encontrados} de los {v.total} cobros registrados en {enCuenta} en los últimos 7 días. Revisá que sea la
                cuenta correcta.
              </p>
            )}
            {paso.fase === 'listo' && v?.tipo === 'ninguno' && (
              <p className="text-sm text-amber-200">
                Esta cuenta no recibió ninguno de los {v.total} cobros registrados en {enCuenta}. Puede que se haya autorizado otra cuenta.
              </p>
            )}
            {paso.fase === 'listo' && v?.tipo === 'sin_datos' && (
              <p className="text-sm text-muted-foreground">No hubo cobros en {enCuenta} los últimos 7 días para comparar.</p>
            )}
            {/* "No se pudo leer" no es "no hubo cobros": la lectura cortó (el cron la tenía, Mercado Pago no respondió). */}
            {paso.fase === 'listo' && v?.tipo === 'sin_leer' && (
              <p className="text-sm text-muted-foreground">
                {v.sinLeer === 1
                  ? `Todavía no pude leer el cobro de ${enCuenta} de los últimos 7 días: lo verifico en la próxima lectura.`
                  : `Todavía no pude leer los ${v.sinLeer} cobros de ${enCuenta} de los últimos 7 días: los verifico en la próxima lectura.`}
              </p>
            )}
            {paso.fase === 'listo' && v && v.tipo !== 'sin_leer' && v.tipo !== 'sin_datos' && v.sinLeer > 0 && (
              <p className="text-xs text-muted-foreground">
                {v.sinLeer === 1 ? 'Otro cobro' : `Otros ${v.sinLeer} cobros`} todavía no se {v.sinLeer === 1 ? 'pudo' : 'pudieron'} leer: se
                verifican en la próxima lectura.
              </p>
            )}
            {paso.fase === 'listo' && paso.error && <p className="text-sm text-red-300">{paso.error}</p>}
          </div>
        </div>
      </BordeEspera>

      {paso.fase === 'listo' && paso.viaLink && !paso.confirmada && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
          <p className="flex items-start gap-2 text-sm text-amber-100">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Autorizó la cuenta de Mercado Pago de {quien ?? 'alguien'}
              {email ? ` (${email})` : ''}.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button className="h-10" onClick={onConfirmar} disabled={ocupado}>
              {ocupado && !confirmarDesconexion && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Es correcta
            </Button>
            <Button variant="outline" className="h-10" onClick={onPedirDesconexion} disabled={ocupado}>
              No, desconectar
            </Button>
          </div>
        </div>
      )}

      {sospecha && paso.confirmada && (
        <Button variant="outline" className="h-10 border-amber-500/40 text-amber-200 hover:bg-amber-500/10" onClick={onPedirDesconexion} disabled={ocupado}>
          Desconectar
        </Button>
      )}

      <AlertDialog open={confirmarDesconexion} onOpenChange={(v) => !v && onCancelarDesconexion()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Desconectar {alias ? <span className="font-mono">{alias}</span> : 'esta cuenta'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Dejamos de leer esta cuenta. Lo que ya se trajo queda; lo nuevo va a quedar «Sin verificar» hasta que la vuelvas a conectar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onDesconectar} className="bg-red-600 text-white hover:bg-red-600/90">
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      {paso.fase === 'listo' && (
        <Button variant={paso.viaLink && !paso.confirmada ? 'ghost' : 'default'} className="h-11 w-full sm:h-10" onClick={onListo}>
          Listo
        </Button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pegar un access token: verificar → ver la identidad → guardar
// ─────────────────────────────────────────────────────────────────────────────

function TokenManual({
  paymentAccountId,
  abiertoInicial,
  onConectada,
}: {
  paymentAccountId: string
  abiertoInicial: boolean
  onConectada: (cuentaMpId: string, titular: string | null) => void
}) {
  const [abierto, setAbierto] = useState(abiertoInicial)
  const [token, setToken] = useState('')
  const [ver, setVer] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [identidad, setIdentidad] = useState<{ identidad: IdentidadMP; yaConectadaComo: string[] } | null>(null)

  async function verificar(e: FormEvent) {
    e.preventDefault()
    const t = token.trim()
    if (!RE_TOKEN.test(t)) {
      setError(ERROR_TOKEN)
      return
    }
    setVerificando(true)
    setError(null)
    const r = await llamar(() => verificarTokenManual({ paymentAccountId, accessToken: t }))
    setVerificando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    if (!r.identidad.liveMode) {
      setError(ERROR_TOKEN)
      return
    }
    setIdentidad({ identidad: r.identidad, yaConectadaComo: r.yaConectadaComo })
  }

  async function guardar() {
    const t = token.trim()
    setGuardando(true)
    setError(null)
    const r = await llamar(() => conectarCuentaManual({ paymentAccountId, accessToken: t }))
    setGuardando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    // El token no queda en la pantalla un segundo más de lo necesario.
    setToken('')
    onConectada(r.cuentaMpId, identidad?.identidad.titular ?? identidad?.identidad.nickname ?? null)
  }

  const quien = identidad ? (identidad.identidad.titular ?? identidad.identidad.nickname ?? 'una cuenta sin nombre') : null

  return (
    <div className="rounded-xl border border-white/10">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        className="flex min-h-12 w-full items-start gap-2.5 px-4 py-3 text-left"
      >
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-zinc-100">Pegar un access token</span>
          <span className="block text-xs text-muted-foreground">Sólo si tenés las credenciales de producción de esta cuenta.</span>
        </span>
      </button>
      {abierto && (
        <form onSubmit={verificar} className="space-y-2.5 border-t border-white/10 px-4 pt-3 pb-4">
          <label htmlFor="token-mp" className="text-xs text-muted-foreground">
            Access token de producción
          </label>
          <div className="relative">
            <Input
              id="token-mp"
              type={ver ? 'text' : 'password'}
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                setIdentidad(null)
                setError(null)
              }}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              placeholder="APP_USR-…"
              className="h-11 pr-11 font-mono text-[13px] sm:h-10"
              aria-invalid={error ? true : undefined}
              aria-describedby="token-mp-ayuda"
            />
            <button
              type="button"
              onClick={() => setVer((v) => !v)}
              className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground"
              aria-label={ver ? 'Ocultar el token' : 'Mostrar el token'}
            >
              {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p id="token-mp-ayuda" className="text-xs text-muted-foreground">
            Empieza con APP_USR-. Está en Mercado Pago Developers → Tus integraciones → Credenciales de producción.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          {identidad ? (
            <div className="space-y-2.5 rounded-lg border border-white/12 bg-white/[0.03] p-3">
              <p className="text-sm text-zinc-100">
                Es la cuenta de <span className="font-semibold">{quien}</span>
                {identidad.identidad.emailEnmascarado ? ` (${identidad.identidad.emailEnmascarado})` : ''}. ¿Guardar?
              </p>
              {identidad.yaConectadaComo.length > 0 && (
                <p className="text-xs text-amber-200/90">
                  Esa cuenta de Mercado Pago ya está conectada como {identidad.yaConectadaComo.join(', ')}: esta cuenta de cobro se suma a la
                  misma conexión.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" className="h-10" onClick={() => void guardar()} disabled={guardando}>
                  {guardando && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Sí, es esta
                </Button>
                <Button type="button" variant="ghost" className="h-10" onClick={() => setIdentidad(null)} disabled={guardando}>
                  No
                </Button>
              </div>
            </div>
          ) : (
            <Button type="submit" variant="secondary" className="h-10" disabled={verificando || token.trim().length === 0}>
              {verificando && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Verificar
            </Button>
          )}
        </form>
      )}
    </div>
  )
}

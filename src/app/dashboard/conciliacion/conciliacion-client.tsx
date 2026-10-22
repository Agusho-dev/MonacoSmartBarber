'use client'

// /dashboard/conciliacion: cada mañana, en 3 segundos, si cuadró la plata de
// ayer entre lo que entró DE VERDAD en Mercado Pago y lo cobrado por
// transferencia; cada diferencia con su evidencia; y las cuentas de los
// barberos conectadas con un link que ellos autorizan.
//
// Reglas de la pantalla (spec C):
//   - El veredicto, los totales y los estados los calcula el motor (servidor).
//     Acá no se recalcula un peso: se ordena, se filtra y se muestra.
//   - Ningún número inventado: si la conciliación no se pudo leer, banda roja
//     y "—" en vez de ceros (Known Risk #15).
//   - Al abrir se leen solas, de a una, las cuentas con la última lectura de
//     hace más de 10 min; lo anterior sigue visible y al final se recalcula.
//   - Sin conciliacion.manage no se ven Conectar, Sincronizar, Vincular,
//     Marcar revisado, Confirmar, No es este ni Desconectar (y el servidor
//     igual lo rechaza).
//   - Lo que se ve tiene que ser del período y la sucursal elegidos: mientras
//     se calcula otro, lo anterior queda atenuado y no se exporta; y si llega
//     otro período por un enlace (Tex) con la pantalla abierta, se adopta.

import { useEffect, useRef, useState } from 'react'
import { Scale } from 'lucide-react'
import { toast } from 'sonner'
import type { CasoConciliacion, CuentaConciliacion, RespuestaConciliacion, ResultadoConciliacion } from '@/lib/conciliacion-mp/contrato'
import {
  confirmarCuentaMP,
  desconectarCuentaMP,
  deshacerRechazo,
  deshacerResolucion,
  marcarCuentaBanco,
  obtenerConciliacion,
  obtenerTiraConciliacion,
} from '@/lib/actions/conciliacion-mp'
import { abrirTex } from '@/components/tex/abrir-tex'
import type { TexPoseNombre } from '@/components/tex/assets'
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
import { exportCSV } from '@/lib/export'
import { cn } from '@/lib/utils'
import { Casos, TAMANO_PAGINA } from './components/casos'
import { ConectarCuenta, type InicioConectar } from './components/conectar-cuenta'
import { ControlPeriodo, SelectorSucursal } from './components/control-periodo'
import { HojaCuentas, LineaCuentas, SeccionCuentas, type AccionesCuenta } from './components/cuentas'
import { DetalleCaso, type ModoDetalle, type Resuelto } from './components/detalle-caso'
import { BannerErrorCarga, BannerErrorMP, NadaConectado } from './components/estados'
import { EstilosConciliacion } from './components/estilos'
import {
  claveDe,
  datosConError,
  datosDesde,
  queHacerConInicial,
  tiraAlPedir,
  tiraCargando,
  tiraConRespuesta,
  tiraVisible as tiraDeLaSucursal,
  type Datos,
  type EstadoTira,
} from './components/estado-pantalla'
import { diaCorto, horaAR, ymdAR } from './components/formato'
import { llamar } from './components/llamar'
import {
  ENCABEZADOS_CSV,
  FILTROS_VACIOS,
  SEPARADOR_CSV,
  contarPorPestana,
  cuentasConError as calcularCuentasConError,
  errorDeLecturaResuelto,
  etiquetaDeCaso,
  filasCSV,
  filtrarCasos,
  montoDelCaso,
  nombreArchivoCSV,
  nombresDeSucursal,
  normalizar,
  opcionesDeFiltro,
  ordenarCasos,
  ordenarCuentas,
  pestanaDeCaso,
  resumenCuentas,
  sePuedeRevisar,
  type FiltroDeNarrativa,
  type FiltrosCasos,
  type PestanaCasos,
} from './components/logica'
import {
  COOKIE_PRESET,
  fraseDePeriodo,
  hoyEnArgentina,
  limitesISO,
  rangoDePreset,
  type Periodo,
  type PresetPeriodo,
} from './components/periodo'
import { TexCard } from './components/tex-card'
import { TiraDias } from './components/tira-dias'
import { reemplazarParams, useParamEnHistorial } from './components/use-pantalla'
import { useSincronizacion } from './components/use-sincronizacion'
import { Veredicto } from './components/veredicto'

export interface InicialConciliacion {
  periodo: Periodo
  hoy: string
  /** `?sucursal=<id>` (validada contra el alcance). null = todas las del alcance. */
  sucursalId: string | null
  respuesta: RespuestaConciliacion
  /** `?conectada=<cuentaMpId>`: volvió del OAuth hecho desde el dashboard. */
  conectadaId: string | null
  /** `?mp=error&motivo=…`: el OAuth hecho desde el dashboard falló. */
  mpError: { motivo: string | null } | null
}

interface Props {
  inicial: InicialConciliacion
  /** Las sucursales del alcance (el selector aparece con más de una). */
  sucursales: { id: string; nombre: string }[]
  puedeGestionar: boolean
  texDisponible: boolean
  /** Si el servidor tiene la app de OAuth configurada (para cuando no hay resultado que lo diga). */
  oauthEntorno: boolean
  urlRedireccion: string
}

interface EstadoConectar {
  abierto: boolean
  cuenta: CuentaConciliacion | null
  inicio: InicioConectar
  /** Cambia en cada apertura: el flujo arranca de cero. */
  apertura: number
}

/** Después de esto sin mirar la pestaña, al volver se relee Mercado Pago y se recalcula. */
const REFRESCO_AL_VOLVER_MS = 10 * 60_000

function poseDe(r: ResultadoConciliacion | null, hayErrores: boolean): TexPoseNombre {
  if (!r) return 'ayuda'
  switch (r.veredicto.tipo) {
    case 'cuadra':
      // Logro sólo con la lista cerrada: todas las cuentas leídas.
      return r.cobertura.pctPlata >= 99.5 && !hayErrores ? 'logro' : 'analiza'
    case 'no_cuadra':
      return 'analiza'
    case 'sin_movimientos':
      return 'saludo'
    default:
      return 'ayuda'
  }
}

function textoErrorOAuth(motivo: string | null): string {
  switch (motivo) {
    case 'cancelado':
      return 'Cancelaste en Mercado Pago. Si fue sin querer, probá de nuevo.'
    case 'vencido':
      return 'La autorización tardó demasiado y venció. Probá de nuevo.'
    default:
      return 'Mercado Pago no confirmó la conexión. Probá de nuevo.'
  }
}

function guardarPreset(p: PresetPeriodo) {
  try {
    document.cookie = `${COOKIE_PRESET}=${p}; path=/dashboard/conciliacion; max-age=31536000; samesite=lax`
  } catch {
    /* sin cookies, el período de siempre (Ayer) */
  }
}

export function ConciliacionClient({ inicial, sucursales, puedeGestionar, texDisponible, oauthEntorno, urlRedireccion }: Props) {
  const [hoy, setHoy] = useState(inicial.hoy)
  const [periodo, setPeriodo] = useState(inicial.periodo)
  const [sucursalId, setSucursalId] = useState(inicial.sucursalId)
  const [datos, setDatos] = useState<Datos>(() => datosDesde(inicial.periodo, inicial.sucursalId, inicial.respuesta))
  const [cargando, setCargando] = useState(false)
  const pedido = useRef(0)
  const [tira, setTira] = useState<EstadoTira>(() => tiraCargando(inicial.sucursalId))
  const pedidoTira = useRef(0)
  const tiraDiferida = useRef<number | null>(null)

  const [pestana, setPestana] = useState<PestanaCasos>('revisar')
  const [filtros, setFiltros] = useState<FiltrosCasos>(FILTROS_VACIOS)
  const [visibles, setVisibles] = useState(TAMANO_PAGINA)
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null)
  const [ocultos, setOcultos] = useState<Set<string>>(() => new Set())
  const [modoDetalle, setModoDetalle] = useState<ModoDetalle>('normal')
  const [casoId, abrirCasoUrl, cerrarCasoUrl] = useParamEnHistorial('caso')
  const [hojaCuentas, abrirHojaCuentasUrl, cerrarHojaCuentas] = useParamEnHistorial('cuentas')
  // "Conectar" también vive en la URL: en el celular es a pantalla completa y el "atrás" de
  // Android tiene que cerrarlo, no sacarte de la conciliación (y cortar la espera del link).
  const [conectarUrl, abrirConectarUrl, cerrarConectarUrl] = useParamEnHistorial('conectar')
  const cambiosConectar = useRef(false)

  const [conectar, setConectar] = useState<EstadoConectar | null>(() =>
    inicial.conectadaId
      ? { abierto: true, cuenta: null, inicio: { tipo: 'post_oauth', cuentaMpId: inicial.conectadaId }, apertura: 1 }
      : null,
  )
  const [desconectando, setDesconectando] = useState<CuentaConciliacion | null>(null)
  const [cuentaOcupada, setCuentaOcupada] = useState<string | null>(null)
  const [plegadaManual, setPlegadaManual] = useState<boolean | null>(null)
  const [cifrasAnimadas, setCifrasAnimadas] = useState(false)
  const [arranque] = useState(() => ({ mpError: inicial.mpError, conectada: inicial.conectadaId }))

  // ── Llegó otro `inicial` del servidor ────────────────────────────────────
  // Navegar a ESTA misma página con otros parámetros (el enlace «Ver la
  // conciliación» de Tex, con el panel abierto al lado) conserva la instancia:
  // Next vuelve a correr page.tsx y manda otro `inicial`, pero el estado de
  // arriba lo ignoraba (la pantalla seguía en Ayer y la URL decía otra cosa).
  // Si es otro período o sucursal, se adopta; si es el mismo (un refresco), sólo
  // se toman los datos si son más nuevos. Los cambios de la propia pantalla van
  // por history.replaceState y no traen un `inicial` nuevo.
  const [inicialVisto, setInicialVisto] = useState(inicial)
  if (inicial !== inicialVisto) {
    setInicialVisto(inicial)
    setHoy(inicial.hoy)
    const accion = queHacerConInicial({ periodo, sucursalId, datos }, inicial)
    if (accion === 'adoptar') {
      setPeriodo(inicial.periodo)
      setSucursalId(inicial.sucursalId)
      setVisibles(TAMANO_PAGINA)
      setSeleccionadoId(null)
    }
    if (accion !== 'ignorar') {
      setDatos(datosDesde(inicial.periodo, inicial.sucursalId, inicial.respuesta))
      setOcultos(new Set())
    }
  }

  // Lo último que se eligió, para los callbacks que llegan tarde (fin de una
  // sincronización, "Deshacer" de un aviso, una respuesta lenta): nunca
  // recargan ni muestran un período viejo.
  const actual = useRef({ periodo, hoy, sucursalId })
  useEffect(() => {
    actual.current = { periodo, hoy, sucursalId }
  })

  // Lo hace el hook de sincronización; `cargar` lo llama al recibir datos nuevos.
  const podarErrores = useRef<(cuentas: CuentaConciliacion[]) => void>(() => {})

  // ── Datos ────────────────────────────────────────────────────────────────
  /** Pide la conciliación. true si llegó y quedó en pantalla. */
  async function cargar(p: Periodo, s: string | null): Promise<boolean> {
    const id = ++pedido.current
    setCargando(true)
    const { desde, hasta } = limitesISO(p)
    const r = await llamar(() => obtenerConciliacion({ desde, hasta, sucursalId: s }))
    if (id !== pedido.current) return false
    setCargando(false)
    const clave = claveDe(p, s)
    // Mientras viajaba, la pantalla pasó a otro período o sucursal (un enlace de Tex): no se pisa.
    if (clave !== claveDe(actual.current.periodo, actual.current.sucursalId)) return false
    if (r.ok) {
      setDatos({ clave, periodo: p, sucursalId: s, resultado: r, error: null })
      setOcultos(new Set())
      podarErrores.current(r.cuentas)
      return true
    }
    // Si lo que hay es del MISMO período, se queda (con la banda roja que lo
    // aclara). Si es de otro período, no se muestra: sería un número ajeno.
    setDatos((prev) => datosConError(prev, p, s, r.error))
    return false
  }

  async function cargarTira(s: string | null): Promise<void> {
    const id = ++pedidoTira.current
    // Los días de otra sucursal no se muestran como de ésta: ni mientras carga ni si falla.
    setTira((prev) => tiraAlPedir(prev, s))
    const r = await llamar(() => obtenerTiraConciliacion({ dias: 30, sucursalId: s }))
    if (id !== pedidoTira.current) return
    setTira((prev) => tiraConRespuesta(prev, s, r))
  }

  /** Recalcula todo lo que se ve (el período elegido y la tira). true si la conciliación llegó. */
  async function recalcular(): Promise<boolean> {
    const [ok] = await Promise.all([
      cargar(actual.current.periodo, actual.current.sucursalId),
      cargarTira(actual.current.sucursalId),
    ])
    return ok
  }

  /** Después de resolver casos: la tira se recalcula una vez, cuando se deja de tocar. */
  function programarTira() {
    if (tiraDiferida.current) window.clearTimeout(tiraDiferida.current)
    tiraDiferida.current = window.setTimeout(() => {
      tiraDiferida.current = null
      void cargarTira(actual.current.sucursalId)
    }, 2000)
  }

  // La tira es de la sucursal que se ve: se pide al abrir y cada vez que cambia
  // (con el selector o con un enlace que trae otra).
  const tiraDeSucursal = useRef<(s: string | null) => void>(() => {})
  useEffect(() => {
    tiraDeSucursal.current = (s) => void cargarTira(s)
  })
  useEffect(() => {
    tiraDeSucursal.current(sucursalId)
  }, [sucursalId])

  // Cuándo se refrescó por última vez lo de Mercado Pago (para decidir al volver a la pestaña).
  const ultimoRefresco = useRef(0)

  const sync = useSincronizacion(async (fin) => {
    const ok = await recalcular()
    ultimoRefresco.current = Date.now()
    if (fin.origen === 'manual') {
      if (fin.errores.length === 1) {
        toast.error(`No se pudo leer ${fin.errores[0].alias ?? 'una cuenta'}: ${fin.errores[0].error}`)
      } else if (fin.errores.length > 1) {
        toast.error(`No se pudieron leer ${fin.errores.length} cuentas.`)
      } else {
        toast.success(fin.leidas === 1 ? 'Cuenta leída.' : 'Mercado Pago al día.')
      }
    }
    // Recalculada: las tarjetas vuelven al estado del servidor ("Al día", "Atrasada", "Error").
    return ok
  })

  useEffect(() => {
    podarErrores.current = (cuentas) => sync.podarErrores((e) => errorDeLecturaResuelto(e, cuentas))
  })

  /**
   * Lee Mercado Pago (las cuentas viejas) y recalcula. Si no había nada que
   * leer —el cron u otra pestaña ya las tenía al día—, recalcula igual: si no,
   * quedaban los números de hace horas presentándose como actuales.
   */
  async function refrescarTodo(): Promise<void> {
    const seRecalcula = await sync.auto()
    if (!seRecalcula) await recalcular()
    ultimoRefresco.current = Date.now()
  }

  // ── Al abrir: la lectura automática y los avisos del OAuth ───────────────
  const alAbrir = useRef<() => void>(() => {})
  useEffect(() => {
    alAbrir.current = () => {
      void sync.auto()
    }
  })
  useEffect(() => {
    ultimoRefresco.current = Date.now()
    alAbrir.current()
  }, [])

  useEffect(() => {
    if (arranque.mpError) toast.error(textoErrorOAuth(arranque.mpError.motivo))
    // Que recargar no repita el aviso ni el flujo de conexión; la vuelta del OAuth abre "Conectar".
    if (arranque.mpError || arranque.conectada) {
      reemplazarParams({ conectada: null, mp: null, motivo: null, conectar: arranque.conectada ?? null })
    }
  }, [arranque])

  // "Conectar" se cerró (con la X, Esc, tocando afuera o con "atrás"): si algo cambió, se recalcula.
  const conectarAbierto = !!conectar?.abierto && conectarUrl != null
  const alCerrarseConectar = useRef<() => void>(() => {})
  useEffect(() => {
    alCerrarseConectar.current = () => {
      if (!cambiosConectar.current) return
      cambiosConectar.current = false
      void recalcular()
    }
  })
  useEffect(() => {
    if (!conectarAbierto) alCerrarseConectar.current()
  }, [conectarAbierto])

  // Volver a la pestaña después de un rato: el "hoy" puede haber cambiado y lo
  // que se ve puede estar viejo. Se relee lo que haga falta y se recalcula SIEMPRE.
  const alVolver = useRef<() => void>(() => {})
  useEffect(() => {
    alVolver.current = () => {
      setHoy(hoyEnArgentina())
      if (sync.estado.activo || Date.now() - ultimoRefresco.current <= REFRESCO_AL_VOLVER_MS) return
      ultimoRefresco.current = Date.now()
      void refrescarTodo()
    }
  })
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === 'visible') alVolver.current()
    }
    document.addEventListener('visibilitychange', f)
    return () => {
      document.removeEventListener('visibilitychange', f)
      if (tiraDiferida.current) window.clearTimeout(tiraDiferida.current)
    }
  }, [])

  // ── Período ──────────────────────────────────────────────────────────────
  function irA(p: Periodo) {
    setPeriodo(p)
    setVisibles(TAMANO_PAGINA)
    setSeleccionadoId(null)
    reemplazarParams({ desde: p.desde, hasta: p.hasta, caso: null })
    void cargar(p, sucursalId)
  }

  function alPreset(preset: PresetPeriodo) {
    const h = hoyEnArgentina()
    setHoy(h)
    guardarPreset(preset)
    irA(rangoDePreset(preset, h))
  }

  /** La sucursal manda en TODA la pantalla (veredicto, tira, cuentas y casos), como en los enlaces de Tex. */
  function cambiarSucursal(s: string | null) {
    setSucursalId(s)
    setVisibles(TAMANO_PAGINA)
    setSeleccionadoId(null)
    reemplazarParams({ sucursal: s, caso: null })
    void cargar(periodo, s)
    // La tira la pide el efecto de la sucursal (y mientras llega no muestra los días de la otra).
  }

  // ── Derivados ────────────────────────────────────────────────────────────
  const resultado = datos.resultado
  // Lo que se ve es de otro período o sucursal: el que se eligió se está calculando.
  const desfasado = datos.clave !== claveDe(periodo, sucursalId)
  const casos = resultado?.casos ?? []
  const cuentas = resultado ? ordenarCuentas(resultado.cuentas) : []
  const resumen = resumenCuentas(cuentas)
  const nadaConectado = resultado != null && resumen.ningunaConectada
  const opciones = opcionesDeFiltro(casos, cuentas)
  const nombresSucursal = nombresDeSucursal(casos, cuentas)
  const aliasesConocidos = [...new Set([...opciones.aliases, ...cuentas.flatMap((c) => c.aliases)])]
  const casosFiltrados = filtrarCasos(casos, filtros)
  const conteos = contarPorPestana(casosFiltrados.filter((c) => !ocultos.has(c.id)))
  const lista = ordenarCasos(
    casosFiltrados.filter((c) => pestanaDeCaso(c) === pestana),
    pestana,
  )
  const navegables = lista.filter((c) => !ocultos.has(c.id))
  // El formato de la hora sigue a los datos que se ven, no al control.
  const multiDia = datos.periodo.desde !== datos.periodo.hasta
  const casoAbierto = casoId ? (casos.find((c) => c.id === casoId) ?? null) : null
  const indiceAbierto = casoAbierto ? navegables.findIndex((c) => c.id === casoAbierto.id) : -1

  // Las cuentas que no se pudieron leer: las que da el servidor y las que fallaron desde acá
  // y todavía no se volvieron a leer bien (mientras corre una lectura, sus errores van en las tarjetas).
  const cuentasConError = calcularCuentasConError(cuentas, sync.estado.activo ? [] : sync.estado.errores)
  // Una cuenta que no se pudo leer sólo pesa sobre ESTE período si tiene cobros acá que quedaron
  // sin verificar o esperando: si lo del período ya estaba leído, el veredicto vale igual.
  const fallidas = new Set(cuentasConError.map((c) => c.id))
  const errorAfectaPeriodo =
    resultado != null &&
    cuentasConError.length > 0 &&
    (resultado.veredicto.tipo === 'error' ||
      casos.some((c) => (c.estado === 'sin_verificar' || c.estado === 'pendiente') && c.cuentaMpId != null && fallidas.has(c.cuentaMpId)))
  const pose = poseDe(resultado, errorAfectaPeriodo)
  const plegada = plegadaManual ?? (resumen.todasAlDia && cuentasConError.length === 0)
  const oauthDisponible = resultado?.oauthDisponible ?? oauthEntorno

  // ── Casos ────────────────────────────────────────────────────────────────
  function abrirCaso(c: CasoConciliacion, modo: ModoDetalle = 'normal') {
    setSeleccionadoId(c.id)
    setModoDetalle(modo)
    abrirCasoUrl(c.id)
  }

  function navegarDetalle(dir: -1 | 1) {
    const i = casoId ? navegables.findIndex((c) => c.id === casoId) : -1
    const sig = navegables[i === -1 ? 0 : i + dir]
    if (!sig) return
    if (navegables.indexOf(sig) >= visibles) setVisibles((v) => v + TAMANO_PAGINA)
    setSeleccionadoId(sig.id)
    setModoDetalle('normal')
    abrirCasoUrl(sig.id)
  }

  function cambiarPestana(p: PestanaCasos) {
    setPestana(p)
    setVisibles(TAMANO_PAGINA)
    setSeleccionadoId(null)
  }

  function irALaLista() {
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('casos')?.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' })
  }

  /** "Ver los N para confirmar" del veredicto: la pestaña de los emparejamientos dudosos. */
  function verParaConfirmar() {
    cambiarPestana('confirmar')
    irALaLista()
  }

  function cambiarFiltros(f: FiltrosCasos) {
    setFiltros(f)
    setVisibles(TAMANO_PAGINA)
    setSeleccionadoId(null)
  }

  function alFiltrarNarrativa(f: FiltroDeNarrativa) {
    const pedido = f.alias
    const alias = pedido ? (opciones.aliases.find((a) => normalizar(a) === normalizar(pedido)) ?? pedido) : null
    setPestana(f.pestana)
    setFiltros({ ...FILTROS_VACIOS, estado: f.estado, alias })
    setVisibles(TAMANO_PAGINA)
    setSeleccionadoId(null)
    irALaLista()
  }

  /** El "Deshacer" del aviso: una resolución (vínculo, revisado) o un descarte ("No es este"). */
  async function deshacer(tipo: Resuelto['tipo'], ids: string[], afectados: string[]) {
    const r = await llamar(() => (tipo === 'rechazo' ? deshacerRechazo(ids) : deshacerResolucion(ids)))
    if (!r.ok) {
      toast.error(r.error ?? 'No se pudo deshacer.')
      return
    }
    setOcultos((prev) => {
      const n = new Set(prev)
      for (const a of afectados) n.delete(a)
      return n
    })
    toast.success('Listo: volvió a como estaba.')
    void cargar(actual.current.periodo, actual.current.sucursalId)
    programarTira()
  }

  function alResolver(r: Resuelto) {
    setOcultos((prev) => new Set([...prev, ...r.casosAfectados]))
    cerrarCasoUrl()
    toast.success(r.mensaje, {
      duration: 6000,
      action: { label: 'Deshacer', onClick: () => void deshacer(r.tipo, r.ids, r.casosAfectados) },
    })
    void cargar(periodo, sucursalId)
    programarTira()
  }

  function alDeshacerDesdeDetalle(opciones?: { cerrar?: boolean }) {
    if (opciones?.cerrar) cerrarCasoUrl()
    toast.success('Listo: volvió a como estaba.')
    void cargar(periodo, sucursalId)
    programarTira()
  }

  function preguntarPeriodo() {
    // La pregunta es sobre lo que se ve (el botón no está activo mientras se calcula otro período).
    const frase = fraseDePeriodo(datos.periodo, hoy)
    const tipo = resultado?.veredicto.tipo
    const pregunta =
      !tipo || tipo === 'error' || tipo === 'no_se_sabe'
        ? `¿Qué falta para saber si cuadró la plata ${frase}?`
        : tipo === 'cuadra' || tipo === 'sin_movimientos'
          ? `Contame cómo salió la conciliación ${frase}`
          : `Explicame las diferencias de la conciliación ${frase}`
    abrirTex({ pregunta, enviar: true })
  }

  function preguntarCaso(c: CasoConciliacion) {
    // El panel de Tex no se ve detrás de la hoja del detalle: primero se cierra.
    if (casoId) cerrarCasoUrl()
    const dia = ymdAR(c.fecha)
    abrirTex({
      pregunta: `Explicame este caso de la conciliación: ${etiquetaDeCaso(c).toLowerCase()}, ${montoDelCaso(c)}, ${
        dia ? `${diaCorto(dia)} ` : ''
      }a las ${horaAR(c.fecha)}${c.alias ? ` en ${c.alias}` : ''}.`,
      enviar: true,
    })
  }

  function exportar(todo: boolean) {
    // Mientras se calcula otro período, lo que hay es del anterior: no se exporta con el nombre del nuevo.
    if (!resultado || desfasado) return
    const fuente = todo ? casosFiltrados.filter((c) => !ocultos.has(c.id)) : navegables
    exportCSV(ENCABEZADOS_CSV, filasCSV(fuente, nombresSucursal), nombreArchivoCSV(datos.periodo, todo ? null : pestana), {
      separador: SEPARADOR_CSV,
    })
  }

  // ── Cuentas ──────────────────────────────────────────────────────────────
  function abrirConectar(c: CuentaConciliacion | null, inicio: InicioConectar) {
    setConectar((prev) => ({ abierto: true, cuenta: c, inicio, apertura: (prev?.apertura ?? 0) + 1 }))
    abrirConectarUrl(c?.id ?? 'cuenta')
  }

  function cerrarConectar(huboCambios: boolean) {
    if (huboCambios) cambiosConectar.current = true
    setConectar((prev) => (prev ? { ...prev, abierto: false } : prev))
    cerrarConectarUrl()
  }

  async function sincronizarManual(ids?: string[]) {
    const r = await sync.manual(ids)
    if (!r.ok) toast.error(r.error)
  }

  function reintentarLectura() {
    if (puedeGestionar) {
      const ids = cuentasConError.map((c) => c.id).filter((id) => cuentas.some((cu) => cu.cuentaMpId === id))
      void sincronizarManual(ids.length ? ids : undefined)
    } else {
      // Sin `manage` sólo se leen las cuentas viejas (más de 10 min). Si ninguna lo está —el cron
      // ya la leyó bien—, se recalcula igual: así la banda roja se va en vez de quedar fija.
      void refrescarTodo()
    }
  }

  function irAConectarCuentas() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setPlegadaManual(false)
      requestAnimationFrame(() => document.getElementById('cuentas')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } else {
      abrirHojaCuentasUrl('1')
    }
  }

  async function conOcupada(c: CuentaConciliacion, accion: () => Promise<{ ok: boolean; error?: string }>, exito: string) {
    setCuentaOcupada(c.id)
    const r = await llamar(accion)
    setCuentaOcupada(null)
    if (!r.ok) {
      toast.error(r.error ?? 'No se pudo guardar.')
      return
    }
    toast.success(exito)
    void recalcular()
  }

  const accionesCuenta: AccionesCuenta = {
    onConectar: (c) => abrirConectar(c, { tipo: 'normal' }),
    onSeguirLink: (c) =>
      abrirConectar(c, c.linkPendiente ? { tipo: 'link', linkId: c.linkPendiente.id, venceEn: c.linkPendiente.venceEn } : { tipo: 'normal' }),
    onSincronizar: (c) => {
      if (c.cuentaMpId) void sincronizarManual([c.cuentaMpId])
    },
    onConfirmar: (c) => {
      const id = c.cuentaMpId
      if (id) void conOcupada(c, () => confirmarCuentaMP(id), `Listo: ${c.alias ?? 'la cuenta'} quedó confirmada.`)
    },
    onDesconectar: (c) => setDesconectando(c),
    // Una sola llamada: el servidor lo aplica a TODAS las cuentas de cobro de la tarjeta (el mismo
    // alias en otra sucursal) y las desvincula de Mercado Pago.
    onMarcarBanco: (c, esBanco) => {
      const pa = c.paymentAccountIds[0]
      if (!pa) return
      const alias = c.alias ?? 'La cuenta'
      void conOcupada(
        c,
        () => marcarCuentaBanco(pa, esBanco),
        esBanco
          ? `${alias} queda como cuenta de banco, en todas las cuentas de cobro con ese alias.`
          : `${alias} vuelve a ser de Mercado Pago, en todas las cuentas de cobro con ese alias.`,
      )
    },
  }

  function confirmarDesconexion() {
    const c = desconectando
    setDesconectando(null)
    const id = c?.cuentaMpId
    if (c && id) void conOcupada(c, () => desconectarCuentaMP(id), `${c.alias ?? 'La cuenta'} quedó desconectada.`)
  }

  // ── Atajos de teclado (escritorio): ↑/↓, R, V, T ─────────────────────────
  // Sólo con el foco EN la lista de casos (o con el detalle abierto, para R/V/T):
  // con el foco en la página, las flechas siguen scrolleando como siempre. Enter
  // no hace falta atraparlo: cada fila es un botón. En el detalle, ↑/↓ scrollean
  // (para pasar de caso están las flechas del encabezado).
  const teclas = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    teclas.current = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      // Lo que se ve es del período anterior (el nuevo se está calculando): nada que navegar.
      if (desfasado) return
      const t = e.target instanceof HTMLElement ? e.target : null
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="menu"], [role="listbox"], [data-sin-atajos]')) {
        return
      }
      // Otra capa encima (conectar, desconectar, la hoja de cuentas, una imagen ampliada): no.
      if (conectarAbierto || desconectando || hojaCuentas) return
      if (document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length > (casoId ? 1 : 0)) return
      const enLista = !casoId && t?.closest('[data-lista-casos]') != null
      if (!casoId && !enLista) return
      const filaId = t?.closest<HTMLElement>('[data-caso-id]')?.dataset.casoId ?? null
      const actualId = casoId ?? filaId ?? seleccionadoId
      const i = actualId ? navegables.findIndex((c) => c.id === actualId) : -1
      const elegido = casoAbierto ?? (i >= 0 ? navegables[i] : null)
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          if (!enLista || navegables.length === 0) return
          e.preventDefault()
          const j = i === -1 ? 0 : Math.min(navegables.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
          const sig = navegables[j]
          if (j >= visibles) setVisibles((v) => v + TAMANO_PAGINA)
          setSeleccionadoId(sig.id)
          requestAnimationFrame(() => document.getElementById(`caso-${sig.id}`)?.focus())
          return
        }
        case 'r':
        case 'R':
          if (puedeGestionar && elegido && sePuedeRevisar(elegido) && !elegido.resolucion) {
            e.preventDefault()
            abrirCaso(elegido, 'revisar')
          }
          return
        case 'v':
        case 'V':
          if (puedeGestionar && elegido && elegido.estado !== 'conciliado' && !elegido.resolucion) {
            e.preventDefault()
            abrirCaso(elegido, 'vincular')
          }
          return
        case 't':
        case 'T':
          if (texDisponible && elegido) {
            e.preventDefault()
            preguntarCaso(elegido)
          }
          return
      }
    }
  })
  useEffect(() => {
    const f = (e: KeyboardEvent) => teclas.current(e)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  // ── Pantalla ─────────────────────────────────────────────────────────────
  const inicioConectar = conectar?.inicio
  const conectarCuenta =
    conectar?.cuenta ??
    (inicioConectar?.tipo === 'post_oauth' ? (cuentas.find((c) => c.cuentaMpId === inicioConectar.cuentaMpId) ?? null) : null)
  // La tira es de la sucursal elegida o no se muestra (mientras llega la de otra: el esqueleto).
  const tiraVisible = tiraDeLaSucursal(tira, sucursalId)

  return (
    <>
      <EstilosConciliacion />
      <div className="mx-auto w-full max-w-[1180px] space-y-4 lg:space-y-5">
        <header className="space-y-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight lg:text-2xl">
              <Scale className="size-6 text-zinc-300" aria-hidden />
              Conciliación
            </h1>
            <p className="text-sm text-muted-foreground">Lo que entró de verdad en Mercado Pago contra lo cobrado por transferencia.</p>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
            <ControlPeriodo periodo={periodo} hoy={hoy} onPreset={alPreset} onPeriodo={irA} />
            {sucursales.length > 1 && <SelectorSucursal sucursales={sucursales} valor={sucursalId} onCambiar={cambiarSucursal} />}
          </div>
        </header>

        {datos.error && (
          <BannerErrorCarga
            error={datos.error}
            generadoEn={!desfasado ? (resultado?.generadoEn ?? null) : null}
            reintentando={cargando}
            onReintentar={() => void cargar(periodo, sucursalId)}
          />
        )}

        {resultado && cuentasConError.length > 0 && (
          <BannerErrorMP
            cuentas={cuentasConError}
            afectaPeriodo={errorAfectaPeriodo}
            reintentando={sync.estado.activo || cargando}
            onReintentar={reintentarLectura}
          />
        )}

        {nadaConectado ? (
          <NadaConectado cuentas={cuentas} puedeGestionar={puedeGestionar} onConectar={(c) => abrirConectar(c, { tipo: 'normal' })} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
            <div className="min-w-0 lg:col-span-7 xl:col-span-8">
              <Veredicto
                resultado={resultado}
                cargando={cargando || desfasado}
                sync={sync.estado}
                pose={pose}
                puedeGestionar={puedeGestionar}
                hayErroresDeLectura={errorAfectaPeriodo}
                hayCuentasSinConectar={cuentas.some((c) => c.estado === 'sin_conectar' && c.periodo.cobros > 0)}
                hayConectadas={resumen.conectadas > 0}
                animarCifras={!cifrasAnimadas}
                onCifrasAnimadas={() => setCifrasAnimadas(true)}
                onSincronizar={() => void sincronizarManual()}
                onConectarCuentas={irAConectarCuentas}
                onReintentarLectura={reintentarLectura}
                onVerParaConfirmar={verParaConfirmar}
              />
            </div>
            <div className="min-w-0 lg:col-span-5 xl:col-span-4">
              <TexCard
                resultado={resultado}
                pose={pose}
                aliases={aliasesConocidos}
                texDisponible={texDisponible}
                desfasado={desfasado}
                onFiltrar={alFiltrarNarrativa}
                onPreguntar={preguntarPeriodo}
              />
            </div>
          </div>
        )}

        {!nadaConectado && (
          <TiraDias
            estado={tiraVisible.estado}
            dias={tiraVisible.dias}
            error={tiraVisible.error}
            periodo={periodo}
            onElegirDia={(dia) => irA({ desde: dia, hasta: dia })}
            onReintentar={() => void cargarTira(sucursalId)}
          />
        )}

        {resultado && cuentas.length > 0 && (
          // Los números de cada tarjeta son del período que se ve: mientras se calcula otro, atenuados.
          <div aria-busy={desfasado} className={cn('space-y-4 transition-opacity duration-200 lg:space-y-5', desfasado && 'opacity-50')}>
            <SeccionCuentas
              cuentas={cuentas}
              resumen={resumen}
              sync={sync.estado}
              plegada={plegada}
              onPlegar={setPlegadaManual}
              puedeGestionar={puedeGestionar}
              ocupada={cuentaOcupada}
              acciones={accionesCuenta}
            />
            <LineaCuentas resumen={resumen} sync={sync.estado} onAbrir={() => abrirHojaCuentasUrl('1')} />
          </div>
        )}

        {resultado && !nadaConectado && (
          <Casos
            resultado={resultado}
            pestana={pestana}
            onPestana={cambiarPestana}
            conteos={conteos}
            filtros={filtros}
            onFiltros={cambiarFiltros}
            opciones={opciones}
            lista={lista}
            visibles={visibles}
            onVerMas={() => setVisibles((v) => v + TAMANO_PAGINA)}
            ocultos={ocultos}
            seleccionadoId={casoId ?? seleccionadoId}
            onAbrir={(c) => abrirCaso(c)}
            multiDia={multiDia}
            cantidadVisible={navegables.length}
            totalFiltrado={casosFiltrados.filter((c) => !ocultos.has(c.id)).length}
            onExportar={exportar}
            atajos={{ revisar: puedeGestionar, tex: texDisponible }}
            onVerPestana={cambiarPestana}
            desfasado={desfasado}
          />
        )}
      </div>

      <DetalleCaso
        abierto={casoId != null}
        caso={casoAbierto}
        casos={casos}
        cuentas={cuentas}
        multiDia={multiDia}
        puedeGestionar={puedeGestionar}
        texDisponible={texDisponible}
        modo={modoDetalle}
        hayAnterior={indiceAbierto > 0}
        haySiguiente={indiceAbierto >= 0 && indiceAbierto < navegables.length - 1}
        onCerrar={cerrarCasoUrl}
        onNavegar={navegarDetalle}
        onResuelto={alResolver}
        onDeshecho={alDeshacerDesdeDetalle}
        onConectarCuenta={(c) => {
          // Del detalle a "Conectar" en UN paso: un history.back() (cerrar el caso) seguido de un
          // pushState (abrir Conectar) se pisan, y el "atrás" encolado se llevaría el Conectar.
          reemplazarParams({ caso: null, conectar: c.id })
          setConectar((prev) => ({ abierto: true, cuenta: c, inicio: { tipo: 'normal' }, apertura: (prev?.apertura ?? 0) + 1 }))
        }}
        onPreguntarTex={preguntarCaso}
      />

      {resultado && (
        <HojaCuentas
          abierta={hojaCuentas != null}
          onCerrar={cerrarHojaCuentas}
          cuentas={cuentas}
          resumen={resumen}
          sync={sync.estado}
          puedeGestionar={puedeGestionar}
          ocupada={cuentaOcupada}
          acciones={accionesCuenta}
        />
      )}

      {conectar && (
        <ConectarCuenta
          key={conectar.apertura}
          abierto={conectarAbierto}
          cuenta={conectarCuenta}
          inicio={conectar.inicio}
          oauthDisponible={oauthDisponible}
          urlRedireccion={urlRedireccion}
          onCerrar={cerrarConectar}
          onCambio={() => {
            cambiosConectar.current = true
          }}
          onLeida={() => {
            void recalcular()
          }}
        />
      )}

      <AlertDialog open={desconectando != null} onOpenChange={(v) => !v && setDesconectando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Desconectar <span className="font-mono">{desconectando?.alias ?? 'la cuenta'}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Dejamos de leer esta cuenta. Lo que ya se trajo queda; lo nuevo va a quedar «Sin verificar» hasta que la vuelvas a conectar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarDesconexion} className="bg-red-600 text-white hover:bg-red-600/90">
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

'use client'

// Las piezas de las pantallas de las secciones de Mensajería (Difusiones,
// Automatizaciones, Alertas, Casos y Respuestas rápidas) y de sus hojas, como
// las listas de WhatsApp para iOS (23/oct/2026, tercera ronda; el dueño:
// «quiero que esto sea igual a whatsapp en mobile, en desktop también debe
// verse bien»). Hasta acá las secciones eran pantallas del dashboard metidas en
// la capa: letra de 10 px, botones de 12 px sin nombre y diálogos centrados.
// - Celular: listas agrupadas sobre fondo negro, celdas en grupos redondeados,
//   separadores finos que arrancan donde arranca el texto, letra de 17 px (la
//   secundaria, de 15 y 13) y objetivos de 44 px o más.
// - Compu: lo mismo con la piel de WhatsApp para Mac (los grises de .wa-scope
//   en lg, radios chicos y letra de 14 y 13), en una columna centrada.
// Los colores son los --wa-* de .wa-scope (globals.css). El --wa-text-3 no va en
// texto que haya que leer: sobre una celda da 3,2:1.

import { useId, useState, type ReactNode } from 'react'
import { ChevronRight, ChevronsUpDown, Eye, EyeOff, Loader2, type LucideIcon } from 'lucide-react'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'
import { toast } from 'sonner'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import { cn } from '@/lib/utils'
import { nombreLegibleDePlantilla } from '../shared/helpers'

// ── Letra ────────────────────────────────────────────────────────────────────

/** El texto principal de una celda: 17 px en el celular, 14 en la compu. */
export const TEXTO_PRINCIPAL = 'text-[17px] leading-[22px] text-[var(--wa-text)] lg:text-[14px] lg:leading-5'
/** El secundario: 15 px gris (6:1 sobre la celda). */
export const TEXTO_SECUNDARIO = 'text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[13px] lg:leading-[18px]'
/** El de los datos chicos (hora, contadores): 13 px gris. */
export const TEXTO_TERCIARIO = 'text-[13px] leading-[18px] text-[var(--wa-text-2)] lg:text-[12px] lg:leading-4'

/**
 * El campo de texto de una celda, sin caja (la caja es la celda). 17 px: con
 * menos, iOS agranda la pantalla al tocarlo. En la compu, 14 con mouse.
 */
export const CLASE_CAMPO_CELDA =
  'h-11 min-w-0 flex-1 bg-transparent text-[17px] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-3)] lg:h-8 lg:pointer-fine:text-[14px]'

/**
 * El nombre de una plantilla de Meta para una celda: legible y con mayúscula
 * ("te_extranamos" → "Te extranamos"). Los nombres de Meta no llevan eñes ni
 * tildes: no se inventan.
 */
export function nombreDePlantilla(nombre: string): string {
  const legible = nombreLegibleDePlantilla(nombre)
  return legible.charAt(0).toUpperCase() + legible.slice(1)
}

// ── La pantalla y los grupos ─────────────────────────────────────────────────

/**
 * Lo que scrollea de una sección, debajo de su barra. En el celular el
 * contenido pasa por debajo de la rayita de inicio, como en iOS: el último
 * grupo deja el área segura abajo.
 */
export function ContenidoSeccion({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain max-lg:touch-pan-y max-lg:touch-pinch-zoom">
      <div
        className={cn(
          'mx-auto w-full max-w-[46rem] px-4 pb-[calc(env(safe-area-inset-bottom,0px)_+_2rem)] pt-2 lg:px-8 lg:pb-10 lg:pt-6',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Un grupo de celdas: el título chico arriba (opcional, con una acción a la
 * derecha), la caja redondeada y la aclaración abajo. Los hijos son <li>
 * (CeldaIos y compañía).
 */
export function GrupoIos({
  titulo,
  accion,
  pie,
  children,
  className,
}: {
  titulo?: ReactNode
  /** A la derecha del título, por ejemplo «Actualizar». */
  accion?: ReactNode
  pie?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('mt-7 first:mt-3 lg:mt-6 lg:first:mt-0', className)}>
      {(titulo || accion) && (
        <div className={cn('flex justify-between gap-3 px-4 lg:px-3', accion ? 'items-center pb-0.5' : 'min-h-7 items-end pb-1.5')}>
          {titulo ? (
            <h2 className="min-w-0 text-[13px] font-semibold leading-[18px] text-[var(--wa-text-2)] lg:text-[12px] lg:leading-4">
              {titulo}
            </h2>
          ) : <span />}
          {accion}
        </div>
      )}
      <ul className="overflow-hidden rounded-[22px] bg-[var(--wa-raised)] lg:rounded-xl">{children}</ul>
      {pie && <div className="px-4 pt-2 text-[13px] leading-[18px] text-[var(--wa-text-2)] lg:px-3 lg:text-[12px] lg:leading-4">{pie}</div>}
    </section>
  )
}

// ── Las celdas ───────────────────────────────────────────────────────────────

/**
 * La celda: el <li> del grupo. `group/celda` es para que la última no dibuje su
 * separador (va en CLASE_CUERPO). Lo que va antes del cuerpo (el ícono) queda
 * afuera del separador, como en iOS.
 */
export const CLASE_CELDA = 'group/celda relative flex min-w-0 items-center gap-3 pl-4 lg:pl-3'

/** El cuerpo de la celda, con el separador fino abajo (no en la última). */
export const CLASE_CUERPO =
  'flex min-h-11 min-w-0 flex-1 items-center gap-2 self-stretch border-b-[0.5px] border-[var(--wa-divider)] py-2.5 pr-4 group-last/celda:border-transparent lg:min-h-10 lg:py-2 lg:pr-3'

/**
 * El cuerpo de una celda que es un botón (CLASE_BOTON_CELDA): sin relleno
 * arriba y abajo, que lo pone el botón, así el botón mide la celda entera (44
 * px o más) y no sólo su texto. Lo de la derecha va con `self-center`.
 */
export const CLASE_CUERPO_BOTON =
  'flex min-h-11 min-w-0 flex-1 items-stretch gap-2 self-stretch border-b-[0.5px] border-[var(--wa-divider)] pr-4 group-last/celda:border-transparent lg:min-h-10 lg:pr-3'

/**
 * El botón principal de una celda: va en CLASE_CUERPO_BOTON y mide la celda
 * de alto. Su ::before la cubre entera, también el ícono: tocar en cualquier
 * lado es tocarlo, y se resalta toda la celda como en iOS. Los controles de la
 * derecha van con `relative z-10` para quedar arriba. Sin selección de texto ni
 * el menú de "Copiar" de iOS al mantener. Apila su contenido (flex-col); para
 * una fila, `flex-row items-center`.
 */
export const CLASE_BOTON_CELDA = cn(
  // min-h-11 en el botón y no sólo en la celda: la raya de abajo (0,5 px) se
  // come su parte del alto de la celda y el botón quedaba de 43,5.
  'flex min-h-11 min-w-0 flex-1 flex-col justify-center self-stretch py-2.5 text-left outline-none select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] lg:min-h-10 lg:py-2',
  'before:absolute before:inset-0 before:transition-colors before:duration-100',
  'active:before:bg-white/[0.08] focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-[var(--wa-accent)]',
  'disabled:cursor-default disabled:active:before:bg-transparent lg:enabled:hover:before:bg-white/[0.04]',
)

/** Una celda armada: ícono (opcional), el contenido y lo de la derecha. */
export function CeldaIos({
  icono,
  children,
  derecha,
  campo = false,
  className,
  cuerpoClassName,
}: {
  icono?: ReactNode
  children: ReactNode
  derecha?: ReactNode
  /** Con un campo de texto adentro: el campo ya mide 44 y la celda no le suma relleno. */
  campo?: boolean
  className?: string
  cuerpoClassName?: string
}) {
  return (
    <li className={cn(CLASE_CELDA, className)}>
      {icono}
      <div className={cn(CLASE_CUERPO, campo && 'py-0 lg:py-0', cuerpoClassName)}>
        {children}
        {derecha}
      </div>
    </li>
  )
}

const COLORES_ICONO = {
  verde: 'bg-[#30b158]',
  azul: 'bg-[#0a84ff]',
  celeste: 'bg-[#32ade6]',
  turquesa: 'bg-[#2ca5b8]',
  naranja: 'bg-[#f08c00]',
  rojo: 'bg-[#ff453a]',
  rosa: 'bg-[#e8336b]',
  violeta: 'bg-[#a05cdc]',
  indigo: 'bg-[#5e5ce6]',
  gris: 'bg-[#636366]',
} as const
export type ColorIcono = keyof typeof COLORES_ICONO

/**
 * El ícono de color de una celda, como los de la configuración de iOS. Un
 * ícono que no es de lucide (el de WhatsApp) va como `glifo`, ya armado.
 */
export function IconoCeldaIos({
  icono: Icono,
  glifo,
  color,
  className,
}: {
  icono?: LucideIcon
  glifo?: ReactNode
  color: ColorIcono
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-white lg:size-7 lg:rounded-[7px]',
        COLORES_ICONO[color],
        className,
      )}
    >
      {glifo ?? (Icono && <Icono className="size-[18px] lg:size-4" strokeWidth={2.1} />)}
    </span>
  )
}

/**
 * Una celda con un <select> nativo invisible encima: en el iPhone abre el menú
 * del sistema. Se ve como las de iOS: la etiqueta a la izquierda y el valor en
 * gris a la derecha.
 */
export function CeldaSelectorIos<T extends string>({
  etiqueta,
  valor,
  opciones,
  onCambio,
  icono,
}: {
  etiqueta: string
  valor: T
  /** Con `grupo`, las opciones seguidas del mismo grupo van juntas bajo su título (optgroup). */
  opciones: readonly { valor: T; texto: string; grupo?: string }[]
  onCambio: (valor: T) => void
  icono?: ReactNode
}) {
  const actual = opciones.find((o) => o.valor === valor)?.texto ?? ''
  // Las opciones en tramos: las de un mismo grupo seguidas, en su optgroup.
  const tramos: { grupo?: string; opciones: { valor: T; texto: string }[] }[] = []
  for (const o of opciones) {
    const ultimo = tramos.at(-1)
    if (ultimo && ultimo.grupo === o.grupo) ultimo.opciones.push(o)
    else tramos.push({ grupo: o.grupo, opciones: [o] })
  }
  return (
    <li className={cn(CLASE_CELDA, 'has-[select:active]:bg-white/[0.08] has-[select:focus-visible]:bg-white/[0.06] lg:has-[select:hover]:bg-white/[0.04]')}>
      {icono}
      <div className={CLASE_CUERPO}>
        <span className={cn(TEXTO_PRINCIPAL, 'min-w-0 flex-1 truncate')}>{etiqueta}</span>
        <span className="flex min-w-0 max-w-[60%] items-center gap-1 text-[17px] text-[var(--wa-text-2)] lg:text-[14px]">
          <span className="truncate">{actual}</span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0" />
        </span>
      </div>
      <select
        aria-label={etiqueta}
        value={valor}
        onChange={(e) => onCambio(e.target.value as T)}
        // 16 px: con menos, iOS agranda la pantalla al tocarlo.
        className="absolute inset-0 size-full cursor-pointer appearance-none bg-transparent text-[16px] text-transparent opacity-0 outline-none"
      >
        {tramos.map((t, i) =>
          t.grupo ? (
            <optgroup key={`${t.grupo}-${i}`} label={t.grupo}>
              {t.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
            </optgroup>
          ) : (
            t.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)
          ),
        )}
      </select>
    </li>
  )
}

/** El tilde verde de la derecha de una celda elegida. */
function TildeIos({ visible }: { visible: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn('size-[18px] shrink-0 self-center text-[var(--wa-accent)] lg:size-4', !visible && 'invisible')}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5l3.2 3.2L13 4.8" />
    </svg>
  )
}

/**
 * Una celda que se marca y se desmarca (o se elige, con `rol="radio"`): el
 * tilde de iOS a la derecha.
 */
export function CeldaMarcaIos({
  marcada,
  onCambio,
  icono,
  children,
  rol = 'checkbox',
  deshabilitada,
}: {
  marcada: boolean
  onCambio: () => void
  icono?: ReactNode
  children: ReactNode
  rol?: 'checkbox' | 'radio'
  deshabilitada?: boolean
}) {
  return (
    <li className={CLASE_CELDA}>
      {icono}
      <div className={CLASE_CUERPO_BOTON}>
        <button
          type="button"
          role={rol}
          aria-checked={marcada}
          onClick={onCambio}
          disabled={deshabilitada}
          className={cn(CLASE_BOTON_CELDA, 'disabled:opacity-50')}
        >
          {children}
        </button>
        <TildeIos visible={marcada} />
      </div>
    </li>
  )
}

/**
 * Una celda que es un botón de punta a punta, en verde (una acción, como
 * «Programar mensaje» en WhatsApp) o en rojo (borrar). Centrada, como los
 * botones sueltos de iOS.
 */
export function CeldaAccionIos({
  children,
  onClick,
  tono = 'acento',
  icono: Icono,
  centrada = false,
  deshabilitada,
}: {
  children: ReactNode
  onClick: () => void
  tono?: 'acento' | 'peligro'
  icono?: LucideIcon
  centrada?: boolean
  deshabilitada?: boolean
}) {
  return (
    <li className={CLASE_CELDA}>
      <div className={CLASE_CUERPO_BOTON}>
        <button
          type="button"
          onClick={onClick}
          disabled={deshabilitada}
          className={cn(
            CLASE_BOTON_CELDA,
            'flex-row items-center gap-3 text-[17px] lg:text-[14px] disabled:opacity-40',
            centrada && 'justify-center text-center',
            tono === 'peligro' ? 'text-[var(--wa-danger)]' : 'text-[var(--wa-accent)]',
          )}
        >
          {Icono && <Icono aria-hidden className="size-[22px] shrink-0 lg:size-[18px]" strokeWidth={2} />}
          {children}
        </button>
      </div>
    </li>
  )
}

/**
 * Una celda que lleva a otra pantalla, como las de la configuración de iOS: el
 * ícono de color, el nombre, el valor en gris a la derecha y el «›».
 */
export function CeldaNavegacionIos({
  icono,
  children,
  detalle,
  onClick,
}: {
  icono?: ReactNode
  children: ReactNode
  /** El valor de la derecha, en gris («Conectado»). */
  detalle?: ReactNode
  onClick: () => void
}) {
  return (
    <li className={CLASE_CELDA}>
      {icono}
      <div className={CLASE_CUERPO_BOTON}>
        <button type="button" onClick={onClick} className={cn(CLASE_BOTON_CELDA, 'flex-row items-center gap-2')}>
          <span className={cn(TEXTO_PRINCIPAL, 'min-w-0 flex-1 truncate')}>{children}</span>
          {detalle != null && detalle !== '' && (
            <span className="max-w-[55%] shrink-0 truncate text-[17px] text-[var(--wa-text-2)] lg:text-[14px]">{detalle}</span>
          )}
          <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-[var(--wa-text-3)] lg:size-4" strokeWidth={2.4} />
        </button>
      </div>
    </li>
  )
}

/**
 * Un campo con su nombre arriba, chico y gris, como los formularios de iOS con
 * datos largos (tokens, IDs). Con `secreto`, va oculto y el ojo lo muestra.
 */
export function CeldaCampoIos({
  etiqueta,
  valor,
  onCambio,
  placeholder,
  secreto = false,
  multilinea = false,
  filas = 4,
  inputMode,
  derecha,
}: {
  etiqueta: string
  valor: string
  onCambio: (valor: string) => void
  placeholder?: string
  secreto?: boolean
  multilinea?: boolean
  filas?: number
  inputMode?: 'text' | 'numeric' | 'url'
  /** Algo más a la derecha del campo (un botón de copiar). */
  derecha?: ReactNode
}) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  return (
    <li className={CLASE_CELDA}>
      <div className={cn(CLASE_CUERPO, 'flex-col items-stretch gap-0 pb-1 pt-2 lg:pb-1 lg:pt-1.5')}>
        <label htmlFor={id} className="text-[13px] leading-[18px] text-[var(--wa-text-2)] lg:text-[12px] lg:leading-4">
          {etiqueta}
        </label>
        <div className="flex min-w-0 items-center gap-1">
          {multilinea ? (
            <textarea
              id={id}
              rows={filas}
              value={valor}
              placeholder={placeholder}
              onChange={(e) => onCambio(e.target.value)}
              className={cn(CLASE_CAMPO_CELDA, 'h-auto resize-none py-2 leading-[22px] lg:h-auto lg:py-1.5 lg:leading-5')}
            />
          ) : (
            <input
              id={id}
              type={secreto && !visible ? 'password' : 'text'}
              inputMode={inputMode}
              value={valor}
              placeholder={placeholder}
              onChange={(e) => onCambio(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              className={CLASE_CAMPO_CELDA}
            />
          )}
          {secreto && (
            <BotonIconoIos
              etiqueta={visible ? `Ocultar ${etiqueta}` : `Mostrar ${etiqueta}`}
              icono={visible ? EyeOff : Eye}
              onClick={() => setVisible((v) => !v)}
              className="-mr-2.5 lg:-mr-1.5"
            />
          )}
          {derecha}
        </div>
      </div>
    </li>
  )
}

// ── Controles ────────────────────────────────────────────────────────────────

/**
 * El interruptor de iOS (51×31; en la compu, el de la Mac). El botón mide 44 de
 * alto: el riel va centrado adentro, así el dedo no tiene que apuntar.
 */
export function InterruptorIos({
  activo,
  onCambio,
  etiqueta,
  deshabilitado,
}: {
  activo: boolean
  onCambio: (activo: boolean) => void
  etiqueta: string
  deshabilitado?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      title={etiqueta}
      disabled={deshabilitado}
      onClick={() => onCambio(!activo)}
      className="group/interruptor relative z-10 flex h-11 w-[51px] shrink-0 items-center outline-none [-webkit-tap-highlight-color:transparent] disabled:opacity-50 lg:h-8 lg:w-[38px]"
    >
      <span
        className={cn(
          'relative h-[31px] w-[51px] rounded-full transition-colors duration-200 lg:h-[22px] lg:w-[38px]',
          'group-focus-visible/interruptor:ring-2 group-focus-visible/interruptor:ring-[var(--wa-accent)]/60 group-focus-visible/interruptor:ring-offset-2 group-focus-visible/interruptor:ring-offset-[var(--wa-raised)]',
          activo ? 'bg-[var(--wa-accent)]' : 'bg-[#3a3a3e] lg:bg-[#4a4b4d]',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.18),0_1px_1px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-out lg:size-[18px]',
            activo && 'translate-x-5 lg:translate-x-4',
          )}
        />
      </span>
    </button>
  )
}

/**
 * El control segmentado de iOS (dos o tres opciones excluyentes). Cada botón
 * mide 44 de alto; la píldora marcada va adentro, a 3 px del borde.
 */
export function SegmentadoIos<T extends string>({
  opciones,
  valor,
  onCambio,
  etiqueta,
  className,
}: {
  opciones: readonly { valor: T; texto: string; icono?: LucideIcon }[]
  valor: T
  onCambio: (valor: T) => void
  etiqueta: string
  className?: string
}) {
  return (
    <div role="group" aria-label={etiqueta} className={cn('flex rounded-[12px] bg-[rgba(118,118,128,0.24)] lg:rounded-lg lg:bg-[var(--wa-field)]', className)}>
      {opciones.map(({ valor: v, texto, icono: Icono }) => {
        const elegida = v === valor
        return (
          <button
            key={v}
            type="button"
            aria-pressed={elegida}
            onClick={() => onCambio(v)}
            className={cn(
              'group/segmento relative flex h-11 min-w-0 flex-1 items-center justify-center px-2 outline-none [-webkit-tap-highlight-color:transparent] lg:h-8',
              'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wa-accent)]/60 rounded-[12px] lg:rounded-lg',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'absolute inset-[3px] rounded-[9px] transition-colors duration-150 lg:inset-0.5 lg:rounded-md',
                // En la compu, más claro que el riel (--wa-field): con --wa-raised-2 eran el mismo gris.
                elegida ? 'bg-[#636366] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] lg:bg-[#56575a]' : 'group-active/segmento:bg-white/[0.06]',
              )}
            />
            <span className={cn('relative flex min-w-0 items-center gap-1.5 text-[15px] text-[var(--wa-text)] lg:text-[13px]', elegida ? 'font-semibold' : 'font-medium')}>
              {Icono && <Icono aria-hidden className="size-4 shrink-0" strokeWidth={2} />}
              <span className="truncate">{texto}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Un botón de ícono de 44 px (32 en la compu), con su nombre para el lector de pantalla. */
export function BotonIconoIos({
  etiqueta,
  icono: Icono,
  onClick,
  tono = 'neutro',
  deshabilitado,
  className,
}: {
  etiqueta: string
  icono: LucideIcon
  onClick: () => void
  tono?: 'neutro' | 'acento' | 'peligro'
  deshabilitado?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={onClick}
      disabled={deshabilitado}
      className={cn(
        'relative z-10 flex size-11 shrink-0 items-center justify-center rounded-full outline-none transition-colors duration-100 [-webkit-tap-highlight-color:transparent]',
        'active:bg-white/10 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:size-8 lg:enabled:hover:bg-white/[0.07]',
        tono === 'peligro' ? 'text-[var(--wa-danger)]' : tono === 'acento' ? 'text-[var(--wa-accent)]' : 'text-[var(--wa-text-2)]',
        className,
      )}
    >
      <Icono aria-hidden className="size-[22px] lg:size-[18px]" strokeWidth={1.9} />
    </button>
  )
}

/** Un botón de texto dentro de una celda («Enviar», «Contactar»): 44 de alto. */
export function BotonTextoCeldaIos({
  children,
  onClick,
  tono = 'acento',
  icono: Icono,
  deshabilitado,
  etiqueta,
}: {
  children: ReactNode
  onClick: () => void
  tono?: 'acento' | 'peligro' | 'neutro'
  icono?: LucideIcon
  deshabilitado?: boolean
  /** El nombre completo, si el texto solo no alcanza («Enviar Promo de invierno»). */
  etiqueta?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      aria-label={etiqueta}
      className={cn(
        'relative z-10 -ml-2.5 flex h-11 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[17px] font-medium outline-none transition-colors duration-100 [-webkit-tap-highlight-color:transparent]',
        'active:bg-white/10 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:-ml-2 lg:h-8 lg:px-2 lg:text-[13px] lg:enabled:hover:bg-white/[0.07]',
        tono === 'peligro' ? 'text-[var(--wa-danger)]' : tono === 'neutro' ? 'text-[var(--wa-text)]' : 'text-[var(--wa-accent)]',
      )}
    >
      {Icono && <Icono aria-hidden className="size-[18px] shrink-0 lg:size-4" strokeWidth={2} />}
      {children}
    </button>
  )
}

/** La píldora verde de un vacío («Nueva difusión»): la acción que falta para empezar. */
export function BotonPildoraIos({ children, onClick, icono: Icono }: { children: ReactNode; onClick: () => void; icono?: LucideIcon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--wa-accent)] px-5 text-[17px] font-semibold text-[var(--wa-on-accent)] outline-none transition-[background-color,scale] duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.98] active:bg-[var(--wa-accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wa-bg)] lg:h-9 lg:px-4 lg:text-[14px] lg:hover:bg-[var(--wa-accent-hover)]"
    >
      {Icono && <Icono aria-hidden className="size-5 lg:size-4" strokeWidth={2.4} />}
      {children}
    </button>
  )
}

// ── Estados ──────────────────────────────────────────────────────────────────

/** El vacío de una sección: el ícono en un círculo, el título y una línea. */
export function VacioIos({
  icono: Icono,
  titulo,
  texto,
  children,
}: {
  icono: LucideIcon
  titulo: string
  texto?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 pb-8 pt-14 text-center lg:pt-20">
      <span className="flex size-16 items-center justify-center rounded-full bg-[var(--wa-raised)] lg:size-14">
        <Icono aria-hidden className="size-7 text-[var(--wa-text-2)] lg:size-6" strokeWidth={1.8} />
      </span>
      <p className="mt-4 text-[17px] font-semibold text-[var(--wa-text)] lg:text-[15px]">{titulo}</p>
      {texto && (
        <p className="mt-1 max-w-xs text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[13px] lg:leading-[18px]">{texto}</p>
      )}
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}

/** Mientras carga la primera vez. */
export function CargandoIos({ texto }: { texto: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-2 py-16 text-[15px] text-[var(--wa-text-2)] lg:text-[13px]">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      {texto}
    </p>
  )
}

// ── Menús y confirmaciones ───────────────────────────────────────────────────

/**
 * Un menú desplegable como los de vidrio de iOS 26: translúcido, con
 * desenfoque y el canto claro. El tinte es oscuro al 72 %: aun encima de algo
 * blanco, el texto blanco queda arriba de 5:1. Va en un portal fuera de
 * .wa-scope: la clase va de nuevo acá para que los --wa-* resuelvan.
 */
export const CLASE_MENU_IOS = cn(
  'wa-scope min-w-[15.5rem] rounded-[22px] border-0 p-1.5 text-[var(--wa-text)]',
  'bg-[rgba(32,32,34,0.72)] backdrop-blur-[28px] backdrop-saturate-[1.8]',
  'shadow-[0_22px_60px_-14px_rgba(0,0,0,0.8),inset_0_0_0_0.5px_rgba(255,255,255,0.16),inset_0_1px_0_rgba(255,255,255,0.1)]',
  'lg:min-w-[13.5rem] lg:rounded-xl lg:p-1',
)

/** Un ítem de ese menú: 44 px en el celular, el ícono a la izquierda. */
export const CLASE_ITEM_MENU_IOS = cn(
  'h-11 gap-3 rounded-[14px] px-3 text-[17px] text-[var(--wa-text)] outline-none',
  'focus:bg-white/[0.12] focus:text-[var(--wa-text)] data-[variant=destructive]:text-[var(--wa-danger)] data-[variant=destructive]:focus:bg-white/[0.12] data-[variant=destructive]:focus:text-[var(--wa-danger)]',
  // Los íconos, del color del texto y de 20 px (el ítem de @/components/ui los
  // pone grises y de 16 con estos mismos selectores: así los reemplaza).
  "[&_svg:not([class*='size-'])]:size-5 [&_svg:not([class*='text-'])]:text-current data-[variant=destructive]:*:[svg]:text-[var(--wa-danger)]!",
  "lg:h-8 lg:rounded-md lg:px-2.5 lg:text-[13px] lg:[&_svg:not([class*='size-'])]:size-4",
)

/**
 * La confirmación de iOS 26 para lo que no se puede deshacer: el título, la
 * explicación y dos cápsulas (volver y la acción, en rojo). Es el AlertDialog de
 * @/components/ui (z-[110]; tocar afuera no la cierra).
 */
export function ConfirmacionIos({
  abierta,
  onAbiertaCambio,
  titulo,
  texto,
  accion,
  onConfirmar,
  volver = 'Volver',
}: {
  abierta: boolean
  onAbiertaCambio: (abierta: boolean) => void
  titulo: string
  texto: string
  /** El texto de la acción, en rojo («Cancelar difusión»). */
  accion: string
  onConfirmar: () => void
  volver?: string
}) {
  return (
    <AlertDialog open={abierta} onOpenChange={onAbiertaCambio}>
      <AlertDialogContent
        className={cn(
          'wa-scope w-[min(19rem,calc(100%-3rem))] gap-0 rounded-[28px] border-0 p-0 text-center text-[var(--wa-text)] sm:max-w-none',
          'bg-[rgba(36,36,38,0.92)] backdrop-blur-[28px] shadow-[0_24px_70px_-12px_rgba(0,0,0,0.85),inset_0_0_0_0.5px_rgba(255,255,255,0.14)]',
          'lg:w-[20rem] lg:rounded-2xl',
        )}
      >
        <div className="px-6 pb-4 pt-6">
          <AlertDialogTitle className="text-[17px] font-semibold leading-snug text-[var(--wa-text)] lg:text-[15px]">{titulo}</AlertDialogTitle>
          <AlertDialogDescription className="mt-1.5 text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[13px] lg:leading-[18px]">
            {texto}
          </AlertDialogDescription>
        </div>
        {/* Una arriba de la otra, como iOS cuando los textos no entran lado a
            lado: la acción primero y «Volver» abajo, en el lugar del pulgar.
            flex-1 sólo en la fila de la compu: en la columna, con flex-basis 0
            el alto de 48 lo ignoraba y quedaban de 25 px. */}
        <div className="flex flex-col gap-2 px-4 pb-4 lg:flex-row-reverse">
          <AlertDialogPrimitive.Action
            onClick={onConfirmar}
            className="flex h-12 min-w-0 shrink-0 items-center justify-center rounded-full lg:flex-1 bg-white/[0.12] px-3 text-[17px] font-semibold text-[var(--wa-danger)] outline-none transition-colors active:bg-white/20 focus-visible:ring-2 focus-visible:ring-[var(--wa-danger)]/60 lg:h-9 lg:text-[13px] lg:hover:bg-white/[0.16]"
          >
            {accion}
          </AlertDialogPrimitive.Action>
          <AlertDialogPrimitive.Cancel className="flex h-12 min-w-0 shrink-0 items-center justify-center rounded-full lg:flex-1 bg-white/[0.12] px-3 text-[17px] font-semibold text-[var(--wa-text)] outline-none transition-colors active:bg-white/20 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-9 lg:text-[13px] lg:hover:bg-white/[0.16]">
            {volver}
          </AlertDialogPrimitive.Cancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ── Errores de red ───────────────────────────────────────────────────────────

/**
 * Para los catch de las server actions de las secciones: si el bundle quedó
 * viejo después de un deploy, avisa y recarga (o pide recargar); si no, el
 * aviso de siempre. Ningún rechazo puede salir de una transición: en React 19
 * sube al error boundary y se lleva toda Mensajería.
 */
export function avisarFalla(e: unknown, texto: string) {
  if (esErrorDeVersion(e) && avisarYRecargarPorVersion()) return
  toast.error(esErrorDeVersion(e) ? TEXTO_RECARGA_MANUAL : texto)
}

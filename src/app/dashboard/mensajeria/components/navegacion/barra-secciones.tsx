'use client'

// La primera columna de Mensajería en la compu, como la barra lateral de
// WhatsApp para Mac: un riel de íconos con una etiqueta mínima y, cuando las
// columnas tienen lugar (contenedor de 1180 px o más), una lista con etiquetas
// y contadores a la derecha. Mide por el contenedor de las columnas
// (@container/columnas, en mensajeria-client.tsx) y no por la pantalla: el menú
// del dashboard ocupa 256 px y el modo foco los devuelve. Su ancho es
// --ancho-secciones, el mismo que usa la info. del contacto para ubicarse. En
// el celular no existe: ahí las secciones van en el menú "…" de la lista
// (menu-secciones.tsx).

import { Maximize2, Minimize2, Settings, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ITEMS_SECCIONES, contadorDe, numeroCorto,
  type ContadoresSecciones, type DestinoMensajeria,
} from './secciones'

type TonoContador = 'gris' | 'verde' | 'rojo' | 'naranja'

// Chats lleva el globo verde de WhatsApp en el riel y el número gris en la
// lista (como en la Mac); alertas y casos, pastillas de color en los dos.
const TONO_RIEL: Partial<Record<DestinoMensajeria, TonoContador>> = {
  chats: 'verde',
  alerts: 'rojo',
  casos: 'naranja',
}
const TONO_LISTA: Partial<Record<DestinoMensajeria, TonoContador>> = {
  chats: 'gris',
  alerts: 'rojo',
  casos: 'naranja',
  programados: 'gris',
}

const CLASE_GLOBO: Record<Exclude<TonoContador, 'gris'>, string> = {
  verde: 'bg-[var(--wa-accent)] text-[var(--wa-on-accent)]',
  rojo: 'bg-red-500 text-white',
  naranja: 'bg-orange-500 text-white',
}

export function BarraSecciones({
  activo,
  contadores,
  configAbierta,
  isFocusMode,
  onIr,
  onConfig,
  onToggleFoco,
}: {
  activo: DestinoMensajeria
  contadores: ContadoresSecciones
  configAbierta: boolean
  isFocusMode: boolean
  onIr: (destino: DestinoMensajeria) => void
  onConfig: () => void
  onToggleFoco: () => void
}) {
  return (
    <nav
      aria-label="Secciones de Mensajería"
      className="hidden w-[var(--ancho-secciones)] shrink-0 flex-col border-r border-[var(--wa-divider)] bg-[var(--wa-sidebar)] px-0.5 py-3 lg:flex @min-[1180px]/columnas:px-2.5"
    >
      <ul className="flex flex-col gap-1 @min-[1180px]/columnas:gap-0.5">
        {ITEMS_SECCIONES.map((item) => (
          <li key={item.destino} className="flex justify-center">
            <ItemBarra
              icono={item.icono}
              etiqueta={item.etiqueta}
              corta={item.corta}
              actual={item.destino === activo}
              contador={contadorDe(item.destino, contadores)}
              tonoRiel={TONO_RIEL[item.destino]}
              tonoLista={TONO_LISTA[item.destino]}
              onClick={() => onIr(item.destino)}
            />
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col items-center gap-1 border-t border-[var(--wa-divider)] pt-2 @min-[1180px]/columnas:items-stretch @min-[1180px]/columnas:gap-0.5">
        <ItemBarra
          icono={Settings}
          etiqueta="Configuración"
          corta="Ajustes"
          resaltado={configAbierta}
          onClick={onConfig}
        />
        <ItemBarra
          icono={isFocusMode ? Minimize2 : Maximize2}
          etiqueta={isFocusMode ? 'Salir de pantalla completa' : 'Pantalla completa'}
          corta={isFocusMode ? 'Reducir' : 'Ampliar'}
          presionado={isFocusMode}
          onClick={onToggleFoco}
        />
      </div>
    </nav>
  )
}

function ItemBarra({
  icono: Icono,
  etiqueta,
  corta,
  actual = false,
  presionado,
  resaltado = false,
  contador = 0,
  tonoRiel,
  tonoLista,
  onClick,
}: {
  icono: LucideIcon
  etiqueta: string
  corta: string
  /** La sección que se está viendo (aria-current). */
  actual?: boolean
  /** Para un interruptor (pantalla completa): aria-pressed. */
  presionado?: boolean
  /** Marcado sin ser la sección actual (la hoja de configuración abierta). */
  resaltado?: boolean
  contador?: number
  tonoRiel?: TonoContador
  tonoLista?: TonoContador
  onClick: () => void
}) {
  const marcado = actual || !!presionado || resaltado
  const conContador = contador > 0
  return (
    <button
      type="button"
      onClick={onClick}
      title={conContador ? `${etiqueta} · ${contador}` : etiqueta}
      aria-current={actual ? 'page' : undefined}
      aria-pressed={presionado}
      className={cn(
        'relative flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl outline-none transition-colors duration-150',
        // Riel: 68 px de ancho para que "Programados" entre entero a 10 px.
        'h-[52px] w-[68px]',
        '@min-[1180px]/columnas:h-10 @min-[1180px]/columnas:w-full @min-[1180px]/columnas:flex-row @min-[1180px]/columnas:justify-start @min-[1180px]/columnas:gap-3 @min-[1180px]/columnas:rounded-lg @min-[1180px]/columnas:px-3',
        'focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60',
        marcado
          ? 'bg-[var(--wa-selected)] text-white'
          : 'text-[var(--wa-text)]/80 hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)]',
      )}
    >
      <span className="relative flex shrink-0">
        <Icono aria-hidden className="size-[22px] @min-[1180px]/columnas:size-5" strokeWidth={marcado ? 2.2 : 1.8} />
        {conContador && tonoRiel && tonoRiel !== 'gris' && (
          <span
            aria-hidden
            className={cn(
              'absolute -right-3 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold leading-none tabular-nums ring-2 ring-[var(--wa-sidebar)] @min-[1180px]/columnas:hidden',
              CLASE_GLOBO[tonoRiel],
            )}
          >
            {numeroCorto(contador)}
          </span>
        )}
      </span>
      <span className="max-w-full truncate px-0.5 text-[10px] font-medium leading-none tracking-tight @min-[1180px]/columnas:hidden">{corta}</span>
      <span className="hidden min-w-0 flex-1 truncate text-left text-[14px] @min-[1180px]/columnas:block">{etiqueta}</span>
      {conContador && tonoLista && (
        <span
          aria-hidden
          className={cn(
            'hidden shrink-0 tabular-nums @min-[1180px]/columnas:inline-flex',
            tonoLista === 'gris'
              ? 'text-[13px] text-[var(--wa-text-2)]'
              : cn('h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11.5px] font-semibold leading-none', CLASE_GLOBO[tonoLista]),
          )}
        >
          {numeroCorto(contador)}
        </span>
      )}
      {conContador && <span className="sr-only">: {contador}</span>}
    </button>
  )
}

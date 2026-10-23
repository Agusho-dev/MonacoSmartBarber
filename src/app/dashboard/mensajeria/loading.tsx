import { cn } from '@/lib/utils'

// Esqueleto de Mensajería con la forma de la pantalla (23/oct/2026): en el
// celular, la lista de chats de WhatsApp para iOS sobre negro; en la compu, la
// columna de secciones, la lista y la conversación vacía, como WhatsApp para
// Mac, con los mismos anchos que mensajeria-client.tsx (medidos por el
// contenedor de las columnas, no por la pantalla). Va a sangre y con h-full:
// en esta ruta el <main> del shell no tiene padding (la cuenta vieja,
// 100dvh − 8.25rem, era la de ese padding).

function Hueso({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-[var(--wa-field)]', className)} />
}

const ANCHOS_NOMBRE = ['w-32', 'w-24', 'w-40', 'w-28', 'w-36', 'w-20', 'w-32', 'w-28', 'w-24']
const ANCHOS_VISTA = ['w-4/5', 'w-3/5', 'w-11/12', 'w-2/3', 'w-3/4', 'w-1/2', 'w-4/5', 'w-2/3', 'w-3/5']

export default function MensajeriaLoading() {
  return (
    <div
      role="status"
      aria-label="Cargando Mensajería"
      className="wa-scope flex h-full min-h-0 overflow-clip bg-[var(--wa-bg)] lg:@container/columnas"
    >
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1',
          '[--ancho-secciones:0px] lg:[--ancho-secciones:72px] lg:@min-[1180px]/columnas:[--ancho-secciones:220px]',
          'lg:[--ancho-lista:340px] lg:@min-[1000px]/columnas:[--ancho-lista:380px]',
        )}
      >
        {/* Columna de secciones: riel de íconos, o lista con etiquetas cuando hay lugar. */}
        <div className="hidden w-[var(--ancho-secciones)] shrink-0 flex-col gap-1 border-r border-[var(--wa-divider)] bg-[var(--wa-sidebar)] px-1 py-3 lg:flex @min-[1180px]/columnas:gap-0.5 @min-[1180px]/columnas:px-2.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex h-[52px] flex-col items-center justify-center gap-1.5 @min-[1180px]/columnas:h-10 @min-[1180px]/columnas:flex-row @min-[1180px]/columnas:justify-start @min-[1180px]/columnas:gap-3 @min-[1180px]/columnas:px-3"
            >
              <Hueso className="size-[22px] rounded-md @min-[1180px]/columnas:size-5" />
              <Hueso className="h-2 w-10 rounded-full @min-[1180px]/columnas:h-3 @min-[1180px]/columnas:w-24" />
            </div>
          ))}
        </div>

        {/* La lista */}
        <div className="flex min-w-0 flex-1 flex-col lg:w-[var(--ancho-lista)] lg:flex-none lg:shrink-0 lg:border-r lg:border-[var(--wa-divider)]">
          <div className="relative flex h-11 shrink-0 items-center px-4 lg:h-14 lg:px-3">
            <Hueso className="size-9 rounded-full lg:size-8" />
            <Hueso className="absolute left-1/2 hidden h-4 w-14 -translate-x-1/2 rounded-full lg:block" />
            <div className="ml-auto flex items-center gap-2.5">
              <Hueso className="size-9 rounded-full lg:hidden" />
              <Hueso className="size-9 rounded-full lg:size-8" />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-clip">
            {/* El título grande de iOS: sólo en el celular. */}
            <Hueso className="mx-4 mb-2.5 mt-1.5 h-8 w-28 rounded-lg lg:hidden" />
            <div className="px-4 pb-3 pt-1 lg:px-3 lg:pb-2.5 lg:pt-0.5">
              <Hueso className="h-10 w-full rounded-full lg:h-9" />
            </div>
            <div className="flex gap-2 px-4 pb-2.5 lg:px-3 lg:pb-2">
              {['w-16', 'w-28', 'w-24', 'w-32'].map((ancho) => (
                <Hueso key={ancho} className={cn('h-8 shrink-0 rounded-full lg:h-7', ancho)} />
              ))}
            </div>

            {ANCHOS_NOMBRE.map((nombre, i) => (
              <div key={i} className="flex items-stretch gap-3 pl-4 lg:mx-2 lg:pl-3">
                <Hueso className="size-13 shrink-0 self-center rounded-full lg:size-12" />
                <div className="flex min-h-[76px] min-w-0 flex-1 flex-col justify-center gap-2 border-b-[0.5px] border-[var(--wa-divider)] pr-4 lg:min-h-[68px] lg:pr-3">
                  <div className="flex items-center justify-between gap-3">
                    <Hueso className={cn('h-4 rounded-full', nombre)} />
                    <Hueso className="h-3 w-10 rounded-full" />
                  </div>
                  <Hueso className={cn('h-3 rounded-full', ANCHOS_VISTA[i])} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* La conversación vacía: sólo en la compu (en el celular la lista ocupa todo). */}
        <div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-[var(--wa-wallpaper-base)] lg:flex">
          <Hueso className="size-20 rounded-full" />
          <Hueso className="h-4 w-44 rounded-full" />
          <Hueso className="h-3 w-64 rounded-full" />
        </div>
      </div>
    </div>
  )
}

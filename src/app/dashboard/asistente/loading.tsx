import { EsqueletoHilo, EsqueletoHistorial } from './components/esqueleto'

// Mismo alto que la pantalla (ver asistente-client.tsx): el shell no le suma el
// padding inferior en esta ruta y el header mide 48 px en el celular y 56 en la compu.
export default function Loading() {
  return (
    <div className="-m-3 flex h-[calc(100dvh-3rem)] min-h-0 overflow-hidden lg:-m-6 lg:h-[calc(100dvh-3.5rem)]">
      <aside className="hidden w-[264px] shrink-0 border-r bg-sidebar/60 lg:block">
        <EsqueletoHistorial />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="hidden h-14 shrink-0 items-center gap-3 border-b px-6 lg:flex">
          <div className="asst-shimmer size-8 rounded-full" />
          <div className="asst-shimmer h-4 w-14 rounded" />
        </div>
        <div className="h-11 shrink-0 border-b lg:hidden" />
        <EsqueletoHilo />
      </section>
    </div>
  )
}

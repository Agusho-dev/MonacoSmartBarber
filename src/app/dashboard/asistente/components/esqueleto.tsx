// Esqueletos de la pantalla de Tex (loading.tsx y al abrir una conversación del
// historial). `asst-shimmer` ya respeta prefers-reduced-motion en globals.css.

export function EsqueletoHilo() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-hidden>
      <div className="mx-auto w-full max-w-[720px] flex-1 space-y-8 px-4 pt-8 lg:px-6">
        <div className="flex justify-end">
          <div className="asst-shimmer h-10 w-1/2 rounded-2xl" />
        </div>
        <div className="space-y-2.5">
          <div className="asst-shimmer h-3 w-16 rounded" />
          <div className="asst-shimmer h-9 w-full rounded-[14px]" />
          <div className="asst-shimmer h-4 w-11/12 rounded" />
          <div className="asst-shimmer h-4 w-4/5 rounded" />
          <div className="asst-shimmer h-4 w-2/3 rounded" />
        </div>
        <div className="flex justify-end">
          <div className="asst-shimmer h-10 w-2/5 rounded-2xl" />
        </div>
      </div>
      <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-5 lg:px-6 lg:pb-4">
        <div className="asst-shimmer mx-auto h-12 w-full max-w-[720px] rounded-[16px] lg:h-[52px]" />
        <div className="mx-auto mt-2 h-4 max-w-[720px]" />
      </div>
    </div>
  )
}

export function EsqueletoHistorial() {
  return (
    <div className="space-y-2 p-3" aria-hidden>
      <div className="asst-shimmer h-10 w-full rounded-lg" />
      <div className="asst-shimmer h-9 w-full rounded-lg" />
      <div className="space-y-1.5 pt-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="asst-shimmer h-10 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

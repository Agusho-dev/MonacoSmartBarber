// Esqueleto propio de Configurar Tex. Sin él, mientras carga se vería el de la
// pantalla de Tex (el loading.tsx del segmento padre también envuelve a este),
// que es de alto completo y no corresponde a una página que scrollea.
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-8 lg:space-y-6" aria-hidden>
      <div className="space-y-4">
        <div className="asst-shimmer h-5 w-28 rounded" />
        <div className="flex items-center gap-4">
          <div className="asst-shimmer size-[72px] rounded-2xl" />
          <div className="space-y-2">
            <div className="asst-shimmer h-6 w-44 rounded" />
            <div className="asst-shimmer h-4 w-64 rounded" />
          </div>
        </div>
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="asst-shimmer size-9 rounded-xl" />
            <div className="asst-shimmer h-4 w-40 rounded" />
          </div>
          <div className="asst-shimmer h-11 w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}

import { Skeleton } from '@/components/ui/skeleton'

// Skeleton para mensajería: sidebar de conversaciones + panel de chat
export default function MensajeriaLoading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sidebar de conversaciones */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col">
        {/* Buscador */}
        <div className="p-3 border-b border-border">
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
        {/* Lista de conversaciones */}
        <div className="flex-1 overflow-hidden divide-y divide-border">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5 min-w-0">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Panel de chat */}
      <div className="flex-1 flex flex-col">
        {/* Header del chat */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>

        {/* Burbújas de mensajes */}
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}
            >
              <Skeleton
                className={`h-10 rounded-2xl ${i % 2 === 0 ? 'w-56' : 'w-44'}`}
              />
            </div>
          ))}
        </div>

        {/* Input de mensaje */}
        <div className="p-3 border-t border-border flex items-center gap-2">
          <Skeleton className="flex-1 h-10 rounded-lg" />
          <Skeleton className="h-10 w-10 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

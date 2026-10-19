import { cn } from '@/lib/utils'

/**
 * Esqueleto de la pantalla de la fila, el mismo para el panel y su vista previa.
 *
 * Mide exactamente el alto que queda entre la banda del reloj y la barra de
 * secciones (`--alto-banda`, `--alto-nav` y el área segura de abajo): el
 * documento no scrollea y lo que scrollea es el contenido. Si el alto no
 * coincidiera, la página se correría sola y el contenido se metería debajo de
 * la banda.
 */
export function DisposicionFila({
  cabecera,
  avisos,
  children,
  onPointerDown,
}: {
  cabecera: React.ReactNode
  /** Bandas de turnos (próximo turno, tira de la agenda) entre la cabecera y la fila. */
  avisos?: React.ReactNode
  children: React.ReactNode
  onPointerDown?: () => void
}) {
  return (
    <div
      className="flex h-[calc(100dvh-var(--alto-banda)-var(--alto-nav)-env(safe-area-inset-bottom))] flex-col"
      onPointerDown={onPointerDown}
    >
      {cabecera}
      {avisos}
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  )
}

/**
 * La silla y el tarjetero. En vertical (lo normal en los puestos) van uno
 * arriba del otro y scrollean juntos: arriba de todo, cerca de la hora, lo que
 * pasa en la silla. Apaisada, lado a lado y cada uno con su scroll: la silla a
 * la izquierda, que es por donde empieza a leer el ojo.
 *
 * `bajoLaSilla` es contexto ("Cortando ahora"): en vertical cierra el tarjetero;
 * apaisada va debajo de la silla, que si no deja media columna vacía.
 */
export function ColumnasFila({
  silla,
  filas,
  bajoLaSilla,
  className,
}: {
  silla: React.ReactNode
  filas: React.ReactNode
  bajoLaSilla?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'h-full overflow-y-auto overscroll-contain lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:overflow-hidden',
        className,
      )}
    >
      <div className="px-4 pb-6 pt-1 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-8">
        {silla}
        {bajoLaSilla && <div className="mt-8 hidden lg:block">{bajoLaSilla}</div>}
      </div>
      <div className="space-y-7 px-4 pb-10 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pt-1">
        {filas}
        {bajoLaSilla && <div className="lg:hidden">{bajoLaSilla}</div>}
      </div>
    </div>
  )
}

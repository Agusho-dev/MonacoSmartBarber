import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Se dibuja adentro del menú del dashboard cuando una página llama a notFound()
// (un convenio borrado) o la dirección no existe ([...resto]/page.tsx: un
// enlace viejo del historial de Tex). Antes salía el 404 de Next sin menú, y en
// la app instalada, sin botón de atrás, no había forma de salir
// (src/lib/app-instalable.ts).
export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted">
        <SearchX className="size-8 text-muted-foreground" />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">No encontramos esta página</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Puede que lo que buscabas se haya borrado o que el enlace sea viejo.
        </p>
      </div>

      <Button asChild>
        <Link href="/dashboard">Volver al panel</Link>
      </Button>
    </div>
  )
}

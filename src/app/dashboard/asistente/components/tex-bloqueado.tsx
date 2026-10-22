// "Tex es parte de Enterprise": lo que ve una org sin `ai.enabled`, en la
// pantalla de Tex y en Configurar Tex. Componente de servidor (la pose es un
// componente de cliente y se hidrata sola).

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { TexPose } from '@/components/tex/tex-pose'

export function TexBloqueado() {
  return (
    <div className="flex min-h-[calc(100dvh-10rem)] items-center justify-center px-2 py-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <TexPose pose="ayuda" alto={120} halo prioridad />
        <h1 className="mt-6 text-xl font-semibold tracking-tight lg:text-2xl">Tex es parte de Enterprise</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Te contesta con los números reales de tu negocio, te arma informes y cada mañana te dice si cuadró la plata.
        </p>
        <Button className="mt-6 h-10" asChild>
          <Link href="/dashboard/billing">Ver planes</Link>
        </Button>
      </div>
    </div>
  )
}

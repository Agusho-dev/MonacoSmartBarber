import Link from "next/link"
import { getActiveOrganization } from "@/lib/actions/org"
import { OrgHomePage } from "@/components/home/org-home"
import { TenantSelector } from "@/components/home/tenant-selector"

/**
 * El pie legal de la portada.
 *
 * Esta pantalla es el hub INTERNO (check-in, panel del barbero, dashboard), no
 * la vidriera: el sitio donde de verdad se ofrece y se cobra el servicio es el
 * turnero (`/turnos/[slug]`), y ahí el botón de arrepentimiento va en el pie de
 * cada pantalla, que es lo que exige la Disposición 954/2025 ("a simple vista,
 * en lugar destacado, en el primer acceso"). Acá va igual, porque `/` es la
 * primera puerta del dominio y quien llega buscando el botón por la raíz tiene
 * que encontrarlo sin adivinar una ruta.
 */
function PieLegalPortada() {
  return (
    <footer className="border-t border-white/10 px-6 py-6">
      <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-xs text-muted-foreground">
        <Link href="/arrepentimiento" className="font-semibold uppercase tracking-wide hover:underline">
          Botón de arrepentimiento
        </Link>
        <Link href="/terminos" className="hover:underline">
          Términos y condiciones
        </Link>
        <Link href="/privacidad" className="hover:underline">
          Política de Privacidad
        </Link>
      </p>
    </footer>
  )
}

export default async function HomePage() {
  const org = await getActiveOrganization()

  if (org) {
    return (
      <>
        <OrgHomePage organization={org} />
        <PieLegalPortada />
      </>
    )
  }

  return (
    <>
      <TenantSelector />
      <PieLegalPortada />
    </>
  )
}

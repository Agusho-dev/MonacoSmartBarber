import Image from "next/image"
import Link from "next/link"
import { Scissors, Monitor, Users, BarChart3, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Organization {
  id: string
  name: string
  slug: string
  logo_url: string | null
}

export function OrgHomePage({ organization }: { organization: Organization }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-12 p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        {organization.logo_url ? (
          <Image
            src={organization.logo_url}
            alt={organization.name}
            width={64}
            height={64}
            className="size-16 rounded-full object-cover"
            priority
            unoptimized
          />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-full border border-white/10 bg-white/5">
            <Scissors className="size-7" />
          </div>
        )}
        <h1 className="text-4xl font-bold tracking-tight">
          {organization.name}
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Sistema inteligente de gestión para barberías
        </p>
      </div>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
        <Link href="/checkin" className="group">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-6 transition-colors group-hover:border-white/20 group-hover:bg-white/10">
            <Monitor className="size-8 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="font-medium">Check-in</span>
            <span className="text-xs text-muted-foreground">
              Tablet de entrada
            </span>
          </div>
        </Link>

        <Link href="/barbero/login" className="group">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-6 transition-colors group-hover:border-white/20 group-hover:bg-white/10">
            <Users className="size-8 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="font-medium">Barberos</span>
            <span className="text-xs text-muted-foreground">Panel de fila</span>
          </div>
        </Link>

        <Link href="/dashboard" className="group">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-6 transition-colors group-hover:border-white/20 group-hover:bg-white/10">
            <BarChart3 className="size-8 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="font-medium">Dashboard</span>
            <span className="text-xs text-muted-foreground">
              Administración
            </span>
          </div>
        </Link>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/login">Iniciar sesión</Link>
        </Button>
        <form action="/api/clear-org" method="POST">
          <Button variant="ghost" size="sm" type="submit" className="gap-1.5 text-muted-foreground">
            <LogOut className="size-3.5" />
            Cambiar barbería
          </Button>
        </form>
      </div>
    </div>
  )
}

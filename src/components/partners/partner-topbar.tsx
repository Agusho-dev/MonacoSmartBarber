'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Store, LogOut, QrCode, LayoutGrid, User, ChevronDown } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { logoutPartner } from '@/lib/actions/partner-portal'
import { cn } from '@/lib/utils'

interface Props {
  partner: {
    id: string
    businessName: string
    logoUrl: string | null
    contactEmail: string | null
  }
}

const NAV = [
  { href: '/partners/dashboard', label: 'Beneficios', icon: LayoutGrid },
  { href: '/partners/dashboard/validate', label: 'Validar código', icon: QrCode },
]

export function PartnerTopbar({ partner }: Props) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-30 bg-white/80 dark:bg-zinc-950/80 backdrop-blur border-b">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="h-14 flex items-center justify-between gap-4">
          <Link href="/partners/dashboard" className="flex items-center gap-2 font-semibold">
            <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Store className="size-4" />
            </div>
            <span className="hidden sm:inline">Portal Partners</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 h-9 px-2">
                <Avatar className="size-7">
                  {partner.logoUrl && <AvatarImage src={partner.logoUrl} alt={partner.businessName} />}
                  <AvatarFallback className="text-xs">
                    {partner.businessName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline text-sm font-medium max-w-[140px] truncate">
                  {partner.businessName}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {partner.contactEmail ?? partner.businessName}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/partners/dashboard/profile">
                  <User className="size-4 mr-2" />
                  Mi perfil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="md:hidden">
                <Link href="/partners/dashboard/validate">
                  <QrCode className="size-4 mr-2" />
                  Validar código
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <form action={logoutPartner}>
                <button type="submit" className="w-full">
                  <DropdownMenuItem className="text-red-600 focus:text-red-600">
                    <LogOut className="size-4 mr-2" />
                    Cerrar sesión
                  </DropdownMenuItem>
                </button>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

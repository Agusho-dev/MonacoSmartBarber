'use client'

// Lo que se ve cuando un turno no pudo terminar (el `error` de useChat: los
// errores antes del stream y el chunk 'error' a mitad de camino) y cuando Tex
// todavía no tiene clave. Pose `ayuda` y el texto exacto de la especificación.

import Link from 'next/link'
import { KeyRound, RotateCcw } from 'lucide-react'
import { leerErrorTex } from '@/lib/tex/contrato'
import { Button } from '@/components/ui/button'
import { TexPose } from '@/components/tex/tex-pose'
import { varianteDeError } from './logica'

export const RUTA_CONFIGURAR_TEX = '/dashboard/asistente/configuracion'

export function TexErrorTurno({
  error,
  puedeConfigurar,
  onReintentar,
  onNueva,
}: {
  error: unknown
  puedeConfigurar: boolean
  onReintentar: () => void
  onNueva?: () => void
}) {
  const { codigo, mensaje } = leerErrorTex(error)
  const { texto, accion } = varianteDeError(codigo, mensaje, puedeConfigurar)

  return (
    <div role="alert" className="flex items-start gap-3 rounded-[14px] border border-red-500/25 bg-red-500/[0.06] p-3">
      <TexPose pose="ayuda" alto={56} entrada="suave" />
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-sm leading-relaxed text-foreground">{texto}</p>
        {accion && (
          <div className="mt-2.5">
            {accion === 'reintentar' && (
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={onReintentar}>
                <RotateCcw className="size-3.5" aria-hidden />
                Reintentar
              </Button>
            )}
            {accion === 'configurar' && (
              <Button size="sm" variant="outline" className="h-9 gap-1.5" asChild>
                <Link href={RUTA_CONFIGURAR_TEX}>
                  <KeyRound className="size-3.5" aria-hidden />
                  Configurar Tex
                </Link>
              </Button>
            )}
            {accion === 'planes' && (
              <Button size="sm" variant="outline" className="h-9" asChild>
                <Link href="/dashboard/billing">Ver planes</Link>
              </Button>
            )}
            {accion === 'entrar' && (
              <Button size="sm" variant="outline" className="h-9" asChild>
                <Link href="/login">Entrar</Link>
              </Button>
            )}
            {accion === 'nueva' && onNueva && (
              <Button size="sm" variant="outline" className="h-9" onClick={onNueva}>
                Nueva conversación
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Tex sin clave de Anthropic: el estado vacío cambia por este aviso. */
export function TexSinClave({ puedeConfigurar, compacto = false }: { puedeConfigurar: boolean; compacto?: boolean }) {
  return (
    <div className="flex flex-col items-center px-2 py-6 text-center">
      <TexPose pose="ayuda" alto={compacto ? 88 : 120} halo prioridad />
      <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-foreground">
        {puedeConfigurar
          ? 'Para que Tex funcione falta conectar la clave de Anthropic. Se hace una sola vez.'
          : 'Tex no está disponible ahora. Avisale al dueño.'}
      </p>
      {puedeConfigurar && (
        <Button className="mt-5 h-10 gap-2" asChild>
          <Link href={RUTA_CONFIGURAR_TEX}>
            <KeyRound className="size-4" aria-hidden />
            Configurar Tex
          </Link>
        </Button>
      )}
    </div>
  )
}

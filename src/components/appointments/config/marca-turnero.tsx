'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Palette, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export interface ValoresMarca {
  primario: string
  fondo: string
  texto: string
  bienvenida: string
}

interface Props {
  valores: ValoresMarca
  onCambiar: (cambio: Partial<ValoresMarca>) => void
  org: { nombre: string; slug: string; logoUrl: string | null }
  /** Nombres reales de sucursal para que la maqueta se parezca a lo que sale. */
  sucursales: string[]
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function seguro(valor: string, porDefecto: string): string {
  const v = valor.trim()
  return HEX.test(v) ? v : porDefecto
}

/**
 * Colores del turnero público. Antes vivía en /dashboard/turnos/personalizacion:
 * era una pantalla aparte para dos campos, y el dueño tenía que adivinar en cuál
 * de las dos estaba cada cosa.
 */
export function MarcaTurnero({ valores, onCambiar, org, sucursales }: Props) {
  const primario = seguro(valores.primario, '#0f172a')
  const fondo = seguro(valores.fondo, '#ffffff')
  const texto = seguro(valores.texto, '#0f172a')
  const largoBienvenida = valores.bienvenida.length

  return (
    <Card id="seccion-marca" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-4" />
          Cómo se ve el turnero
        </CardTitle>
        <CardDescription>
          Los colores y el saludo de la página donde el cliente reserva.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <CampoColor
                etiqueta="Botones y acentos"
                valor={valores.primario}
                onChange={v => onCambiar({ primario: v })}
              />
              <CampoColor etiqueta="Fondo" valor={valores.fondo} onChange={v => onCambiar({ fondo: v })} />
              <CampoColor etiqueta="Texto" valor={valores.texto} onChange={v => onCambiar({ texto: v })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mensaje-bienvenida">Saludo de bienvenida (opcional)</Label>
              <Textarea
                id="mensaje-bienvenida"
                value={valores.bienvenida}
                onChange={e => onCambiar({ bienvenida: e.target.value })}
                placeholder="Ej: Reservá tu turno en 30 segundos. Si no encontrás horario, escribinos."
                rows={3}
                maxLength={240}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Aparece debajo del nombre del negocio.</p>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    largoBienvenida > 220 ? 'text-amber-500' : 'text-muted-foreground'
                  )}
                >
                  {largoBienvenida}/240
                </span>
              </div>
            </div>

            {!org.logoUrl && (
              <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500" />
                <p className="text-muted-foreground">
                  No tenés logo cargado: el turnero muestra un círculo vacío.{' '}
                  <Link
                    href="/dashboard/configuracion"
                    className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                  >
                    Subir logo
                    <ExternalLink className="ml-1 inline size-3" />
                  </Link>
                </p>
              </div>
            )}
          </div>

          {/* Maqueta del turnero */}
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-full max-w-[18rem] overflow-hidden rounded-[1.75rem] border-[3px] border-border shadow-2xl"
              style={{ backgroundColor: fondo }}
            >
              <div
                className="flex items-center justify-between px-5 py-2 text-[10px] font-medium"
                style={{ backgroundColor: primario, color: fondo }}
              >
                <span>9:41</span>
                <span>100%</span>
              </div>
              <div className="mx-auto -mt-px h-4 w-20 rounded-b-xl" style={{ backgroundColor: primario }} />

              <div className="px-6 pb-7 pt-5 text-center" style={{ color: texto }}>
                {org.logoUrl ? (
                  <Image
                    src={org.logoUrl}
                    alt=""
                    width={56}
                    height={56}
                    className="mx-auto mb-3 size-14 rounded-full object-cover shadow-md"
                    unoptimized
                  />
                ) : (
                  <div
                    className="mx-auto mb-3 size-14 rounded-full"
                    style={{ backgroundColor: primario, opacity: 0.15 }}
                  />
                )}

                <p className="text-base font-bold">{org.nombre || 'Tu barbería'}</p>
                <p className="mt-0.5 text-xs" style={{ opacity: 0.6 }}>
                  Reservá tu turno
                </p>

                {valores.bienvenida.trim() && (
                  <p className="mx-auto mt-2.5 text-[11px] leading-relaxed" style={{ opacity: 0.8 }}>
                    {valores.bienvenida}
                  </p>
                )}

                <div className="mt-5 space-y-2">
                  {(sucursales.length ? sucursales.slice(0, 2) : ['Sucursal Centro']).map((nombre, i) => (
                    <div
                      key={nombre}
                      className="w-full rounded-xl px-4 py-2.5 text-xs font-semibold"
                      style={
                        i === 0
                          ? { backgroundColor: primario, color: fondo }
                          : { border: `1px solid ${primario}`, color: primario }
                      }
                    >
                      {nombre}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-center text-[11px] text-muted-foreground">
              Así se ve <code className="font-mono">/turnos/{org.slug || 'tu-negocio'}</code>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CampoColor({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string
  valor: string
  onChange: (valor: string) => void
}) {
  const valido = HEX.test(valor)

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{etiqueta}</Label>
      <div className="flex items-center gap-2">
        <div className="relative size-9 shrink-0 overflow-hidden rounded-lg border border-border shadow-sm">
          <div className="size-full" style={{ backgroundColor: valido ? valor : '#000000' }} />
          <input
            type="color"
            value={valido ? valor : '#000000'}
            onChange={e => onChange(e.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label={etiqueta}
          />
        </div>
        <Input
          value={valor}
          onChange={e => onChange(e.target.value)}
          className={cn('h-9 font-mono text-xs', !valido && 'border-amber-500/60')}
          maxLength={7}
          placeholder="#000000"
        />
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import type { Metadata, Viewport } from 'next'
import { Eye, KeyRound, ShieldCheck, Undo2, UserRound } from 'lucide-react'
import { TexPose } from '@/components/tex/tex-pose'
import { leerLinkPublico } from '@/lib/conciliacion-mp/links'
import { vencimientoAR } from '@/app/dashboard/conciliacion/components/formato'
import { AvisoTitular, MarcoTitular } from '../marco-titular'
import { ContinuarAMercadoPago } from './continuar'
import { MarcarAbierto } from './marcar-abierto'

// /conectar-mp/[token] — la página que abre el TITULAR de una cuenta de cobro
// (un barbero) desde el link que le mandaron por WhatsApp, para autorizar que el
// sistema lea los cobros que entran a su cuenta de Mercado Pago.
//
// Pública y de un uso: lo que autoriza es el link vigente (72 h). Honestidad
// ante todo: dice qué se va a ver (también los ingresos personales, si usa la
// cuenta para eso) y NO promete que "no se puede mover plata", porque los
// permisos de Mercado Pago no lo garantizan.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Autorizar tu cuenta de Mercado Pago',
  description: 'Autorizá que el sistema lea los cobros que entran a tu cuenta.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
}

type Params = Promise<{ token: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** El token es base64url de 32 bytes: lo demás ni se busca. */
const RE_TOKEN = /^[A-Za-z0-9_-]{20,128}$/

export default async function ConectarMpPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { token } = await params
  const sp = await searchParams
  const link = RE_TOKEN.test(token) ? await leerLinkPublico(token) : null

  if (!link) {
    return <AvisoTitular pose="ayuda" titulo="Este link no existe o venció." texto="Pedile uno nuevo a quien te lo mandó." />
  }

  const nombre = link.titularNombre?.trim() || null
  const alias = link.alias ?? 'tu cuenta'

  if (link.estado === 'conectada') {
    // Volviendo de Mercado Pago (`?listo=1`) es la confirmación; si no, alguien abrió un link ya usado.
    return sp.listo === '1' ? (
      <AvisoTitular pose="logro" titulo={`Listo${nombre ? `, ${nombre}` : ''}. Ya quedó conectada.`} texto="Podés cerrar esta página." />
    ) : (
      <AvisoTitular pose="ayuda" titulo="Esta cuenta ya quedó conectada." texto="No tenés que hacer nada más. Podés cerrar esta página." />
    )
  }
  if (link.estado === 'vencido') {
    return <AvisoTitular pose="ayuda" titulo="Este link venció." texto="Pedile uno nuevo a quien te lo mandó." />
  }
  if (link.estado === 'anulado') {
    return <AvisoTitular pose="ayuda" titulo="Este link ya no sirve." texto="Pedile uno nuevo a quien te lo mandó." />
  }

  const org = link.orgNombre
  const vence = vencimientoAR(link.venceEn)

  return (
    <MarcoTitular>
      {/* "Link abierto" lo marca el navegador al hidratar, no este GET (una vista previa de WhatsApp también lo pide). */}
      {link.estado === 'pendiente' && <MarcarAbierto token={token} />}
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex flex-col items-start gap-4">
          <TexPose pose="saludo" alto={96} prioridad />
          <h1 className="text-[26px] leading-tight font-semibold text-zinc-900">Hola{nombre ? `, ${nombre}` : ''}.</h1>
          <p className="w-full rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-700">
            Cuenta: <span className="font-mono font-semibold text-zinc-900">{alias}</span> · {org}
          </p>
          <p className="text-[15px] leading-relaxed text-zinc-700">
            {org} te pide permiso para ver los cobros que entran a tu cuenta de Mercado Pago. Así el sistema controla solo cada
            transferencia y nadie te tiene que pedir capturas.
          </p>
        </div>

        <ul className="space-y-3 text-[15px] leading-snug text-zinc-700">
          <Punto icono={Eye}>
            <strong className="font-semibold text-zinc-900">Qué va a ver:</strong> los ingresos (monto, fecha y quién transfirió).
          </Punto>
          <Punto icono={UserRound}>Si usás esta cuenta para cosas personales, esos ingresos también se ven.</Punto>
          <Punto icono={KeyRound}>Nunca te vamos a pedir tu contraseña: eso lo hacés en Mercado Pago.</Punto>
          <Punto icono={Undo2}>Podés quitar el permiso cuando quieras desde Mercado Pago.</Punto>
          <Punto icono={ShieldCheck}>{org} usa este permiso sólo para leer los cobros.</Punto>
        </ul>

        <div className="mt-auto space-y-3 pt-2">
          {link.oauthDisponible ? (
            <ContinuarAMercadoPago token={token} habilitado />
          ) : (
            <>
              <ContinuarAMercadoPago token={token} habilitado={false} />
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Todavía no se puede autorizar desde acá. Avisale a quien te mandó el link.
              </p>
            </>
          )}
          <p className="text-center text-sm text-zinc-600">
            Entrá con la cuenta de <span className="font-mono font-semibold text-zinc-900">{alias}</span> y tocá Autorizar.
          </p>
        </div>

        <footer className="space-y-1 border-t border-zinc-200 pt-4 text-center text-xs text-zinc-500">
          {vence && <p>Este link es sólo para vos y vence el {vence}.</p>}
          <p>¿No esperabas este link? No toques nada.</p>
        </footer>
      </div>
    </MarcoTitular>
  )
}

function Punto({ icono: Icono, children }: { icono: typeof Eye; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-700">
        <Icono className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 pt-0.5">{children}</span>
    </li>
  )
}

import Link from 'next/link'
import { FileText, Lock, Undo2 } from 'lucide-react'

/**
 * El pie legal del turnero público.
 *
 * Existe por una obligación concreta, no por prolijidad: la **Disposición
 * 954/2025** (BO 4/9/2025, que reemplazó a la Res. 424/2020 —derogada—) exige
 * que todo sitio que venda a distancia publique un link rotulado "BOTÓN DE
 * ARREPENTIMIENTO" **a simple vista, en lugar destacado y en el primer acceso**,
 * sin exigir registro previo. Por eso el botón no está escondido detrás de un
 * menú ni dentro de los términos: va en el pie de cada pantalla del turnero,
 * con borde propio y su nombre exacto.
 *
 * Los otros dos links son los de siempre (términos y privacidad) y van
 * deliberadamente más chicos: el que la ley pide destacado es uno solo.
 *
 * `sucursal` viaja como `?suc=` para que `/arrepentimiento` sepa de qué negocio
 * viene el reclamo sin preguntárselo a quien lo está haciendo. Es un dato que
 * ya tenemos: pedírselo al cliente sería trabajo suyo por comodidad nuestra.
 */
export function PieLegal({ sucursal }: { sucursal?: string | null }) {
  const arrepentimiento = sucursal
    ? `/arrepentimiento?suc=${encodeURIComponent(sucursal)}`
    : '/arrepentimiento'

  return (
    <footer
      className="border-t px-4 py-6"
      style={{ borderColor: 'var(--t-glass-border)' }}
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
        <Link
          href={arrepentimiento}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-[13px] font-bold uppercase tracking-wide"
          style={{
            borderColor: 'var(--t-glass-border-strong)',
            backgroundColor: 'var(--t-glass-bg)',
            color: 'var(--t-text)',
          }}
        >
          <Undo2 className="h-4 w-4" />
          Botón de arrepentimiento
        </Link>

        <p className="text-[11px] leading-relaxed text-[var(--t-text-muted)]">
          Si reservaste con seña, tenés 10 días corridos para arrepentirte y pedir
          la devolución total, sin explicar por qué.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px]">
          <Link
            href="/terminos"
            className="flex items-center gap-1.5 text-[var(--t-text-muted)] underline underline-offset-2"
          >
            <FileText className="h-3 w-3" />
            Términos y condiciones
          </Link>
          <Link
            href="/privacidad"
            className="flex items-center gap-1.5 text-[var(--t-text-muted)] underline underline-offset-2"
          >
            <Lock className="h-3 w-3" />
            Privacidad
          </Link>
        </div>
      </div>
    </footer>
  )
}

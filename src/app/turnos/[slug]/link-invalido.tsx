import { SearchX } from 'lucide-react'

/**
 * Pantalla para un slug de /turnos que no resuelve ni a sucursal ni a
 * organización. Reemplaza al 404 crudo de Next: el visitante llegó acá desde
 * un QR impreso o un link compartido, así que merece un mensaje que explique
 * qué pasó en vez de "This page could not be found".
 *
 * No revelamos qué organizaciones existen: sería un enumeration leak entre
 * tenants.
 */
export function LinkInvalido({ slug }: { slug: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-black/5 bg-white p-8 text-center shadow-lg">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <SearchX className="h-7 w-7 text-slate-400" />
        </div>

        <h1 className="mb-2 text-xl font-bold text-slate-900">
          No encontramos esta página de turnos
        </h1>

        <p className="text-sm leading-relaxed text-slate-500">
          El link{' '}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-700">
            /turnos/{slug}
          </span>{' '}
          no corresponde a ninguna barbería activa.
        </p>

        <div className="mt-6 space-y-2 rounded-xl bg-slate-50 p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Qué podés hacer
          </p>
          <ul className="space-y-1.5 text-sm text-slate-600">
            <li>Revisá que el link esté completo y sin espacios.</li>
            <li>Si lo escaneaste de un QR, volvé a escanearlo.</li>
            <li>Pedile el link actualizado a la barbería.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

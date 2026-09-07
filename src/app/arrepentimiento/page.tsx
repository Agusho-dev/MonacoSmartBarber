import Link from 'next/link'
import { Undo2 } from 'lucide-react'
import { FormularioArrepentimiento } from './formulario'

export const metadata = {
  title: 'Botón de arrepentimiento — Monaco Barber Studio',
  description:
    'Pedí la devolución total de tu seña dentro de los 10 días corridos, sin explicar por qué. Sin cuenta y sin registro previo.',
}

export const dynamic = 'force-dynamic'

/**
 * /arrepentimiento — el "BOTÓN DE ARREPENTIMIENTO" que exige la Disposición
 * 954/2025 (BO 4/9/2025, que reemplazó a la Res. 424/2020, derogada).
 *
 * Lo que la norma pide y acá se cumple, punto por punto:
 *  · link "a simple vista, en lugar destacado" y accesible desde el primer
 *    acceso → está en el pie de todas las pantallas del turnero, arriba de los
 *    términos y en el link de gestión del turno;
 *  · sin exigir registro previo → el formulario no pide cuenta ni sesión;
 *  · un código de identificación → se muestra en pantalla al enviar;
 *  · respuesta al consumidor dentro de las 24 horas por el mismo medio → se
 *    promete acá y la alerta que llega al dashboard lleva el vencimiento escrito.
 *
 * La página va en blanco y negro, como /terminos y /privacidad, y no con el
 * tema de marca del turnero: es una superficie legal que tiene que ser legible
 * en cualquier contexto, incluida una captura de pantalla que alguien adjunte a
 * un reclamo.
 */
export default async function ArrepentimientoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const crudo = sp.suc
  const valor = Array.isArray(crudo) ? crudo[0] : crudo
  const sucursal = valor ? valor.slice(0, 100).trim() : null

  const companyName = 'Monaco Barber Studio'
  const contactEmail = 'ignacio.baldovino@hotmail.com'

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <div className="mx-auto max-w-2xl px-6 py-14">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-gray-900 text-white">
          <Undo2 className="size-6" />
        </span>

        <h1 className="mt-5 text-3xl font-bold tracking-tight text-gray-900">
          Botón de arrepentimiento
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-gray-600">
          Si reservaste un turno con seña desde la app o desde la web, tenés{' '}
          <strong className="text-gray-900">10 días corridos</strong> desde el pago para
          arrepentirte y que te devolvamos <strong className="text-gray-900">todo</strong> lo que
          pagaste. No hace falta que expliques por qué, ni que tengas cuenta, ni que hables con
          nadie.
        </p>

        <div className="mt-8 rounded-2xl bg-gray-100 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">Cómo funciona</h2>
          <ol className="mt-3 space-y-2.5 text-[15px] leading-relaxed text-gray-600">
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                1
              </span>
              Completá el formulario de acá abajo. Con tu nombre y tu teléfono alcanza.
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                2
              </span>
              Te damos un código de identificación en pantalla. Guardalo.
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                3
              </span>
              Te respondemos por WhatsApp dentro de las 24 horas y hacemos la devolución por el
              mismo medio con el que pagaste.
            </li>
          </ol>
        </div>

        <div className="mt-10">
          <FormularioArrepentimiento sucursal={sucursal} contactEmail={contactEmail} />
        </div>

        <div className="mt-12 border-t pt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">
            Qué dice la ley
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
            Cuando comprás o contratás a distancia —por internet, por una app o por teléfono— el
            Código Civil y Comercial te da diez días corridos para revocar la operación sin costo y
            sin dar motivos (arts. 1110 a 1116), y la Ley 24.240 de Defensa del Consumidor lo
            repite en su art. 34. Es un derecho{' '}
            <strong className="text-gray-900">irrenunciable</strong>: ninguna condición nuestra
            puede limitarlo ni ponerle requisitos, y la Disposición 377/2026 declara abusiva
            cualquier cláusula que lo intente. Si nos avisaste dentro del plazo, la política de
            cancelación de la sucursal no se aplica: la devolución es total.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
            El derecho cubre el servicio que todavía no recibiste. Si ya te atendimos, el servicio
            se prestó y no hay nada que revocar.
          </p>
        </div>

        <div className="mt-10 border-t pt-8">
          <p className="text-sm leading-relaxed text-gray-500">
            {companyName} · Córdoba, Argentina ·{' '}
            <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline">
              {contactEmail}
            </a>
          </p>
          <p className="mt-2 text-sm text-gray-400">
            <Link href="/terminos" className="hover:underline">
              Términos y condiciones
            </Link>
            {' · '}
            <Link href="/privacidad" className="hover:underline">
              Política de Privacidad
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

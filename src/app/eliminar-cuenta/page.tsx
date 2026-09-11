import type { Metadata } from 'next'
import Link from 'next/link'
import { Mail, MessageCircle, Smartphone, Trash2 } from 'lucide-react'
import { MONACO, mailto, whatsapp } from '@/app/soporte/contacto'

export const metadata: Metadata = {
  title: 'Eliminar tu cuenta de Monaco — Monaco Barber Studio',
  description:
    'Cómo eliminar tu cuenta de la app Monaco de Monaco Barber Studio: desde la app en dos toques o pidiéndolo por email o WhatsApp si ya la desinstalaste. Qué se borra y qué se conserva.',
  robots: { index: true, follow: true },
}

/**
 * /eliminar-cuenta — el recurso web de borrado de cuenta que exige Google Play
 * ("Account deletion", Data safety) y que Apple espera ver explicado (5.1.1(v)).
 *
 * Lo que la política de Play pide y acá se cumple:
 *  · el pedido de borrado "prominently featured and easily discoverable": es
 *    el título y el primer bloque de la página, no una sección al pie;
 *  · nombra la app y el desarrollador como en la ficha ("Monaco" /
 *    "Monaco Barber Studio");
 *  · explica los pasos, qué datos se borran y cuáles se retienen y por qué;
 *  · funciona sin la app instalada: el camino B es un mailto con asunto
 *    prellenado y un link de WhatsApp con el mensaje armado. No es un
 *    formulario a propósito: el borrado exige verificar que quien pide es el
 *    dueño del teléfono, y eso se hace por el mismo WhatsApp, no con un campo
 *    de texto que cualquiera puede completar con el número de otro.
 *
 * Lo que dice de "qué se borra" y "qué queda" sale del cuerpo de la RPC
 * `delete_client_account` que fija la migración 215 (no del diálogo de la app,
 * que enumera cuatro ítems): visitas, entradas de fila y señas quedan con
 * `client_id = NULL`; turnos, reseñas, conversaciones e identidades sociales se
 * borran; y una seña `pagada` sin resolver ABORTA el borrado con
 * `deposit_pending` — de ahí el bloque de arriba, que es la única razón por la
 * que el botón de la app puede negarse.
 *
 * Mismo estilo que /arrepentimiento: blanco y negro, legible en una captura.
 */
export default function EliminarCuentaPage() {
  const { appName, companyName, city, email, whatsappDisplay } = MONACO

  const asuntoMail = `Eliminar mi cuenta de ${appName}`
  const cuerpoMail = [
    'Hola, quiero eliminar mi cuenta de la app Monaco.',
    '',
    'Nombre: ',
    'Teléfono con el que me registré: ',
    '',
    'Entiendo que la eliminación es definitiva.',
  ].join('\n')
  const mensajeWa = `Hola, quiero eliminar mi cuenta de la app ${appName}. Mi nombre es ____ y mi teléfono es ____.`

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <div className="mx-auto max-w-2xl px-6 py-14">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-gray-900 text-white">
          <Trash2 className="size-6" />
        </span>

        <h1 className="mt-5 text-3xl font-bold tracking-tight text-gray-900">
          Eliminar tu cuenta de {appName}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          App: <strong className="text-gray-700">{appName}</strong> · Desarrollador:{' '}
          <strong className="text-gray-700">{companyName}</strong> · {city}
        </p>
        <p className="mt-4 text-lg leading-relaxed text-gray-600">
          Podés eliminar tu cuenta cuando quieras, sin dar explicaciones. Hay dos caminos: desde la app, que es
          inmediato, o escribiéndonos si ya no la tenés instalada. En los dos casos el borrado es{' '}
          <strong className="text-gray-900">definitivo</strong>: no se puede deshacer y los puntos y premios no se
          recuperan.
        </p>

        {/* Precondición, no letra chica: el borrado se RECHAZA mientras haya
            una seña `pagada` sin resolver (`delete_client_account` corta con
            `deposit_pending`). Va antes de los pasos porque es lo que explica
            el único caso en que el botón de la app no funciona. */}
        <div className="mt-6 rounded-2xl border-2 border-gray-900 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">
            Si tenés una seña pagada, primero resolvela
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
            Si pagaste la seña de un turno que todavía no ocurrió,{' '}
            <strong className="text-gray-900">no eliminamos la cuenta hasta resolverla</strong>: es plata tuya y, sin
            cuenta, no tendríamos a quién devolvérsela. Cancelá primero ese turno desde la app —o pedí la devolución
            total con el{' '}
            <Link href="/arrepentimiento" className="text-blue-600 hover:underline">
              Botón de arrepentimiento
            </Link>
            , si pagaste hace menos de 10 días corridos— y después borrá la cuenta. Si no podés, escribinos y lo
            resolvemos nosotros.
          </p>
        </div>

        {/* ── Camino A: en la app ─────────────────────────────────────── */}
        <div className="mt-8 rounded-2xl border-2 border-gray-900 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-gray-900">
            <Smartphone className="size-4" />
            Desde la app (inmediato)
          </h2>
          <ol className="mt-3 space-y-2.5 text-[15px] leading-relaxed text-gray-600">
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                1
              </span>
              <span>
                Abrí la app {appName} y entrá a <strong className="text-gray-900">Perfil</strong> (el último ícono
                de la barra de abajo).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                2
              </span>
              <span>
                Bajá hasta el final y tocá <strong className="text-gray-900">Eliminar mi cuenta</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                3
              </span>
              <span>
                Marcá &ldquo;Entiendo que esta acción no se puede deshacer&rdquo; y confirmá con{' '}
                <strong className="text-gray-900">Eliminar</strong>. La cuenta se borra en el momento y la app vuelve a
                la pantalla de bienvenida.
              </span>
            </li>
          </ol>
        </div>

        {/* ── Camino B: sin la app ────────────────────────────────────── */}
        <div className="mt-6 rounded-2xl bg-gray-100 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">
            Si ya desinstalaste la app o no podés entrar
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
            Pedilo por cualquiera de estos dos medios con tu nombre y el teléfono con el que te registraste. Para
            confirmar que el pedido es tuyo te mandamos un código por WhatsApp a ese número; con tu respuesta
            eliminamos la cuenta y te lo confirmamos por el mismo medio, en un plazo máximo de{' '}
            <strong className="text-gray-900">5 días hábiles</strong> (art. 16 de la Ley 25.326).
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <a
              href={mailto(asuntoMail, cuerpoMail)}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 text-base font-bold text-white"
            >
              <Mail className="size-4" />
              Pedirlo por email
            </a>
            <a
              href={whatsapp(mensajeWa)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-gray-900 px-4 text-base font-bold text-gray-900"
            >
              <MessageCircle className="size-4" />
              Pedirlo por WhatsApp
            </a>
          </div>
          <p className="mt-3 text-center text-sm text-gray-500">
            {email} · WhatsApp {whatsappDisplay}
            <br />
            El email sale con el asunto &ldquo;{asuntoMail}&rdquo; ya escrito.
          </p>
        </div>

        {/* ── Qué se borra ────────────────────────────────────────────── */}
        <div className="mt-12 border-t pt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">Qué se borra</h2>
          <ul className="mt-3 list-disc list-inside space-y-2 text-[15px] leading-relaxed text-gray-600">
            {/* delete_client_account: DELETE clients + auth.users (edge fn) */}
            <li>Tu usuario de acceso, tu nombre, tu teléfono y tu email.</li>
            {/* client_social_identities ON DELETE CASCADE */}
            <li>La vinculación con tu cuenta de Google o de Apple, si entraste con alguna de ellas.</li>
            {/* client_device_tokens, client_notifications, client_notification_preferences, push_outbox */}
            <li>Tus dispositivos registrados, el token de notificaciones, la bandeja y tus preferencias de avisos.</li>
            {/* client_loyalty_state, point_transactions, client_rewards, partner_benefit_redemptions */}
            <li>Tu categoría, tus puntos, tus premios, los códigos de beneficios y tu código de invitación.</li>
            {/* appointments DELETE + scheduled_messages */}
            <li>
              Tus turnos, incluidos los futuros, que quedan cancelados: el horario se libera para otro cliente y los
              recordatorios pendientes no se envían.
            </li>
            {/* queue_entries waiting → cancelled; la atención en curso NO se toca */}
            <li>
              Tu lugar en la fila del local, si estabas esperando. Si te están atendiendo en ese momento, el barbero
              termina y cobra normalmente.
            </li>
            {/* client_otp_challenges: se borran por phone_tail */}
            <li>Los códigos de acceso que hayas pedido por WhatsApp.</li>
            {/* client_reviews, review_requests, conversations, crm_cases */}
            <li>Tus reseñas, las encuestas pendientes y las conversaciones por WhatsApp e Instagram con la Barbería.</li>
            {/* client_face_descriptors + clients.face_photo_url */}
            <li>
              La foto de referencia y el descriptor facial que registraste en la tablet del local, si lo hiciste.
            </li>
            {/* clients.notes / clients.instagram */}
            <li>Las notas de atención de tu ficha y tu usuario de Instagram, si lo habías dejado.</li>
          </ul>
          {/* `loyalty_same_person_ids`: la identidad es el teléfono, y en prod
              hay 19 teléfonos con dos fichas (una del local, otra de la app).
              Borrar sólo la de la app dejaría al cliente creyendo que se fue. */}
          <p className="mt-4 text-[15px] leading-relaxed text-gray-600">
            Si por alguna razón tenías <strong className="text-gray-900">más de una ficha con el mismo teléfono</strong>{' '}
            —por ejemplo, una creada en el local y otra desde la app—, se borran todas.
          </p>
        </div>

        {/* ── Qué se conserva ─────────────────────────────────────────── */}
        <div className="mt-10 border-t pt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">
            Qué se conserva, y por qué
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
            Lo que sigue queda <strong className="text-gray-900">disociado de tu identidad</strong>: sin tu nombre,
            tu teléfono ni ningún dato que permita saber que fuiste vos. Se conserva por obligaciones legales, no
            porque queramos guardar algo tuyo.
          </p>
          <ul className="mt-3 list-disc list-inside space-y-2 text-[15px] leading-relaxed text-gray-600">
            {/* visits / queue_entries: UPDATE SET client_id = NULL */}
            <li>
              <strong>Las visitas ya realizadas</strong> (servicio, fecha, sucursal, importe): son la base de la
              contabilidad y de las estadísticas del negocio. Quedan sin cliente asociado.
            </li>
            {/* payment_receipts / arca_invoices: SET NULL; comprobantes fiscales */}
            <li>
              <strong>Los comprobantes de pago y las facturas</strong> emitidas por esas visitas: la ley fiscal obliga a
              guardarlos <strong>10 años</strong> (Ley 11.683 y art. 328 del Código Civil y Comercial).
            </li>
            {/* booking_deposits: SET client_id = NULL (mig 215). Una seña
                `pagada` sin resolver ni siquiera deja llegar hasta acá: corta
                antes con `deposit_pending` (ver el bloque de arriba). */}
            <li>
              <strong>El registro de las señas ya resueltas</strong> (monto, fecha, estado y el identificador que
              devolvió Mercado Pago): queda sin cliente asociado, por la misma obligación fiscal. Mercado Pago conserva
              por su cuenta el registro del pago, bajo su propia política.
            </li>
            <li>
              <strong>Los pedidos de arrepentimiento o reclamos</strong> que hayas hecho y su respuesta: como
              constancia, durante los plazos que fija la Ley de Defensa del Consumidor.
            </li>
          </ul>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
            Si después volvés a registrarte —en la app o en la tablet del local— la cuenta nueva arranca de cero: no
            se recuperan puntos, premios ni historial.
          </p>
        </div>

        <div className="mt-10 border-t pt-8">
          <p className="text-sm leading-relaxed text-gray-500">
            {companyName} · {city} ·{' '}
            <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
              {email}
            </a>
          </p>
          <p className="mt-2 text-sm text-gray-400">
            <Link href="/privacidad" className="hover:underline">
              Política de privacidad
            </Link>
            {' · '}
            <Link href="/terminos" className="hover:underline">
              Términos y condiciones
            </Link>
            {' · '}
            <Link href="/soporte" className="hover:underline">
              Soporte
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

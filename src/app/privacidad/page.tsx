import type { Metadata } from 'next'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { MONACO, RESPONSABLE, Dato } from '@/app/soporte/contacto'

export const metadata: Metadata = {
  title: 'Política de privacidad — Monaco Barber Studio',
  description:
    'Qué datos trata la app Monaco de Monaco Barber Studio, para qué, con qué proveedores, cuánto tiempo y cómo ejercer tus derechos de acceso, rectificación y supresión.',
  robots: { index: true, follow: true },
}

/**
 * /privacidad — Política de privacidad de la app Monaco (clientes).
 *
 * Es la URL que enlazan la app (`AppConstants.privacyPolicyUrl`), el turnero
 * web, /terminos, /arrepentimiento y las fichas de App Store y Google Play.
 *
 * Reescrita el 10/9/2026. Hasta entonces esta página era la política de
 * "Smart Barbershops" —la plataforma, escrita desde el proveedor SaaS para el
 * negocio— y no nombraba a Monaco en ninguna parte. Un revisor de Apple que la
 * abría desde el Perfil de la app "Monaco" veía otra marca y una plataforma
 * B2B (motivo de rechazo 5.1.1(i) "policy does not match"), y le faltaba la
 * mitad de lo que la app y el local procesan: Google/Apple, ubicación,
 * biometría local, token push, la foto facial del kiosco, la IA sobre los
 * mensajes. Se REEMPLAZÓ en vez de moverla a /privacidad-plataforma porque
 * ninguna pantalla del dashboard la enlazaba: sus únicos lectores eran
 * clientes de Monaco.
 *
 * Reglas que atraviesan el texto:
 *  · La lista de datos sale del CÓDIGO y de la base, no de una plantilla.
 *    Cada ítem tiene una tabla o un permiso detrás (ver los comentarios).
 *  · Los plazos son los de la Ley 25.326: acceso en 10 días corridos (art. 14)
 *    y rectificación/supresión en 5 días hábiles (art. 16). Los "30 días" de
 *    la versión anterior prometían incumplir la ley.
 *  · El responsable va con PLACEHOLDERS (razón social, CUIT, domicilio): no se
 *    inventan datos legales. Se resaltan en ámbar hasta que el dueño los cargue.
 *  · Blanco y negro, como /terminos y /arrepentimiento: superficie legal que
 *    tiene que leerse en cualquier contexto, incluida una captura.
 */
export default function PrivacidadPage() {
  const lastUpdated = '10 de septiembre de 2026'
  const { appName, companyName, city, email, whatsappDisplay, whatsappUrl } = MONACO

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-gray-900 text-white">
          <Lock className="size-6" />
        </span>
        <h1 className="mt-5 text-3xl font-bold text-gray-900">{companyName}</h1>
        <h2 className="text-xl text-gray-500 mb-1">Política de privacidad de la app {appName}</h2>
        <p className="text-sm text-gray-400 mb-8">Última actualización: {lastUpdated} · Versión 3</p>

        {/* Resumen ejecutivo: lo que un cliente (o un revisor de la tienda)
            quiere saber en treinta segundos. El detalle viene después. */}
        <div className="mb-10 rounded-2xl bg-gray-100 p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900">En pocas palabras</h3>
          <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-gray-600">
            <li>
              La app {appName} es la app de clientes de {companyName}, una barbería de Córdoba. Tu identidad
              en la app es <strong className="text-gray-900">tu número de teléfono</strong>.
            </li>
            <li>
              Usamos tus datos para darte turnos, atenderte en el local, sumarte puntos y avisarte lo que te
              importa. <strong className="text-gray-900">No vendemos tus datos, no hay publicidad de terceros
              ni rastreo entre apps.</strong>
            </li>
            <li>
              Los datos de tu tarjeta <strong className="text-gray-900">nunca pasan por nosotros</strong>: la
              seña la cobra Mercado Pago.
            </li>
            <li>
              Face ID, huella y PIN funcionan <strong className="text-gray-900">sólo en tu teléfono</strong>. La
              ubicación es opcional y no se guarda.
            </li>
            <li>
              Podés borrar tu cuenta desde la app (<strong className="text-gray-900">Perfil → Eliminar mi
              cuenta</strong>) o desde{' '}
              <Link href="/eliminar-cuenta" className="text-blue-600 hover:underline">
                monacobarber.vercel.app/eliminar-cuenta
              </Link>
              .
            </li>
          </ul>
        </div>

        {/* 1 ─────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">1. Quién es el responsable de tus datos</h3>
          <p className="text-gray-600 leading-relaxed mb-3">
            El responsable del tratamiento de tus datos personales es <Dato valor={RESPONSABLE.razonSocial} />,
            CUIT <Dato valor={RESPONSABLE.cuit} />, con domicilio en <Dato valor={RESPONSABLE.domicilio} />, que
            opera la barbería {companyName} y la app {appName} (&ldquo;nosotros&rdquo;, la &ldquo;Barbería&rdquo;).
          </p>
          <p className="text-gray-600 leading-relaxed">
            Para cualquier consulta o pedido sobre tus datos escribinos a{' '}
            <a href={`mailto:${email}`} className="text-blue-600 hover:underline">{email}</a> o por WhatsApp al{' '}
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {whatsappDisplay}
            </a>
            .
          </p>
        </section>

        {/* 2 ─────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">2. A quién y a qué se aplica</h3>
          <p className="text-gray-600 leading-relaxed">
            Esta política se aplica a los clientes de {companyName} que usan la app {appName} (iOS y Android), el
            turnero web de <span className="whitespace-nowrap">monacobarber.vercel.app</span>, la tablet de
            check-in de nuestras sucursales y los canales de WhatsApp e Instagram de la Barbería. Todo eso funciona
            sobre un mismo sistema, así que tu ficha de cliente es una sola: lo que registrás en el local lo ves en la
            app, y al revés.
          </p>
        </section>

        {/* 3 ─────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">3. Qué datos tratamos y por dónde entran</h3>
          <p className="text-gray-600 leading-relaxed mb-4">
            Tratamos únicamente lo que hace falta para prestarte el servicio. Esta es la lista completa, agrupada por
            origen.
          </p>

          <h4 className="font-semibold text-gray-900 mb-2">3.1 Tu cuenta e identidad</h4>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-4">
            {/* clients.name / clients.phone / clients.email / client_social_identities */}
            <li>
              <strong>Nombre y número de teléfono.</strong> El teléfono es tu identificador: es el mismo con el que te
              anotás en la fila del local, con el que te llegan los mensajes de WhatsApp y al que se asocian tus puntos.
            </li>
            <li>
              <strong>Si entrás con Google o con Apple:</strong> el identificador de tu cuenta en ese proveedor, tu
              nombre y el email que ellos nos devuelven. Con Apple podés elegir &ldquo;Ocultar mi email&rdquo;: en ese
              caso recibimos una dirección de reenvío, no la tuya. Igual te pedimos verificar tu teléfono la primera
              vez: Google y Apple son un atajo para entrar, no una identidad aparte.
            </li>
            {/* client_otp_challenges: code_hash, phone, device_id, ip, expires_at */}
            <li>
              <strong>Código de verificación por WhatsApp.</strong> Guardamos el código cifrado (no el código en
              claro), tu número, un identificador de tu dispositivo y la dirección IP desde la que lo pediste, para
              limitar la cantidad de intentos y evitar abusos. El código vence a los 10 minutos y el registro se borra al
              día siguiente.
            </li>
            {/* clients.id / auth.users.id / clients.referral_code */}
            <li>
              <strong>Identificador de usuario</strong> interno, y tu <strong>código de invitación</strong> (el
              &ldquo;Invitá a un amigo&rdquo; del Perfil), que no contiene datos personales.
            </li>
            {/* clients.instagram / clients.notes: los carga el staff */}
            <li>
              <strong>Lo que le dejás al barbero:</strong> tu usuario de Instagram, si nos lo diste, y las notas de
              atención que el barbero carga en tu ficha (por ejemplo, cómo te gusta el corte).
            </li>
          </ul>

          <h4 className="font-semibold text-gray-900 mb-2">3.2 Tu dispositivo y las notificaciones</h4>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-4">
            {/* client_device_tokens: token, device_id, platform, app_version, last_seen_at */}
            <li>
              <strong>Token de notificaciones push</strong> (Firebase Cloud Messaging), un{' '}
              <strong>identificador de instalación</strong> que genera la app (no es el número de serie ni el
              identificador publicitario del teléfono), el sistema operativo y la versión de la app.
            </li>
            {/* client_notification_preferences: campaigns, appointment_reminders, appointment_updates, rewards */}
            <li>
              <strong>Tus preferencias de notificaciones</strong> (Perfil → Preferencias): recordatorios de turno,
              cambios en tus turnos, premios y puntos, campañas y novedades.
            </li>
            {/* client_notifications */}
            <li>
              <strong>La bandeja de notificaciones</strong> de la app: cada aviso que te mandamos y si lo leíste.
            </li>
          </ul>

          <h4 className="font-semibold text-gray-900 mb-2">3.3 Turnos, visitas y fila</h4>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-4">
            {/* appointments / queue_entries / visits */}
            <li>
              <strong>Turnos:</strong> sucursal, fecha, hora, servicio, barbero, estado (confirmado, atendido,
              cancelado, ausente) y las cancelaciones o reprogramaciones.
            </li>
            <li>
              <strong>Entradas a la fila del local</strong> cuando te anotás en la tablet, y{' '}
              <strong>visitas realizadas:</strong> servicio, barbero, sucursal, fecha y hora, importe cobrado, medio de
              pago y propina.
            </li>
            {/* visit_photos: el barbero saca la foto y la sube por QR */}
            <li>
              <strong>Fotos de tu corte</strong>, sólo si el barbero te la saca con tu permiso para guardarla en tu
              historial.
            </li>
            {/* client_reviews / review_requests / workflow_executions */}
            <li>
              <strong>Tus reseñas y opiniones:</strong> la calificación y el comentario que dejás en la app o al
              responder la encuesta que te llega por WhatsApp después de una visita. Si elegís dejar una reseña en
              Google, eso lo publicás vos en Google con tu cuenta de Google; nosotros sólo te llevamos hasta ahí.
            </li>
          </ul>

          <h4 className="font-semibold text-gray-900 mb-2">3.4 Puntos, premios e invitaciones</h4>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-4">
            {/* client_loyalty_state / point_transactions / client_rewards / referrals / partner_benefit_redemptions */}
            <li>
              <strong>Tu categoría</strong> en el programa de fidelización, <strong>tus puntos</strong> (cuándo los
              sumaste, cuándo vencen, en qué los canjeaste), <strong>tus premios</strong> y sus códigos QR, los{' '}
              <strong>beneficios de comercios aliados</strong> que activaste y el premio de la ruleta de bienvenida.
            </li>
            <li>
              <strong>Invitaciones:</strong> si alguien viene con tu código, registramos que esa persona fue invitada
              por vos, para acreditarles el beneficio a los dos.
            </li>
          </ul>

          <h4 className="font-semibold text-gray-900 mb-2">3.5 La seña de un turno</h4>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-4">
            {/* booking_deposits: amount, percentage, status, mp_payment_id, mp_payment_type_id, refunded_* */}
            <li>
              Cuando pagás una seña guardamos <strong>el monto, el porcentaje, la fecha, el estado</strong> (pagada,
              vencida, devuelta, aplicada al turno), el <strong>identificador del pago y de la operación que nos
              devuelve Mercado Pago</strong> y el tipo de medio que usaste (por ejemplo, &ldquo;tarjeta de
              crédito&rdquo; o &ldquo;dinero en cuenta&rdquo;).
            </li>
            <li>
              <strong>No recibimos ni almacenamos los datos de tu tarjeta</strong> —número, vencimiento ni código de
              seguridad—. Los ingresás directamente en Mercado Pago y nunca pasan por nuestros sistemas.
            </li>
            {/* crm_alerts: pedidos del botón de arrepentimiento */}
            <li>
              Si usás el{' '}
              <Link href="/arrepentimiento" className="text-blue-600 hover:underline">Botón de arrepentimiento</Link>:
              el nombre, el teléfono y el detalle que escribas, junto con el código de identificación que te devolvemos,
              para darle seguimiento al pedido y dejar constancia de la respuesta.
            </li>
          </ul>

          <h4 className="font-semibold text-gray-900 mb-2">3.6 Mensajes con la Barbería</h4>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-4">
            {/* conversations / messages / chat-media */}
            <li>
              <strong>Las conversaciones por WhatsApp e Instagram</strong> con la Barbería: el texto, los archivos que
              mandás y los mensajes que te enviamos (confirmaciones, recordatorios, el código de acceso, encuestas y
              campañas). Se guardan para tener el historial y poder atenderte.
            </li>
            {/* payment_receipts + transfer-receipts (bucket privado) */}
            <li>
              <strong>El comprobante de transferencia</strong> que mostrás en la tablet cuando pagás por
              transferencia en el local: se escanea para conciliar el cobro. La imagen queda en un almacenamiento
              privado y de ella leemos el número de operación, el importe, la fecha y el nombre del titular.
            </li>
          </ul>

          {/* Dato sensible (art. 2 y 7 Ley 25.326; Res. AAIP 4/2019): los datos
              biométricos que identifican unívocamente a una persona son
              sensibles. Necesitan consentimiento expreso e informado. */}
          <div className="mb-4 rounded-2xl border-2 border-gray-900 p-5">
            <h4 className="font-semibold text-gray-900 mb-2">3.7 Reconocimiento facial en el local (dato sensible)</h4>
            <p className="text-gray-600 leading-relaxed mb-3">
              La tablet de check-in de cada sucursal te ofrece <strong>&ldquo;Registrar tu cara&rdquo;</strong> para
              que en las próximas visitas te reconozca sin tipear el teléfono. Es{' '}
              <strong className="text-gray-900">opcional</strong>: sólo se registra si vos lo iniciás tocando ese
              botón y mirás a la cámara, y la app y todo lo demás funcionan igual sin hacerlo.
            </p>
            <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-3">
              <li>
                <strong>Qué guardamos:</strong> una foto de referencia de tu cara y una representación numérica de sus
                rasgos (un &ldquo;descriptor&rdquo;) que la tablet compara al identificarte. Es un{' '}
                <strong>dato biométrico</strong>, que la Ley 25.326 (art. 7) y la Agencia de Acceso a la Información
                Pública (Res. 4/2019) consideran <strong>sensible</strong>; por eso te pedimos que lo actives vos.
              </li>
              <li>
                <strong>Para qué:</strong> únicamente para reconocerte en la tablet de {companyName}. No se usa para
                ninguna otra finalidad, no se comparte con nadie ni se cruza con otras bases.
              </li>
              <li>
                <strong>Cómo se borra:</strong> se elimina junto con tu cuenta (Perfil → Eliminar mi cuenta, o desde{' '}
                <Link href="/eliminar-cuenta" className="text-blue-600 hover:underline">/eliminar-cuenta</Link>), y
                también podés pedir que borremos sólo la foto y el descriptor y seguir usando la app: escribinos y lo
                hacemos en un máximo de 5 días hábiles.
              </li>
            </ul>
            <p className="text-gray-600 leading-relaxed">
              Aparte de esto, la app <strong>no</strong> usa la cámara ni accede a tus fotos.
            </p>
          </div>

          <h4 className="font-semibold text-gray-900 mb-2">3.8 Lo que ocurre sólo en tu teléfono y nunca sale de ahí</h4>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-4">
            {/* local_auth: NSFaceIDUsageDescription / USE_BIOMETRIC; PIN local */}
            <li>
              <strong>Face ID, huella y PIN.</strong> Si protegés la app con biometría o con un PIN, la verificación la
              hace tu propio teléfono. Nosotros no recibimos ni tu huella, ni tu cara, ni tu PIN: sólo sabemos si el
              teléfono dijo que sos vos.
            </li>
            {/* geolocator: sólo al tocar "Ordenar por cercanía" en el paso 1 de la reserva; no se persiste ni se envía */}
            <li>
              <strong>Ubicación aproximada, opcional.</strong> Al elegir sucursal para un turno podés tocar
              &ldquo;Ordenar por cercanía&rdquo;. Recién ahí la app le pide permiso al sistema, calcula la distancia a
              cada sucursal <strong>en tu teléfono</strong> y la descarta. No se guarda, no se envía a nuestros
              servidores y no se usa en segundo plano. Si no das el permiso, la lista se muestra igual, sin distancias.
            </li>
            {/* device_secret en Keychain / EncryptedSharedPreferences */}
            <li>
              <strong>La clave de tu sesión</strong>, que se genera al azar en tu teléfono y queda guardada en el
              almacenamiento seguro del sistema. Por eso, si cambiás de teléfono, tenés que verificar el número de nuevo.
            </li>
          </ul>

          <h4 className="font-semibold text-gray-900 mb-2">3.9 Lo que NO hacemos</h4>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>No accedemos a tus contactos, tus fotos, tu micrófono ni tu calendario.</li>
            <li>
              No hay publicidad de terceros en la app, no usamos identificadores publicitarios ni herramientas de
              rastreo entre apps o sitios, y no cedemos ni vendemos tus datos a nadie con fines comerciales.
            </li>
            <li>No usamos tus datos para tomar decisiones automatizadas que te afecten legalmente.</li>
          </ul>
        </section>

        {/* 4 ─────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">4. Para qué usamos tus datos</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>
              <strong>Atenderte:</strong> reservar, confirmar, recordar y cancelar turnos; ordenar la fila del local;
              cobrar el servicio y, cuando corresponde, cobrar o devolver la seña.
            </li>
            <li>
              <strong>Reconocerte:</strong> verificar que el teléfono es tuyo, mantener tu sesión y, si lo activaste,
              identificarte en la tablet del local.
            </li>
            <li>
              <strong>Fidelizarte:</strong> calcular tu categoría, acreditar y vencer puntos, entregar premios y
              beneficios, y acreditar las invitaciones.
            </li>
            <li>
              <strong>Comunicarnos con vos:</strong> mensajes de servicio por WhatsApp y notificaciones push
              (confirmaciones, recordatorios, cambios, premios) y, si no lo desactivaste, campañas y novedades propias
              de {companyName} (ver el punto 5).
            </li>
            <li>
              <strong>Mejorar el servicio:</strong> conocer tiempos de espera, ocupación y estadísticas internas. Para
              eso usamos datos agregados o disociados de tu identidad.
            </li>
            <li>
              <strong>Prevenir abusos:</strong> limitar intentos de acceso, detectar cuentas duplicadas, canjes
              fraudulentos o reservas masivas.
            </li>
            <li>
              <strong>Cumplir la ley:</strong> obligaciones fiscales y contables sobre lo cobrado, y las de defensa
              del consumidor (por ejemplo, responder un pedido de arrepentimiento y dejar constancia).
            </li>
          </ul>
          <p className="text-gray-600 leading-relaxed mt-3">
            La base para tratar tus datos es la relación de servicio que tenés con la Barbería (art. 5 inc. 2.c de la
            Ley 25.326) y, para lo que no es necesario para atenderte —campañas, reconocimiento facial, ubicación—, tu
            consentimiento, que podés retirar cuando quieras.
          </p>
        </section>

        {/* 5 ─────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">5. Campañas y novedades: cómo decir que no</h3>
          <p className="text-gray-600 leading-relaxed mb-3">
            Sólo te mandamos comunicaciones de {companyName}: promociones, cartelera de la Barbería, premios nuevos.
            Nunca de terceros. Podés dejar de recibirlas en cualquier momento:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-3">
            {/* client_notification_preferences.campaigns */}
            <li>
              <strong>Push:</strong> en la app, Perfil → Preferencias → &ldquo;Campañas y novedades&rdquo;, o desde los
              ajustes de notificaciones de tu teléfono.
            </li>
            {/* No hay opt-out automático en el webhook: lo aplica una persona desde el inbox. Se dice así. */}
            <li>
              <strong>WhatsApp:</strong> respondé al mensaje que recibiste diciendo que no querés más campañas, o
              escribinos a cualquiera de los contactos del punto 1. Lo aplicamos a mano dentro de los 5 días hábiles.
            </li>
          </ul>
          <p className="text-gray-600 leading-relaxed">
            Las comunicaciones <strong>de servicio</strong> (el código de acceso, la confirmación o cancelación de un
            turno, la respuesta a un reclamo) no son campañas y siguen llegando mientras tengas una reserva o un
            pedido abierto. El titular de los datos puede en cualquier momento solicitar el retiro o bloqueo de su
            nombre de la base de datos usada con fines de publicidad (art. 27 de la Ley 25.326).
          </p>
        </section>

        {/* 6 ─────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">6. Con quién compartimos tus datos</h3>
          <p className="text-gray-600 leading-relaxed mb-3">
            No vendemos tus datos. Para que la app y el local funcionen usamos proveedores que tratan datos por cuenta
            nuestra, cada uno sólo para lo que sigue:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-3">
            <li>
              <strong>Supabase</strong> — base de datos, almacenamiento de archivos y sistema de autenticación
              (donde vive tu ficha de cliente).
            </li>
            <li>
              <strong>Vercel</strong> — alojamiento del sitio web, del turnero y de la parte del sistema con la que
              habla la app.
            </li>
            <li>
              <strong>Google Firebase (Cloud Messaging)</strong> — entrega de las notificaciones push. Sólo recibe el
              token de tu dispositivo y el contenido de cada aviso.
            </li>
            <li>
              <strong>Google (Sign-In)</strong> y <strong>Apple (Sign in with Apple)</strong> — si elegís entrar con
              ellos. Nos devuelven tu identificador, nombre y email según lo que autorices en tu cuenta.
            </li>
            <li>
              <strong>Mercado Pago</strong> (Mercado Libre S.R.L.) — cobro y devolución de las señas. Cuando pagás,
              salís de nuestra pantalla y completás la operación en Mercado Pago, bajo su propia{' '}
              <a href="https://www.mercadopago.com.ar/privacidad" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                política de privacidad
              </a>
              . Nosotros sólo recibimos el resultado, el monto y un identificador.
            </li>
            <li>
              <strong>Meta</strong> (WhatsApp Business Platform e Instagram) — envío y recepción de mensajes. Los
              mensajes se procesan conforme a las{' '}
              <a href="https://www.whatsapp.com/legal/business-policy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                políticas de WhatsApp Business
              </a>{' '}
              y los{' '}
              <a href="https://www.facebook.com/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                términos de Meta
              </a>
              . Sólo te escribimos si nos diste tu número o nos escribiste antes.
            </li>
            {/* Verificado en prod el 10/9/2026: organization_ai_config del org de Monaco tiene
                auto_tag_enabled = true con gpt-4o-mini y clave de OpenAI (sin clave de Anthropic),
                y transfer_receipt_settings.extraction_engine = 'ai'. `extractWithVision` admite
                Anthropic como proveedor alternativo, por eso se nombra. Apple 5.1.2(i) exige
                declarar el uso de IA de terceros. */}
            <li>
              <strong>OpenAI</strong> (y, como alternativa técnica, <strong>Anthropic</strong>) —
              inteligencia artificial que usa el equipo de la Barbería para dos cosas:
              clasificar automáticamente los mensajes que llegan por WhatsApp e Instagram (por ejemplo, &ldquo;consulta de
              precios&rdquo;) y leer los datos del comprobante de transferencia que mostrás en la tablet. Se le envía el
              texto del mensaje o la imagen del comprobante, no tu ficha completa, y según sus condiciones para uso
              empresarial no usa esos datos para entrenar sus modelos.
            </li>
            <li>
              <strong>Comercios aliados</strong> — cuando activás un beneficio de un comercio aliado, ese comercio ve
              el código del beneficio para validarlo. No le damos tu nombre, teléfono ni historial.
            </li>
          </ul>
          <p className="text-gray-600 leading-relaxed mb-3">
            Varios de estos proveedores alojan sus servidores fuera de la Argentina (principalmente en Estados
            Unidos). Con ellos rigen contratos y garantías de seguridad y confidencialidad. Al usar la app aceptás esa
            transferencia internacional en los términos del art. 12 de la Ley 25.326.
          </p>
          <p className="text-gray-600 leading-relaxed">
            Además podemos entregar datos a autoridades públicas cuando una ley o una orden judicial nos lo exija, y
            usarlos para ejercer o defender nuestros derechos ante un reclamo.
          </p>
        </section>

        {/* 7 ─────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">7. Cuánto tiempo los guardamos</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>
              <strong>Tu cuenta y tu ficha</strong> (nombre, teléfono, email, identidades de Google/Apple,
              dispositivos, preferencias, puntos, premios, invitaciones, reseñas, conversaciones, foto y descriptor
              facial): mientras la cuenta exista. Se borran cuando la eliminás o cuando nos lo pedís.
            </li>
            <li>
              <strong>El código de acceso</strong> por WhatsApp: vence a los 10 minutos y el registro se borra al día
              siguiente.
            </li>
            <li>
              <strong>Tokens de notificaciones:</strong> se dan de baja al cerrar sesión, al eliminar la cuenta o cuando
              el sistema del teléfono nos avisa que ya no son válidos.
            </li>
            <li>
              <strong>Ubicación y biometría del teléfono:</strong> nunca las guardamos (ver el punto 3.8).
            </li>
            {/* visits / payment_receipts / arca_invoices / booking_deposits: quedan con client_id = NULL */}
            <li>
              <strong>Visitas cobradas, comprobantes de pago, facturas y señas:</strong> los conservamos{' '}
              <strong>10 años</strong> por obligación fiscal y contable (Ley 11.683 y art. 328 del Código Civil y
              Comercial), pero <strong>disociados de tu identidad</strong> cuando eliminás la cuenta: queda el
              registro de la operación (servicio, importe, fecha, sucursal) sin tu nombre, teléfono ni ningún dato que
              permita identificarte.
            </li>
            <li>
              <strong>Pedidos de arrepentimiento y reclamos</strong>, con su respuesta: durante los plazos de
              prescripción de la Ley de Defensa del Consumidor, como constancia de que los respondimos.
            </li>
            <li>
              <strong>Registros técnicos</strong> (accesos, errores, límites de intentos): por períodos cortos, sólo
              para seguridad y diagnóstico.
            </li>
          </ul>
        </section>

        {/* 8 ─────────────────────────────────────────────────────────── */}
        <section className="mb-8 rounded-2xl border-2 border-gray-900 p-5">
          <h3 className="text-lg font-semibold mb-3">8. Tus derechos y cómo ejercerlos</h3>
          <p className="text-gray-600 leading-relaxed mb-3">
            Como titular de tus datos tenés derecho a:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mb-4">
            <li>
              <strong>Acceder</strong> a los datos que tenemos sobre vos. Te respondemos dentro de los{' '}
              <strong>10 días corridos</strong> de recibido el pedido (art. 14 de la Ley 25.326).
            </li>
            <li>
              <strong>Rectificarlos, actualizarlos o suprimirlos.</strong> Lo hacemos dentro de los{' '}
              <strong>5 días hábiles</strong> de recibido el reclamo (art. 16). Tu nombre lo podés cambiar vos desde
              la app (Perfil → Editar nombre); tu teléfono, escribiéndonos.
            </li>
            <li>
              <strong>Eliminar tu cuenta</strong> por tu cuenta y en el momento, desde la app: Perfil → Eliminar mi
              cuenta. Si ya no tenés la app, pedilo desde{' '}
              <Link href="/eliminar-cuenta" className="font-semibold text-blue-600 hover:underline">
                monacobarber.vercel.app/eliminar-cuenta
              </Link>
              . Ahí está detallado qué se borra y qué queda disociado. Si tenés una seña pagada de un turno que
              todavía no ocurrió, primero hay que resolverla —cancelar el turno o pedir la devolución—: no borramos la
              cuenta con plata tuya en el aire.
            </li>
            <li>
              <strong>Oponerte</strong> a un uso concreto y <strong>retirar tu consentimiento</strong> para lo que
              depende de él: las campañas (punto 5), el reconocimiento facial (punto 3.7) o la ubicación (basta con
              quitarle el permiso a la app).
            </li>
          </ul>
          <p className="text-gray-600 leading-relaxed mb-3">
            Para ejercerlos escribinos a{' '}
            <a href={`mailto:${email}`} className="text-blue-600 hover:underline">{email}</a> o por WhatsApp al{' '}
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {whatsappDisplay}
            </a>
            , indicando tu nombre y el teléfono con el que te registraste. Como tu teléfono es tu identidad, para
            pedidos que afectan la cuenta te vamos a pedir confirmarlo con un código enviado a ese número. Es gratuito.
          </p>
          {/* Leyendas obligatorias de la Disposición DNPDP 10/2008 (hoy la
              autoridad de control es la AAIP, Ley 27.275 y Res. AAIP 14/2018). */}
          <div className="rounded-xl bg-gray-100 p-4 text-sm leading-relaxed text-gray-700 space-y-3">
            <p>
              El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en
              forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al
              efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley N° 25.326.
            </p>
            <p>
              LA AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326,
              tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus
              derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.
            </p>
            <p>
              Podés contactarla en{' '}
              <a href="https://www.argentina.gob.ar/aaip" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                www.argentina.gob.ar/aaip
              </a>
              .
            </p>
          </div>
        </section>

        {/* 9 ─────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">9. Menores de edad</h3>
          <p className="text-gray-600 leading-relaxed">
            La app {appName} está pensada para <strong>mayores de 18 años</strong>. Elegimos esa edad porque desde la
            app se celebran contratos a distancia y se pagan señas con Mercado Pago, que exige ser mayor de edad para
            tener una cuenta, y porque no queremos tratar datos de menores sin la intervención de un adulto. Si tenés
            menos de 18, la cuenta la crea y administra tu madre, padre o tutor a su nombre y con su teléfono, y puede
            sacar turnos para vos. Si nos enteramos de que se creó una cuenta a nombre de un menor, la eliminamos.
          </p>
        </section>

        {/* 10 ────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">10. Cómo protegemos tus datos</h3>
          <p className="text-gray-600 leading-relaxed">
            Toda la comunicación viaja cifrada (HTTPS). El acceso a la base de datos está restringido por roles y por
            políticas de seguridad a nivel de fila, de modo que desde la app sólo se pueden leer tus propios datos. Los
            códigos de acceso se guardan cifrados, los comprobantes de transferencia en almacenamiento privado, y la
            clave de tu sesión sólo existe en tu teléfono. El personal de la Barbería accede a tu ficha únicamente para
            atenderte. Si ocurriera un incidente de seguridad que afecte tus datos, te lo vamos a comunicar.
          </p>
        </section>

        {/* 11 ────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">11. Cambios en esta política</h3>
          <p className="text-gray-600 leading-relaxed">
            Si cambiamos algo relevante —un dato nuevo, un proveedor nuevo, otra finalidad— actualizamos esta página, su
            fecha y su número de versión, y te lo avisamos en la app antes de que empiece a regir. La versión vigente es
            siempre la publicada acá. Esta es la versión 3 ({lastUpdated}) y reemplaza a la del 3 de septiembre de
            2026.
          </p>
        </section>

        {/* 12 ────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">12. Contacto</h3>
          <p className="text-gray-600 leading-relaxed">
            {companyName} · {city}
            <br />
            Email:{' '}
            <a href={`mailto:${email}`} className="text-blue-600 hover:underline">{email}</a>
            <br />
            WhatsApp:{' '}
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {whatsappDisplay}
            </a>
            <br />
            Más ayuda:{' '}
            <Link href="/soporte" className="text-blue-600 hover:underline">monacobarber.vercel.app/soporte</Link>
          </p>
        </section>

        <div className="border-t pt-8 mt-8">
          <p className="text-sm text-gray-400 text-center">
            © {new Date().getFullYear()} {companyName}. Todos los derechos reservados.
            {' · '}
            <Link href="/terminos" className="hover:underline">Términos y condiciones</Link>
            {' · '}
            <Link href="/eliminar-cuenta" className="hover:underline">Eliminar tu cuenta</Link>
            {' · '}
            <Link href="/arrepentimiento" className="hover:underline">Botón de arrepentimiento</Link>
            {' · '}
            <Link href="/soporte" className="hover:underline">Soporte</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

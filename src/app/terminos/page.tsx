import Link from 'next/link'

export const metadata = {
  title: 'Términos y condiciones — Monaco Barber Studio',
  description: 'Términos y condiciones de uso de la app Monaco Barber Studio',
}

/**
 * /terminos — Términos y condiciones de uso de la app Monaco (clientes).
 *
 * Página pública y estática, misma estructura que /privacidad. La app la
 * enlaza desde el onboarding (al verificar el teléfono) y desde Perfil; las
 * tiendas (App Store / Google Play) la piden como URL.
 */
export default function TerminosPage() {
  const lastUpdated = '20 de agosto de 2026'
  const appName = 'Monaco'
  const companyName = 'Monaco Barber Studio'
  const companyCity = 'Córdoba, Argentina'
  const contactEmail = 'ignacio.baldovino@hotmail.com'

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">{companyName}</h1>
        <h2 className="text-xl text-gray-500 mb-1">Términos y condiciones de uso de la app {appName}</h2>
        <p className="text-sm text-gray-400 mb-10">Última actualización: {lastUpdated}</p>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">1. Objeto y aceptación</h3>
          <p className="text-gray-600 leading-relaxed mb-3">
            Estos términos regulan el uso de la aplicación móvil {appName} (la &ldquo;App&rdquo;), operada por {companyName},
            con domicilio en {companyCity} (&ldquo;nosotros&rdquo;, la &ldquo;Barbería&rdquo;). La App permite a los clientes de
            la Barbería reservar y administrar turnos, ver el estado de las sucursales, acumular puntos, canjear premios,
            acceder a beneficios de comercios aliados y recibir notificaciones.
          </p>
          <p className="text-gray-600 leading-relaxed">
            Al crear una cuenta o usar la App aceptás estos términos y nuestra{' '}
            <Link href="/privacidad" className="text-blue-600 hover:underline">Política de Privacidad</Link>.
            Si no estás de acuerdo, no uses la App. Podemos actualizar estos términos; la versión vigente es la publicada
            en esta página, con su fecha de última actualización. Si un cambio es relevante, te lo vamos a avisar dentro de la App.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">2. Cuenta y verificación por WhatsApp</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>Para usar la App tenés que ser mayor de 16 años, o contar con autorización de tu madre, padre o tutor.</li>
            <li>
              La cuenta se crea con tu número de teléfono. Para verificar que el número es tuyo te enviamos un código de un solo uso
              por WhatsApp; al ingresar tu número aceptás recibir ese mensaje. El código vence a los pocos minutos y no debe compartirse con nadie.
            </li>
            <li>
              La sesión queda asociada al dispositivo desde el que verificaste. Si cambiás de teléfono o reinstalás la App, vas a
              tener que verificar el número de nuevo.
            </li>
            <li>
              Podés proteger el acceso con huella, reconocimiento facial o un PIN local. Esas medidas viven únicamente en tu dispositivo
              y son tu responsabilidad.
            </li>
            <li>
              Sos responsable de la veracidad de los datos que cargás (nombre, teléfono) y de todo lo que se haga desde tu cuenta.
              Si sospechás un uso no autorizado, avisanos de inmediato.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">3. Turnos, llegada y cancelaciones</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>
              Las sucursales pueden trabajar por orden de llegada, con turnos, o de las dos formas. La App muestra, para cada sucursal,
              qué modalidad está disponible.
            </li>
            <li>
              Un turno se confirma cuando la App lo indica. La Barbería puede limitar la cantidad de turnos activos por cliente y el
              tiempo de anticipación mínimo y máximo para reservar.
            </li>
            <li>
              Te pedimos que llegues a horario y registres tu llegada en la sucursal (en el kiosco o con el personal). Pasado el
              tiempo de tolerancia que defina la Barbería, el turno puede marcarse como ausencia y liberarse para otro cliente.
            </li>
            <li>
              Podés cancelar o reprogramar desde la App dentro de la ventana de cancelación que muestre cada sucursal. Fuera de esa
              ventana la cancelación puede no estar disponible desde la App; en ese caso, comunicate con la sucursal.
            </li>
            <li>
              La Barbería puede cancelar o reprogramar un turno por causas operativas (por ejemplo, ausencia del barbero o cierre
              imprevisto). En ese caso te avisamos por la App y/o WhatsApp y te ofrecemos un nuevo horario.
            </li>
            <li>
              Las ausencias reiteradas sin aviso pueden derivar en restricciones temporales para reservar.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">4. Puntos, premios y beneficios</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>
              El programa de puntos es un beneficio de fidelización que otorga la Barbería. Los puntos se acreditan por visitas
              efectivamente completadas, según las reglas vigentes de cada sucursal, y no tienen valor monetario ni pueden transferirse,
              venderse ni canjearse por dinero.
            </li>
            <li>
              Los premios se canjean presentando el código o QR que genera la App en la sucursal, dentro de su período de validez. Un
              premio canjeado o vencido no se repone.
            </li>
            <li>
              La Barbería puede modificar o dar de baja el programa de puntos, el catálogo de premios, los convenios con comercios
              aliados y sus condiciones, avisando dentro de la App con una anticipación razonable. Los puntos ya acumulados se
              respetan hasta la fecha que se informe.
            </li>
            <li>
              Los beneficios de comercios aliados (&ldquo;Convenios&rdquo;) los presta cada comercio bajo sus propias condiciones; la
              Barbería no es responsable por la calidad ni la disponibilidad de esos productos o servicios.
            </li>
            <li>
              Ante indicios de uso indebido (cuentas duplicadas, canjes fraudulentos, manipulación de códigos), la Barbería puede
              anular puntos o premios y suspender la cuenta.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">5. Notificaciones y comunicaciones</h3>
          <p className="text-gray-600 leading-relaxed">
            La App puede enviarte notificaciones push con recordatorios de turno, cambios en tus reservas, premios disponibles y
            novedades de la Barbería. Podés activar o desactivar cada tipo de notificación desde la configuración de la App o del
            sistema operativo. Las comunicaciones de servicio (por ejemplo, el código de verificación o la cancelación de un turno)
            pueden enviarse por WhatsApp al número con el que te registraste.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">6. Datos personales y privacidad</h3>
          <p className="text-gray-600 leading-relaxed">
            Tratamos tus datos conforme a la Ley 25.326 de Protección de Datos Personales de la República Argentina y a nuestra{' '}
            <Link href="/privacidad" className="text-blue-600 hover:underline">Política de Privacidad</Link>, que forma parte de
            estos términos. Ahí explicamos qué datos recopilamos (nombre, teléfono, historial de visitas y turnos, puntos,
            dispositivo para notificaciones), para qué los usamos, con qué proveedores los procesamos y cómo ejercer tus derechos de
            acceso, rectificación y supresión.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">7. Eliminación de la cuenta</h3>
          <p className="text-gray-600 leading-relaxed">
            Podés eliminar tu cuenta en cualquier momento desde la App, en <strong>Perfil → Eliminar cuenta</strong>. La eliminación
            borra tu usuario, tus dispositivos registrados, tus notificaciones y tus puntos y premios pendientes, y cancela los turnos
            futuros que tengas. El historial de visitas ya realizadas puede conservarse de forma disociada de tu identidad por
            obligaciones contables y fiscales. Si no podés acceder a la App, también podés pedir la baja por correo a{' '}
            <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline">{contactEmail}</a>.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">8. Uso permitido</h3>
          <p className="text-gray-600 leading-relaxed mb-3">Al usar la App te comprometés a no:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>Usar datos de terceros, crear cuentas duplicadas ni suplantar a otra persona.</li>
            <li>Reservar turnos que no pensás usar, ni de manera masiva o automatizada.</li>
            <li>Interferir con el funcionamiento de la App, sus servidores o sus sistemas de seguridad, ni intentar acceder a datos ajenos.</li>
            <li>Copiar, descompilar o reutilizar la App o sus contenidos fuera del uso personal previsto.</li>
          </ul>
          <p className="text-gray-600 leading-relaxed mt-3">
            El incumplimiento puede derivar en la suspensión o cierre de la cuenta, sin perjuicio de las acciones legales que correspondan.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">9. Disponibilidad y responsabilidad</h3>
          <p className="text-gray-600 leading-relaxed">
            La App se ofrece &ldquo;tal cual&rdquo; y de forma gratuita. Hacemos lo razonable para que funcione de manera continua,
            pero puede haber interrupciones por mantenimiento, fallas técnicas o causas ajenas (conectividad, proveedores, el propio
            dispositivo). La información en tiempo real (ocupación, tiempos de espera, disponibilidad de turnos) es estimativa. En la
            medida permitida por la ley, la Barbería no responde por daños indirectos derivados del uso o la imposibilidad de uso de la
            App. Nada de lo anterior limita los derechos que te reconoce la Ley 24.240 de Defensa del Consumidor.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">10. Propiedad intelectual</h3>
          <p className="text-gray-600 leading-relaxed">
            La App, su diseño, marcas, logotipos y contenidos son propiedad de {companyName} o de sus licenciantes y están protegidos
            por la normativa de propiedad intelectual. El uso de la App no te otorga ningún derecho sobre ellos más allá de la
            licencia personal, limitada y revocable para usarla según estos términos.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">11. Soporte y contacto</h3>
          <p className="text-gray-600 leading-relaxed">
            Para consultas, reclamos o ayuda con la App podés escribirnos a{' '}
            <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline">{contactEmail}</a>{' '}
            o acercarte a cualquiera de nuestras sucursales. Respondemos en un plazo máximo de 10 días hábiles.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">12. Ley aplicable y jurisdicción</h3>
          <p className="text-gray-600 leading-relaxed">
            Estos términos se rigen por las leyes de la República Argentina. Ante cualquier controversia, las partes se someten a la
            jurisdicción de los tribunales ordinarios de la ciudad de Córdoba, Provincia de Córdoba, sin perjuicio del fuero que pueda
            corresponderte como consumidor según tu domicilio.
          </p>
        </section>

        <div className="border-t pt-8 mt-8">
          <p className="text-sm text-gray-400 text-center">
            © {new Date().getFullYear()} {companyName}. Todos los derechos reservados.
            {' · '}
            <Link href="/privacidad" className="hover:underline">Política de Privacidad</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

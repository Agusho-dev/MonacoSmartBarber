import Link from 'next/link'
import { Undo2 } from 'lucide-react'

export const metadata = {
  title: 'Términos y condiciones — Monaco Barber Studio',
  description:
    'Términos y condiciones de uso de la app Monaco y del sistema de turnos online, incluida la seña para reservar y el derecho de arrepentimiento.',
}

/**
 * /terminos — Términos y condiciones de Monaco (clientes).
 *
 * Página pública y estática, misma estructura que /privacidad. La enlazan la
 * app (onboarding y Perfil), el turnero web y las tiendas (App Store / Google
 * Play), que la piden como URL.
 *
 * Reescrita el 3/9/2026 por la seña. Lo que cambió y por qué:
 *
 *  · El §3 viejo prometía que se podía "cancelar sin costo dentro de la ventana"
 *    y eso dejó de ser cierto el día que una sucursal empezó a cobrar seña. Un
 *    término que promete algo que el sistema no cumple no es letra muerta: es
 *    una cláusula que el consumidor puede hacer valer.
 *  · La seña tiene sección propia (§4) y el derecho de revocación otra (§5),
 *    separada a propósito. Son cosas distintas: la política de cancelación la
 *    escribe el negocio, el derecho de arrepentimiento lo escribe la ley y es
 *    IRRENUNCIABLE (art. 1110 CCyC; la Disp. 377/2026 declara abusiva la
 *    cláusula que pretenda limitarlo). Mezclarlas invita a leer la segunda como
 *    si fuera negociable.
 *  · El link al Botón de arrepentimiento va destacado y arriba de todo
 *    (Disp. 954/2025, que reemplazó a la Res. 424/2020 —derogada—).
 *
 * Los textos están escritos para leerse, no para cubrirse: si algo se puede
 * decir en una frase corta, va en una frase corta.
 */
export default function TerminosPage() {
  const lastUpdated = '3 de septiembre de 2026'
  const appName = 'Monaco'
  const companyName = 'Monaco Barber Studio'
  const companyCity = 'Córdoba, Argentina'
  const contactEmail = 'ignacio.baldovino@hotmail.com'

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">{companyName}</h1>
        <h2 className="text-xl text-gray-500 mb-1">
          Términos y condiciones de la app {appName} y de los turnos online
        </h2>
        <p className="text-sm text-gray-400 mb-8">Última actualización: {lastUpdated}</p>

        {/* El botón que la Disposición 954/2025 exige "a simple vista y en lugar
            destacado". Va arriba de todo el texto legal, no al final. */}
        <Link
          href="/arrepentimiento"
          className="mb-10 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-gray-900 px-4 py-3 text-sm font-bold uppercase tracking-wide text-gray-900 hover:bg-gray-900 hover:text-white transition-colors"
        >
          <Undo2 className="size-4" />
          Botón de arrepentimiento
        </Link>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">1. Objeto y aceptación</h3>
          <p className="text-gray-600 leading-relaxed mb-3">
            Estos términos regulan el uso de la aplicación móvil {appName} (la &ldquo;App&rdquo;) y del sistema de
            turnos online publicado en nuestro sitio (el &ldquo;Turnero&rdquo;), operados por {companyName}, con
            domicilio en {companyCity} (&ldquo;nosotros&rdquo;, la &ldquo;Barbería&rdquo;). A través de ellos podés
            reservar y administrar turnos, ver el estado de las sucursales, acumular puntos, canjear premios,
            acceder a beneficios de comercios aliados y recibir notificaciones.
          </p>
          <p className="text-gray-600 leading-relaxed">
            Al crear una cuenta, reservar un turno o pagar una seña aceptás estos términos y nuestra{' '}
            <Link href="/privacidad" className="text-blue-600 hover:underline">Política de Privacidad</Link>.
            Si no estás de acuerdo, no uses la App ni el Turnero. Podemos actualizar estos términos; la versión
            vigente es la publicada en esta página, con su fecha de última actualización. Los cambios no se aplican
            retroactivamente a un turno ya reservado ni a una seña ya pagada: esa reserva se rige por los términos
            que estaban publicados cuando la hiciste.
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
              El Turnero web no necesita cuenta: alcanza con tu teléfono y tu nombre. Los datos que cargues ahí quedan asociados a tu ficha
              de cliente en la Barbería.
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
              Las sucursales pueden trabajar por orden de llegada, con turnos, o de las dos formas. La App y el Turnero muestran,
              para cada sucursal, qué modalidad está disponible.
            </li>
            <li>
              Un turno queda reservado cuando la App o el Turnero te lo confirman en pantalla. Si la sucursal exige seña, la reserva
              se confirma <strong>cuando el pago está acreditado</strong> y no antes (ver el punto 4). La Barbería puede limitar la
              cantidad de turnos activos por cliente y la anticipación mínima y máxima para reservar.
            </li>
            <li>
              Te pedimos que llegues a horario y registres tu llegada en la sucursal (en el kiosco o con el personal). Pasado el
              tiempo de tolerancia que defina la Barbería, el turno puede marcarse como ausencia y liberarse para otro cliente.
            </li>
            <li>
              <strong>Ventana de cancelación.</strong> Cada sucursal publica con cuánta anticipación se puede cancelar o reprogramar
              online; ese plazo se muestra antes de confirmar y en el link de gestión que te enviamos por WhatsApp. Dentro de la
              ventana, cancelar el turno no tiene costo. Fuera de la ventana, la cancelación online puede no estar disponible y,
              si habías pagado seña, se aplica lo previsto en el punto 4.
            </li>
            <li>
              La Barbería puede cancelar o reprogramar un turno por causas operativas (por ejemplo, ausencia del barbero o cierre
              imprevisto). En ese caso te avisamos por la App y/o WhatsApp, te ofrecemos un nuevo horario y, si habías pagado seña,
              te la devolvemos completa.
            </li>
            <li>
              Las ausencias reiteradas sin aviso pueden derivar en restricciones temporales para reservar.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">4. Seña para reservar</h3>
          <p className="text-gray-600 leading-relaxed mb-3">
            Algunas sucursales piden una <strong>seña</strong> para tomar el turno. Cuando corresponde, el monto exacto, el porcentaje
            del que sale y lo que queda a pagar en el local se muestran <strong>antes</strong> de que pagues, en la misma pantalla que
            el botón, junto con todo lo que dice este punto.
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>
              <strong>Qué es y a dónde va.</strong> La seña es un pago a cuenta del precio del servicio, no un cargo adicional:
              se imputa al precio total (art. 1060 del Código Civil y Comercial). Si el servicio sale $16.000 y la seña es de $8.000,
              el día del turno pagás los $8.000 restantes. Nunca te cobramos dos veces la misma parte.
            </li>
            <li>
              <strong>El horario se confirma con el pago acreditado.</strong> Mientras estás pagando, el horario sigue disponible para
              otras personas. Si alguien lo toma primero, el turno no se crea y{' '}
              <strong>te devolvemos la seña completa de forma automática</strong>, sin que tengas que pedirlo. Lo mismo si el pago se
              acredita pero por cualquier motivo no podemos crear el turno.
            </li>
            <li>
              <strong>Si cancelás con anticipación.</strong> Cancelando dentro de la ventana que publica la sucursal, la seña se te
              devuelve o te queda a favor para tu próximo turno, según lo que esa sucursal tenga configurado. Cuál de las dos cosas es,
              te lo decimos antes de pagar y también en el link de gestión del turno.
            </li>
            <li>
              <strong>Si cancelás tarde o no venís.</strong> Fuera de la ventana de cancelación, o si no te presentás, la seña puede
              quedar para el local: es tiempo que el barbero te reservó y ya no puede vender. Esto no se aplica mientras siga abierto
              tu derecho de arrepentimiento (punto 5), que está por encima de esta regla.
            </li>
            <li>
              <strong>Si cancelamos nosotros.</strong> Si la Barbería cancela el turno por cualquier motivo, te devolvemos la seña
              completa, siempre, sin importar la anticipación.
            </li>
            <li>
              <strong>Cómo se paga y cómo se devuelve.</strong> Los pagos los procesa Mercado Pago. Los datos de tu tarjeta nunca pasan
              por nuestros sistemas. Las devoluciones se hacen <strong>por el mismo medio de pago</strong> y pueden tardar algunos días
              hábiles en impactar en tu resumen o en tu cuenta, según el medio que hayas usado.
            </li>
            <li>
              <strong>Si no llegás a pagar.</strong> El link de pago vence a los pocos minutos. Si vence sin pagarse, no se cobra nada y
              el turno simplemente no se crea: podés volver a empezar cuando quieras.
            </li>
          </ul>
        </section>

        <section className="mb-8 rounded-2xl border-2 border-gray-900 p-5">
          <h3 className="text-lg font-semibold mb-3">
            5. Derecho de revocación (arrepentimiento)
          </h3>
          <p className="text-gray-700 leading-relaxed mb-3 font-medium">
            Si reservaste y pagaste desde la App o desde el Turnero web, tenés{' '}
            <strong>10 días corridos</strong> desde que hiciste el pago para arrepentirte y pedir que te
            devolvamos la totalidad de lo abonado, sin tener que dar ninguna explicación y sin ningún costo para vos.
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>
              Este derecho está previsto en los artículos 1110 a 1116 del Código Civil y Comercial de la Nación para los
              contratos celebrados a distancia, y en el art. 34 de la Ley 24.240. <strong>Es irrenunciable</strong>: ninguna
              cláusula nuestra, ni ninguna política de cancelación de una sucursal, puede limitarlo, restringirlo ni ponerle
              condiciones (Disposición 377/2026 de la Secretaría de Industria y Comercio).
            </li>
            <li>
              Para ejercerlo, entrá al{' '}
              <Link href="/arrepentimiento" className="font-semibold text-blue-600 hover:underline">
                Botón de arrepentimiento
              </Link>
              . No hace falta que tengas cuenta ni que inicies sesión. Al enviarlo te damos un{' '}
              <strong>código de identificación</strong> en pantalla y te respondemos{' '}
              <strong>dentro de las 24 horas</strong> por el mismo medio por el que nos escribiste.
            </li>
            <li>
              También podés comunicárnoslo por WhatsApp al número de la sucursal, por correo a{' '}
              <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline">{contactEmail}</a>, o
              acercándote al local. Cualquiera de esas vías es válida; el botón existe para que quede registro y número de
              seguimiento.
            </li>
            <li>
              La devolución se hace por el mismo medio de pago que usaste y sin cargo. El plazo de acreditación depende de
              tu banco o billetera.
            </li>
            <li>
              El derecho no se aplica al servicio que ya recibiste: si ya te atendieron, el contrato se cumplió. Sí se aplica
              a una seña de un turno que todavía no se prestó, aunque hayas cancelado tarde.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">6. Puntos, premios y beneficios</h3>
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
          <h3 className="text-lg font-semibold mb-3">7. Notificaciones y comunicaciones</h3>
          <p className="text-gray-600 leading-relaxed">
            La App puede enviarte notificaciones push con recordatorios de turno, cambios en tus reservas, premios disponibles y
            novedades de la Barbería. Podés activar o desactivar cada tipo de notificación desde la configuración de la App o del
            sistema operativo. Las comunicaciones de servicio (por ejemplo, el código de verificación, la confirmación de un turno,
            su cancelación o la respuesta a un pedido de arrepentimiento) pueden enviarse por WhatsApp al número con el que te
            registraste, y no se pueden desactivar mientras tengas una reserva activa: son parte del servicio.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">8. Datos personales y privacidad</h3>
          <p className="text-gray-600 leading-relaxed">
            Tratamos tus datos conforme a la Ley 25.326 de Protección de Datos Personales de la República Argentina y a nuestra{' '}
            <Link href="/privacidad" className="text-blue-600 hover:underline">Política de Privacidad</Link>, que forma parte de
            estos términos. Ahí explicamos qué datos recopilamos (nombre, teléfono, historial de visitas y turnos, puntos,
            dispositivo para notificaciones, y los datos mínimos de tus pagos), para qué los usamos, con qué proveedores los
            procesamos y cómo ejercer tus derechos de acceso, rectificación y supresión.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">9. Eliminación de la cuenta</h3>
          <p className="text-gray-600 leading-relaxed">
            Podés eliminar tu cuenta en cualquier momento desde la App, en <strong>Perfil → Eliminar cuenta</strong>. La eliminación
            borra tu usuario, tus dispositivos registrados, tus notificaciones y tus puntos y premios pendientes, y cancela los turnos
            futuros que tengas. El historial de visitas ya realizadas y los comprobantes de pago pueden conservarse de forma
            disociada de tu identidad por obligaciones contables y fiscales. Eliminar la cuenta no cancela ni pierde una seña
            pendiente de devolución: escribinos y la resolvemos igual. Si no podés acceder a la App, también podés pedir la baja
            por correo a{' '}
            <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline">{contactEmail}</a>.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">10. Uso permitido</h3>
          <p className="text-gray-600 leading-relaxed mb-3">Al usar la App o el Turnero te comprometés a no:</p>
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
          <h3 className="text-lg font-semibold mb-3">11. Disponibilidad y responsabilidad</h3>
          <p className="text-gray-600 leading-relaxed">
            La App y el Turnero se ofrecen &ldquo;tal cual&rdquo; y sin costo de uso. Hacemos lo razonable para que funcionen de
            manera continua, pero puede haber interrupciones por mantenimiento, fallas técnicas o causas ajenas (conectividad,
            proveedores de pago, el propio dispositivo). La información en tiempo real (ocupación, tiempos de espera, disponibilidad
            de turnos) es estimativa. En la medida permitida por la ley, la Barbería no responde por daños indirectos derivados del
            uso o la imposibilidad de uso. Nada de lo anterior limita los derechos que te reconoce la Ley 24.240 de Defensa del
            Consumidor.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">12. Propiedad intelectual</h3>
          <p className="text-gray-600 leading-relaxed">
            La App, su diseño, marcas, logotipos y contenidos son propiedad de {companyName} o de sus licenciantes y están protegidos
            por la normativa de propiedad intelectual. El uso de la App no te otorga ningún derecho sobre ellos más allá de la
            licencia personal, limitada y revocable para usarla según estos términos.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">13. Soporte, reclamos y defensa del consumidor</h3>
          <p className="text-gray-600 leading-relaxed">
            Para consultas, reclamos o ayuda podés escribirnos a{' '}
            <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline">{contactEmail}</a>, por WhatsApp al número
            de tu sucursal, o acercarte a cualquiera de nuestros locales. Los pedidos de arrepentimiento se responden dentro de las
            24 horas; el resto de los reclamos, en un plazo máximo de 10 días hábiles. Si no quedás conforme, podés iniciar un reclamo
            ante la autoridad de aplicación de Defensa del Consumidor de tu jurisdicción o a través del Servicio de Conciliación
            Previa en las Relaciones de Consumo (COPREC).
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">14. Ley aplicable y jurisdicción</h3>
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
            {' · '}
            <Link href="/arrepentimiento" className="hover:underline">Botón de arrepentimiento</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

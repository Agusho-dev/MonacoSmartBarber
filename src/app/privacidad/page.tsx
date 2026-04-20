export const metadata = {
  title: 'Política de Privacidad — Smart Barbershops',
  description: 'Política de privacidad de Smart Barbershops',
}

export default function PrivacidadPage() {
  const lastUpdated = '31 de marzo de 2026'
  const appName = 'Smart Barbershops'
  const contactEmail = 'ignacio.baldovino@hotmail.com'

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">{appName}</h1>
        <h2 className="text-xl text-gray-500 mb-1">Política de Privacidad</h2>
        <p className="text-sm text-gray-400 mb-10">Última actualización: {lastUpdated}</p>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">1. Introducción</h3>
          <p className="text-gray-600 leading-relaxed">
            {appName} (&ldquo;nosotros&rdquo;, &ldquo;nuestro&rdquo;) opera una plataforma de gestión para negocios de barbería y peluquería.
            Esta Política de Privacidad describe cómo recopilamos, usamos y protegemos la información personal
            cuando utilizás nuestra aplicación y los servicios de mensajería integrados, incluyendo WhatsApp Business API.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">2. Información que recopilamos</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>Nombre y número de teléfono de clientes del negocio</li>
            <li>Historial de visitas y servicios realizados</li>
            <li>Mensajes enviados y recibidos a través de WhatsApp Business API</li>
            <li>Información de contacto proporcionada voluntariamente</li>
            <li>Datos de uso de la plataforma por parte del personal del negocio</li>
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">3. Uso de la información</h3>
          <p className="text-gray-600 leading-relaxed mb-3">Utilizamos la información recopilada para:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>Gestionar la relación entre el negocio y sus clientes</li>
            <li>Enviar comunicaciones de servicio vía WhatsApp (confirmaciones, recordatorios, notificaciones)</li>
            <li>Administrar turnos, historial de visitas y fidelización</li>
            <li>Mejorar la calidad del servicio ofrecido</li>
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">4. WhatsApp Business API</h3>
          <p className="text-gray-600 leading-relaxed">
            Utilizamos la API oficial de WhatsApp Business (Meta Platforms, Inc.) para enviar y recibir mensajes.
            Los mensajes se procesan conforme a las{' '}
            <a href="https://www.whatsapp.com/legal/business-policy" target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline">
              Políticas de WhatsApp Business
            </a>{' '}
            y los{' '}
            <a href="https://www.facebook.com/terms" target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline">
              Términos de Servicio de Meta
            </a>.
            Solo enviamos mensajes a usuarios que han interactuado previamente con el negocio o han dado su consentimiento.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">5. Compartir información con terceros</h3>
          <p className="text-gray-600 leading-relaxed">
            No vendemos ni compartimos información personal con terceros con fines comerciales.
            Utilizamos los siguientes proveedores de servicio para operar la plataforma:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed mt-3">
            <li><strong>Supabase</strong> — almacenamiento de datos y autenticación</li>
            <li><strong>Meta (WhatsApp Business API)</strong> — mensajería</li>
            <li><strong>Vercel</strong> — hosting de la aplicación</li>
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">6. Retención de datos</h3>
          <p className="text-gray-600 leading-relaxed">
            Conservamos la información mientras la cuenta del negocio esté activa o según sea necesario para
            prestar los servicios. Los mensajes de WhatsApp se almacenan para permitir el historial de conversaciones.
            Podés solicitar la eliminación de tus datos en cualquier momento.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">7. Seguridad</h3>
          <p className="text-gray-600 leading-relaxed">
            Implementamos medidas de seguridad técnicas y organizativas para proteger la información personal,
            incluyendo cifrado en tránsito (HTTPS), control de acceso por roles y políticas de seguridad a nivel de base de datos (RLS).
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">8. Tus derechos</h3>
          <p className="text-gray-600 leading-relaxed mb-3">Tenés derecho a:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-2 leading-relaxed">
            <li>Acceder a tu información personal</li>
            <li>Solicitar la corrección de datos incorrectos</li>
            <li>Solicitar la eliminación de tus datos</li>
            <li>Oponerte al procesamiento de tu información</li>
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">9. Eliminación de datos</h3>
          <p className="text-gray-600 leading-relaxed">
            Para solicitar la eliminación de tus datos personales, enviá un correo a{' '}
            <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline">{contactEmail}</a>{' '}
            indicando tu nombre y número de teléfono. Procesaremos tu solicitud en un plazo máximo de 30 días.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3">10. Contacto</h3>
          <p className="text-gray-600 leading-relaxed">
            Si tenés preguntas sobre esta política de privacidad, podés contactarnos en:{' '}
            <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline">{contactEmail}</a>
          </p>
        </section>

        <div className="border-t pt-8 mt-8">
          <p className="text-sm text-gray-400 text-center">
            © {new Date().getFullYear()} {appName}. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </div>
  )
}

import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Clock, Instagram, Mail, MapPin, MessageCircle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { MONACO, mailto, whatsapp } from './contacto'

export const metadata: Metadata = {
  title: 'Soporte — Monaco Barber Studio',
  description:
    'Ayuda y contacto de la app Monaco de Monaco Barber Studio: WhatsApp, email, Instagram, sucursales y horarios, preguntas frecuentes, privacidad y eliminación de cuenta.',
  robots: { index: true, follow: true },
}

export const dynamic = 'force-dynamic'

/**
 * /soporte — la Support URL de App Store Connect y el "sitio web" de la ficha
 * de Google Play.
 *
 * Apple exige que la URL de soporte lleve a un medio de contacto real e
 * identificable con la app (guideline 1.5); hasta el 10/9/2026 no existía y la
 * raíz del dominio se titulaba "BarberOS". Esta página es la puerta pública de
 * Monaco: contacto, sucursales, preguntas frecuentes y los links legales.
 *
 * Las sucursales se leen de `branches` en cada request (con service role,
 * sólo columnas públicas: nombre, dirección, horario) para que un cambio de
 * dirección u horario se refleje sin deploy. Si la base no responde, se dibuja
 * la lista fija de abajo: una página de soporte que se cae junto con la base
 * es inútil justo cuando más la necesitan.
 *
 * `MONACO_ORG_ID` es la organización de la app (mono-org, ver
 * `AppConstants.organizationId`). La sucursal "Test" se excluye por slug.
 */
const MONACO_ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const SLUG_PRUEBA = 'test'

interface Sucursal {
  nombre: string
  direccion: string | null
  horario: string | null
}

/** Copia fija de lo que había en la base el 10/9/2026, por si la lectura falla. */
const SUCURSALES_FALLBACK: Sucursal[] = [
  { nombre: 'Caseros', direccion: 'Caseros 344', horario: 'Lunes a sábado de 09:00 a 21:00' },
  { nombre: 'Parana', direccion: 'Parana 419', horario: 'Lunes a sábado de 09:00 a 21:00' },
  { nombre: 'Rondeau', direccion: 'Rondeau 30', horario: 'Lunes a sábado de 09:00 a 21:00' },
]

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function hhmm(t: string | null): string | null {
  if (!t) return null
  const m = /^(\d{2}):(\d{2})/.exec(t)
  return m ? `${m[1]}:${m[2]}` : t
}

/**
 * "Lunes a sábado de 09:00 a 21:00" cuando los días son consecutivos; si no,
 * los enumera. `business_days` usa 0 = domingo (misma convención que el
 * turnero, NO ISODOW).
 */
function describirHorario(dias: number[] | null, abre: string | null, cierra: string | null): string | null {
  const a = hhmm(abre)
  const c = hhmm(cierra)
  if (!a || !c) return null
  const orden = [...new Set((dias ?? []).filter((d) => d >= 0 && d <= 6))].sort((x, y) => x - y)
  if (orden.length === 0) return `de ${a} a ${c}`
  const consecutivos = orden.every((d, i) => i === 0 || d === orden[i - 1] + 1)
  let cuando: string
  if (orden.length === 7) cuando = 'Todos los días'
  else if (consecutivos && orden.length > 1) {
    const primero = DIAS[orden[0]]
    cuando = `${primero.charAt(0).toUpperCase()}${primero.slice(1)} a ${DIAS[orden[orden.length - 1]]}`
  } else {
    const nombres = orden.map((d) => DIAS[d])
    cuando = `${nombres[0].charAt(0).toUpperCase()}${nombres[0].slice(1)}${nombres.length > 1 ? ', ' + nombres.slice(1).join(', ') : ''}`
  }
  return `${cuando} de ${a} a ${c}`
}

async function cargarSucursales(): Promise<Sucursal[]> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('branches')
      .select('name, slug, address, business_days, business_hours_open, business_hours_close')
      .eq('organization_id', MONACO_ORG_ID)
      .eq('is_active', true)
      .neq('slug', SLUG_PRUEBA)
      .order('name')
    if (error || !data || data.length === 0) return SUCURSALES_FALLBACK
    return data.map((b) => ({
      nombre: b.name,
      direccion: b.address?.trim() || null,
      horario: describirHorario(b.business_days, b.business_hours_open, b.business_hours_close),
    }))
  } catch {
    return SUCURSALES_FALLBACK
  }
}

const PREGUNTAS: { q: string; a: React.ReactNode }[] = [
  {
    q: '¿Cómo entro a la app?',
    a: (
      <>
        Con tu número de teléfono: te mandamos un código de 6 dígitos por WhatsApp y listo. También podés tocar
        &ldquo;Continuar con Google&rdquo; o &ldquo;Continuar con Apple&rdquo;; la primera vez te pedimos igual el
        teléfono, porque es lo que te identifica en el local. Si ya sos cliente de la barbería, tus visitas y tus
        puntos aparecen solos.
      </>
    ),
  },
  {
    q: 'No me llega el código',
    a: (
      <>
        Fijate que el número esté bien escrito (sin el 0 ni el 15) y que tengas WhatsApp activo en ese teléfono. El
        código vence a los 10 minutos: si pasó, tocá &ldquo;Reenviar código&rdquo;. Por seguridad sólo se pueden pedir
        3 códigos cada 10 minutos; si te pasaste, esperá y probá de nuevo. Si sigue sin llegar, escribinos por WhatsApp
        y lo resolvemos.
      </>
    ),
  },
  {
    q: '¿Cómo cancelo un turno?',
    a: (
      <>
        En la pestaña <strong>Turnos</strong>, abrí el turno y tocá <strong>Cancelar</strong>. Cada sucursal publica
        con cuánta anticipación se puede cancelar online; lo ves antes de confirmar y en el mismo turno. También podés
        cancelar desde el link que te llegó por WhatsApp al reservar. Si reservaste con seña, tenés 10 días corridos
        desde el pago para arrepentirte y que te devolvamos todo:{' '}
        <Link href="/arrepentimiento" className="text-blue-600 hover:underline">Botón de arrepentimiento</Link>.
      </>
    ),
  },
  {
    q: '¿Cómo uso mis puntos?',
    a: (
      <>
        Sumás puntos con cada visita cobrada. En <strong>Premios</strong> elegís lo que querés canjear y la app te da
        un código QR; lo mostrás en la tablet o al barbero cuando pagás y el beneficio se aplica en ese momento. Cada
        premio tiene su vencimiento y los puntos también: los ves en Perfil → Movimientos de puntos.
      </>
    ),
  },
  {
    q: '¿Cómo borro mi cuenta?',
    a: (
      <>
        Desde la app: Perfil → <strong>Eliminar mi cuenta</strong> → confirmar. Es inmediato y definitivo. Si ya no
        tenés la app, pedilo desde{' '}
        <Link href="/eliminar-cuenta" className="text-blue-600 hover:underline">monacobarber.vercel.app/eliminar-cuenta</Link>{' '}
        por email o WhatsApp; lo hacemos en un máximo de 5 días hábiles.
      </>
    ),
  },
]

export default async function SoportePage() {
  const sucursales = await cargarSucursales()
  const { appName, companyName, city, email, whatsappDisplay, instagramHandle, instagramUrl } = MONACO

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <div className="mx-auto max-w-2xl px-6 py-14">
        {/* Identidad */}
        <div className="flex items-center gap-4">
          <Image
            src="/logo-monaco.png"
            alt={companyName}
            width={64}
            height={64}
            className="size-16 rounded-2xl"
            priority
          />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">{companyName}</h1>
            <p className="text-sm text-gray-500">
              Soporte de la app {appName} · {city}
            </p>
          </div>
        </div>

        <p className="mt-6 text-lg leading-relaxed text-gray-600">
          Si algo no funciona, tenés una duda con un turno o querés hacer un reclamo, escribinos. Respondemos por
          el mismo medio por el que nos escribiste.
        </p>

        {/* Contacto */}
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <a
            href={whatsapp(`Hola, escribo desde la app ${appName}.`)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 text-base font-bold text-white"
          >
            <MessageCircle className="size-4" />
            WhatsApp {whatsappDisplay}
          </a>
          <a
            href={mailto(`Consulta desde la app ${appName}`)}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-gray-900 px-4 text-base font-bold text-gray-900"
          >
            <Mail className="size-4" />
            {email}
          </a>
        </div>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-gray-500">
          <Instagram className="size-4" />
          <a href={instagramUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {instagramHandle}
          </a>
        </p>

        {/* Sucursales */}
        <div className="mt-12 border-t pt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">Sucursales</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {sucursales.map((s) => (
              <li key={s.nombre} className="rounded-2xl bg-gray-100 p-4">
                <p className="text-base font-bold text-gray-900">{s.nombre}</p>
                <p className="mt-1.5 flex items-start gap-1.5 text-sm text-gray-600">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {s.direccion ?? (
                      <mark className="rounded bg-amber-100 px-1 text-amber-900">[DIRECCIÓN]</mark>
                    )}
                    , Córdoba
                  </span>
                </p>
                <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-600">
                  <Clock className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {s.horario ?? <mark className="rounded bg-amber-100 px-1 text-amber-900">[HORARIO]</mark>}
                  </span>
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-gray-500">
            Todas las sucursales atienden por orden de llegada; en las que toman turnos, podés reservar desde la app.
          </p>
        </div>

        {/* Preguntas frecuentes */}
        <div className="mt-12 border-t pt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">Preguntas frecuentes</h2>
          <div className="mt-4 space-y-3">
            {PREGUNTAS.map((p) => (
              <details key={p.q} className="group rounded-2xl border border-gray-200 p-4 open:border-gray-900">
                <summary className="cursor-pointer list-none text-base font-semibold text-gray-900">
                  {p.q}
                </summary>
                <p className="mt-2 text-[15px] leading-relaxed text-gray-600">{p.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* Legales */}
        <div className="mt-12 border-t pt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">Legales</h2>
          <ul className="mt-3 space-y-2 text-[15px]">
            <li>
              <Link href="/privacidad" className="text-blue-600 hover:underline">Política de privacidad</Link>
              <span className="text-gray-500"> — qué datos tratamos y tus derechos</span>
            </li>
            <li>
              <Link href="/terminos" className="text-blue-600 hover:underline">Términos y condiciones</Link>
              <span className="text-gray-500"> — turnos, seña, puntos y premios</span>
            </li>
            <li>
              <Link href="/eliminar-cuenta" className="text-blue-600 hover:underline">Eliminar tu cuenta</Link>
              <span className="text-gray-500"> — desde la app o pidiéndolo por acá</span>
            </li>
            <li>
              <Link href="/arrepentimiento" className="text-blue-600 hover:underline">Botón de arrepentimiento</Link>
              <span className="text-gray-500"> — devolución total de la seña dentro de los 10 días</span>
            </li>
          </ul>
        </div>

        <div className="mt-10 border-t pt-8">
          <p className="text-sm text-gray-400 text-center">
            © {new Date().getFullYear()} {companyName}. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </div>
  )
}

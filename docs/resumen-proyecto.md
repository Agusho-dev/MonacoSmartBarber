# Monaco Smart Barber — Resumen del Proyecto

## Contexto del Negocio

Monaco Smart Barber es una cadena de barberías en Argentina con **3 sucursales activas** y más de **10 barberos** en total. El proyecto busca construir un sistema integral que cubra dos frentes:

1. **App pública (cliente):** Los clientes pueden ver la ocupación en tiempo real de cada sucursal, acumular puntos por recurrencia y canjear premios. El objetivo es fidelización y diferenciación de marca bajo el concepto de "Smart Barber".
2. **Sistema interno (barbería):** Gestión operativa completa — cola de espera, trazabilidad de cortes por barbero, comisiones, CRM de clientes y estadísticas de negocio.

> **Nota:** La app pública (PWA) es un proyecto separado que se conectará a la misma base de datos. En esta fase se construyó exclusivamente el sistema interno + la pantalla de check-in.

---

## Decisiones de Producto

| Aspecto | Decisión |
|---|---|
| País/Moneda | Argentina (ARS) |
| Sucursales | 3 actuales, escalable. Nombre y ubicación configurables por el dueño |
| Barberos | 10+ en total, distribuidos entre sucursales |
| Idioma | Español (voseo argentino en la UI) |
| Branding | Negro, blanco, grises — estética minimalista premium |
| Servicios | Configurables desde el panel (CRUD completo) |
| Precios | Fijos por servicio (iguales para todos los barberos) |
| Comisiones | Porcentaje configurable por barbero (incluyendo 0%) |
| Registro de pagos | Se registra método: Efectivo / Tarjeta / Transferencia, con estadísticas |
| Cola de espera | FIFO sugerido, pero el barbero puede elegir cualquier cliente |
| Check-in | Cliente ingresa nombre + teléfono en una tablet en la barbería |
| Auth barberos | PIN numérico de 4 dígitos (optimizado para tablet) |
| Auth staff | Email + contraseña para dueño y administradores |
| Roles | Dueño, Administrador, Recepcionista, Barbero (no todos obligatorios) |
| Vista del dueño | Consolidada general + individual por sucursal |
| Recompensas | Estructura de puntos lista en la base de datos, definición exacta pendiente |

---

## Flujo Operativo Principal

```
┌─────────────────────────────────────────────────────────┐
│  1. TABLET EN LA BARBERÍA                                │
│  Cliente ingresa nombre + teléfono → entra a la COLA    │
│  Se le informa de la existencia de la app               │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  2. COLA EN TIEMPO REAL                                  │
│  Visible para todos los barberos de la sucursal          │
│  Orden FIFO sugerido, selección libre                   │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  3. BARBERO SELECCIONA CLIENTE                           │
│  Lo marca como "en atención" → timer de servicio         │
│  Al finalizar: elige método de pago + servicio           │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  4. REGISTRO AUTOMÁTICO                                  │
│  Se crea: visita, comisión, puntos de fidelización       │
│  Alimenta: estadísticas, CRM, dashboard del dueño        │
└─────────────────────────────────────────────────────────┘
                       ▼ (opcional, futuro)
┌─────────────────────────────────────────────────────────┐
│  5. APP PÚBLICA (PWA)                                    │
│  Cliente se registra con teléfono + contraseña           │
│  Ve: ocupación en tiempo real, puntos, premios           │
└─────────────────────────────────────────────────────────┘
```

**Dos niveles de identidad del cliente:**
- **No registrado en la app:** Existe por teléfono + nombre (check-in en tablet). Acumula historial pero no puede canjear premios.
- **Registrado en la app:** Teléfono verificado + contraseña. Puede ver y canjear premios. Esto previene fraude de identidad.

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS v4 |
| Componentes UI | shadcn/ui (estilo new-york, base neutral) |
| Base de datos | Supabase (PostgreSQL) |
| Realtime | Supabase Realtime (suscripción en `queue_entries`) |
| Auth | Supabase Auth (staff) + PIN cookie-based (barberos) |
| Estado global | Zustand (selector de sucursal) |
| Iconos | lucide-react |
| Deploy | Vercel |

---

## Estadísticas Definidas para el Sistema

### Ya implementadas (Fase 1)
- Clientes hoy / en cola / en atención / cortes completados
- Ingresos del día con desglose por método de pago
- Clientes nuevos del mes
- Clientes recurrentes (2+ visitas en 30 días)
- Clientes en riesgo (25-39 días sin visita)

### Planificadas para futuras fases
- **Mapa de calor de ocupación** por hora y día de la semana
- **Ingreso por barbero** (diario, semanal, mensual)
- **Tasa de retención por barbero** (clientes que vuelven al mismo barbero)
- **Client Lifetime Value (CLV)**
- **Frecuencia promedio de visita** por cliente
- **Segmentación automática:** Nuevo, Regular, VIP, En riesgo, Perdido
- **Tiempo promedio de servicio** por barbero
- **Tasa de utilización de sillas**
- **Proyección de ingresos** basada en tendencias
- **Tasa de redención de recompensas**
- **Ranking de barberos** (cortes, ingresos, retención)
- **Tendencias mensuales/estacionales**

---

## Modelo de Datos

### Tablas principales

| Tabla | Propósito |
|---|---|
| `branches` | Sucursales (nombre, dirección, teléfono, estado) |
| `staff` | Personal: dueño, admin, recepcionista, barberos (PIN, comisión %) |
| `clients` | Clientes identificados por teléfono (nombre, auth opcional) |
| `services` | Servicios configurables (nombre, precio, duración, sucursal) |
| `queue_entries` | Cola de espera (status: waiting → in_progress → completed/cancelled) |
| `visits` | Registro histórico de cada corte (monto, comisión, método de pago) |
| `rewards_config` | Configuración de puntos por sucursal |
| `client_points` | Balance de puntos por cliente |
| `point_transactions` | Historial de puntos ganados/canjeados |

### Automatizaciones (triggers)
- `updated_at` se actualiza automáticamente en todas las tablas relevantes
- Al completar una entrada de cola (`queue_entries` → `completed`), un trigger:
  - Crea el registro de `visit` con monto y comisión
  - Otorga puntos al cliente automáticamente
  - Actualiza el balance en `client_points`

### Vista
- `branch_occupancy`: estadísticas de ocupación en tiempo real por sucursal (clientes esperando, en atención, barberos disponibles)

### Row Level Security (RLS)
- Habilitado en todas las tablas
- Clientes y cola: lectura pública, escritura controlada
- Visitas y staff: solo accesible por personal autenticado
- Gestión (branches, services, rewards): solo owner/admin

---

## Estructura del Proyecto

```
src/
├── app/
│   ├── page.tsx                    → Landing (/)
│   ├── (auth)/login/               → Login staff (/login)
│   ├── (tablet)/checkin/           → Check-in tablet (/checkin)
│   ├── barbero/
│   │   ├── login/                  → Login PIN (/barbero/login)
│   │   └── cola/                   → Cola en tiempo real (/barbero/cola)
│   └── dashboard/
│       ├── page.tsx                → Overview (/dashboard)
│       ├── barberos/               → Gestión barberos
│       ├── servicios/              → Gestión servicios
│       ├── clientes/               → CRM
│       └── sucursales/             → Gestión sucursales
├── components/
│   ├── barber/                     → queue-panel, complete-service-dialog
│   ├── dashboard/                  → dashboard-shell (sidebar + header)
│   └── ui/                         → 16 componentes shadcn/ui
├── lib/
│   ├── actions/auth.ts             → Login email, login PIN, logout, sesión barbero
│   ├── actions/queue.ts            → Check-in, start/complete/cancel servicio
│   ├── supabase/                   → Clientes browser, server, middleware
│   ├── types/database.ts           → Tipos TypeScript del schema
│   └── format.ts                   → Formateo ARS y fechas argentinas
├── stores/branch-store.ts          → Zustand: selector de sucursal global
└── middleware.ts                    → Protección de rutas (auth + PIN session)
```

---

## Rutas del Sistema

| Ruta | Tipo | Protección | Descripción |
|---|---|---|---|
| `/` | Estática | Ninguna | Landing con accesos |
| `/checkin` | Estática | Ninguna | Kiosk de check-in (tablet) |
| `/barbero/login` | Estática | Ninguna | Login de barberos por PIN |
| `/barbero/cola` | Dinámica | Cookie `barber_session` | Cola de espera en tiempo real |
| `/login` | Estática | Ninguna | Login owner/admin |
| `/dashboard` | Dinámica | Supabase Auth (owner/admin) | Panel principal |
| `/dashboard/sucursales` | Dinámica | Supabase Auth | Gestión sucursales |
| `/dashboard/barberos` | Dinámica | Supabase Auth | Gestión barberos |
| `/dashboard/servicios` | Dinámica | Supabase Auth | Gestión servicios |
| `/dashboard/clientes` | Dinámica | Supabase Auth | CRM de clientes |

---

## Fases del Proyecto

| Fase | Estado | Descripción |
|---|---|---|
| **Fase 1 — Core** | ✅ Completada | Check-in, cola, gestión de barberos/servicios/sucursales, comisiones, dashboard base, CRM |
| **Fase 2 — Analytics** | Pendiente | Mapa de calor, estadísticas avanzadas, reportes exportables |
| **Fase 3 — App Pública** | Pendiente | PWA de ocupación en tiempo real, perfil del cliente |
| **Fase 4 — Fidelización** | Pendiente | Sistema de puntos completo, canje de premios, gamificación |
| **Fase 5 — Optimización** | Pendiente | Notificaciones WhatsApp, refinamiento UX, performance |

---

## Setup para Desarrollo

### Requisitos previos
- Node.js 18+
- Cuenta en Supabase (proyecto ya creado)

### Pasos

1. Clonar el repositorio
2. Copiar `.env.local.example` → `.env.local` y completar credenciales Supabase
3. Ejecutar `supabase/migrations/001_initial_schema.sql` en el editor SQL de Supabase
4. Habilitar Realtime en la tabla `queue_entries` (Supabase Dashboard → Database → Replication)
5. Crear usuario owner en Supabase Auth + insertar en tabla `staff`
6. `npm install && npm run dev`

---

*Documento generado durante la planificación y construcción de la Fase 1 del proyecto Monaco Smart Barber.*

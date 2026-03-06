# Monaco Smart Barber

Sistema inteligente de gestión para barberías con múltiples sucursales.

## Stack

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **UI:** shadcn/ui (tema oscuro: negro/blanco/gris)
- **Base de datos:** Supabase (PostgreSQL + Realtime + Auth + RLS)
- **Estado:** Zustand
- **Deploy:** Vercel

## Rutas

| Ruta | Descripción | Acceso |
|---|---|---|
| `/` | Landing page con accesos | Público |
| `/checkin` | Check-in de clientes (tablet) | Público |
| `/barbero/login` | Login de barberos (PIN) | Público |
| `/barbero/cola` | Cola de espera en tiempo real | Barbero (PIN) |
| `/login` | Login de administración | Público |
| `/dashboard` | Panel principal del dueño | Owner/Admin |
| `/dashboard/sucursales` | Gestión de sucursales | Owner/Admin |
| `/dashboard/barberos` | Gestión de barberos | Owner/Admin |
| `/dashboard/servicios` | Gestión de servicios | Owner/Admin |
| `/dashboard/clientes` | CRM de clientes | Owner/Admin |

## Setup

### 1. Variables de entorno

Copiar `.env.local.example` a `.env.local` y completar con las credenciales de Supabase:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
```

### 2. Base de datos

Ejecutar la migración SQL en el editor SQL de Supabase:

```
supabase/migrations/001_initial_schema.sql
```

Esto crea todas las tablas, enums, triggers, funciones y políticas RLS.

### 3. Habilitar Realtime

En Supabase Dashboard → Database → Replication, habilitar Realtime para la tabla `queue_entries`.

### 4. Crear usuario owner

Crear un usuario en Supabase Auth (email/password) y luego insertar su registro en la tabla `staff`:

```sql
INSERT INTO staff (auth_user_id, role, full_name, email)
VALUES ('uuid-del-usuario-auth', 'owner', 'Nombre del Dueño', 'email@ejemplo.com');
```

### 5. Desarrollo local

```bash
npm install
npm run dev
```

## Estructura del proyecto

```
src/
├── app/
│   ├── (auth)/login/          # Login staff (owner/admin)
│   ├── (tablet)/checkin/      # Check-in tablet
│   ├── barbero/               # Panel de barberos
│   │   ├── login/             # Login por PIN
│   │   └── cola/              # Cola en tiempo real
│   ├── dashboard/             # Dashboard administrativo
│   │   ├── barberos/
│   │   ├── clientes/
│   │   ├── servicios/
│   │   └── sucursales/
│   └── page.tsx               # Landing
├── components/
│   ├── barber/                # Componentes del panel barbero
│   ├── dashboard/             # Shell del dashboard
│   └── ui/                    # shadcn/ui
├── lib/
│   ├── actions/               # Server actions
│   ├── supabase/              # Clientes Supabase
│   ├── types/                 # Tipos TypeScript
│   ├── format.ts              # Formateo ARS/fechas
│   └── utils.ts               # Utilidades
├── stores/                    # Zustand stores
└── middleware.ts               # Auth middleware
```

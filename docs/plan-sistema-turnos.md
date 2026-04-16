# Plan: Sistema de Turnos (Appointment Booking System)

## Contexto

El sistema actual de Monaco Smart Barber opera exclusivamente con fila por orden de llegada (walk-in). Se necesita agregar un sistema de turnos híbrido que permita a los clientes agendar citas por anticipado, manteniendo la fila walk-in funcionando en paralelo como una cola separada. Esto involucra: página pública de reserva, configuración del dueño, integración con mensajería, y automatización de confirmaciones/recordatorios.

---

## Fase 1: Base de Datos

**Archivo:** `supabase/migrations/085_appointment_system.sql`

### Tabla `appointment_settings` (config por organización)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations | UNIQUE |
| `is_enabled` | BOOLEAN DEFAULT false | Habilita/deshabilita turnos |
| `appointment_hours_open` | TIME DEFAULT '09:00' | Inicio ventana de turnos |
| `appointment_hours_close` | TIME DEFAULT '20:00' | Fin ventana de turnos |
| `appointment_days` | INTEGER[] DEFAULT '{1,2,3,4,5,6}' | Días habilitados (0=Dom, 6=Sáb) |
| `slot_interval_minutes` | INTEGER DEFAULT 30 | Intervalo fijo de slots |
| `max_advance_days` | INTEGER DEFAULT 30 | Máximo días de anticipación |
| `no_show_tolerance_minutes` | INTEGER DEFAULT 15 | Tolerancia antes de marcar ausente |
| `cancellation_min_hours` | INTEGER DEFAULT 2 | Horas mínimas antes para cancelar |
| `confirmation_template_name` | TEXT NULL | Template WhatsApp confirmación |
| `reminder_template_name` | TEXT NULL | Template WhatsApp recordatorio |
| `reminder_hours_before` | INTEGER DEFAULT 24 | Horas antes para recordatorio |
| `payment_mode` | TEXT DEFAULT 'postpago' | 'prepago' \| 'postpago' (flag indicativo) |

### Tabla `appointment_staff` (staff habilitado para turnos)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations | |
| `staff_id` | UUID FK → staff | UNIQUE |
| `is_active` | BOOLEAN DEFAULT true | Recibe turnos |

Esto cumple el requisito de "configurar qué miembros del staff trabajan con turnos" sin afectar la tabla `staff`.

### Tabla `appointments` (turnos)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations | Tier 1 multi-tenant |
| `branch_id` | UUID FK → branches | |
| `client_id` | UUID FK → clients | |
| `barber_id` | UUID FK → staff NULL | NULL = auto-asignar |
| `service_id` | UUID FK → services NULL | |
| `appointment_date` | DATE | |
| `start_time` | TIME | |
| `end_time` | TIME | Calculado: start_time + duration |
| `duration_minutes` | INTEGER | Definido al momento de agendar |
| `status` | TEXT CHECK | 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show' |
| `source` | TEXT CHECK | 'public' (autogestionado), 'manual' (desde chat) |
| `cancellation_token` | TEXT UNIQUE NULL | Token para que el cliente cancele/gestione desde un link |
| `payment_flag` | TEXT NULL | 'prepago' \| 'postpago' |
| `queue_entry_id` | UUID FK → queue_entries NULL | Se llena al hacer check-in |
| `created_by_staff_id` | UUID FK → staff NULL | Para turnos manuales |
| `cancelled_at` | TIMESTAMPTZ NULL | |
| `cancelled_by` | TEXT NULL | 'client' \| 'staff' \| 'system' |
| `no_show_marked_at` | TIMESTAMPTZ NULL | |
| `no_show_marked_by` | UUID FK → staff NULL | |
| `notes` | TEXT NULL | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Constraint de no-solapamiento:** UNIQUE parcial en `(barber_id, appointment_date, start_time) WHERE status NOT IN ('cancelled', 'no_show') AND barber_id IS NOT NULL`

**Índices:**
- `(branch_id, appointment_date)` — consultas del día
- `(barber_id, appointment_date)` — slots por barbero
- `(client_id)` — turnos de un cliente
- `(status) WHERE status NOT IN ('cancelled','no_show','completed')` — turnos activos

### Alteraciones a tablas existentes

**`queue_entries`:** Agregar columnas:
- `is_appointment BOOLEAN DEFAULT false` — distingue fila de turnos vs walk-in
- `appointment_id UUID FK → appointments NULL` — referencia al turno

**`services`:** Agregar columna `booking_mode TEXT DEFAULT 'self_service' CHECK (booking_mode IN ('self_service', 'manual_only', 'both'))`:
- `self_service`: El cliente puede agendarlo desde la página pública
- `manual_only`: Solo agendable por staff desde el chat (ej: tintura, servicios que requieren consulta)
- `both`: Disponible en ambos canales

Actualizar tipo TypeScript de `availability` para incluir `'appointment'` y `'all'`.

### Modificación al RPC `assign_next_client`

Agregar `AND is_appointment = false` en ambas queries (preferido y fallback FIFO). Los turnos se atienden explícitamente por el barbero, no por FIFO automático.

### RLS Policies

```sql
-- appointment_settings: lectura/escritura por org
CREATE POLICY "appt_settings_org" ON appointment_settings FOR ALL
  USING (organization_id = get_user_org_id());

-- appointments: lectura/escritura por org
CREATE POLICY "appointments_org" ON appointments FOR ALL
  USING (organization_id = get_user_org_id());

-- appointment_staff: lectura/escritura por org
CREATE POLICY "appt_staff_org" ON appointment_staff FOR ALL
  USING (organization_id = get_user_org_id());
```

### Auto-crear etiqueta "Ausente"

```sql
INSERT INTO conversation_tags (organization_id, name, color, description)
SELECT o.id, 'Ausente', '#ef4444', 'Cliente no se presentó a su turno'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM conversation_tags ct WHERE ct.organization_id = o.id AND ct.name = 'Ausente'
);
```

### Realtime

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
```

---

## Fase 2: Server Actions

**Archivo nuevo:** `src/lib/actions/appointments.ts`

### Funciones principales

#### `getAppointmentSettings(orgId?: string)`
- Usa `getCurrentOrgId()` o recibe orgId (para página pública)
- Retorna `AppointmentSettings | null`

#### `updateAppointmentSettings(data: Partial<AppointmentSettings>)`
- Upsert en `appointment_settings` por org
- Solo dueño/admin

#### `getAppointmentStaff(orgId?: string)`
- Lista staff habilitado para turnos con join a `staff`
- Filtro por org

#### `toggleAppointmentStaff(staffId: string, isActive: boolean)`
- Upsert en `appointment_staff`

#### `getAvailableSlots(branchId, date, serviceId?, barberId?)`
Motor central de disponibilidad:
1. Cargar `appointment_settings` del org
2. Validar que `date` sea un día habilitado y dentro de `max_advance_days`
3. Cargar barberos de la sucursal que: estén activos, estén en `appointment_staff`, trabajen ese día (`staff_schedules`), no tengan excepción de ausencia (`staff_schedule_exceptions`)
4. Si `barberId` especificado, filtrar solo ese
5. Generar slots desde `appointment_hours_open` hasta `appointment_hours_close` en intervalos de `slot_interval_minutes`
6. Para cada barbero, para cada slot: verificar que no exista un appointment que solape (considerando `duration_minutes` del servicio seleccionado) con `status NOT IN ('cancelled','no_show')`
7. Filtrar slots que caigan fuera del horario del barbero
8. Retornar `{ barberId, barberName, slots: { time: string, available: boolean }[] }[]`

#### `createAppointment(data: CreateAppointmentInput)`
```typescript
interface CreateAppointmentInput {
  branchId: string
  clientPhone: string
  clientName: string
  barberId?: string | null      // null = auto-asignar
  serviceId: string
  appointmentDate: string       // YYYY-MM-DD
  startTime: string             // HH:MM
  durationMinutes: number       // definido por el usuario al agendar
  source: 'public' | 'manual'
  notes?: string
  createdByStaffId?: string
}
```
Flujo:
1. Buscar/crear cliente por phone + org (patrón de `checkinClient`)
2. Calcular `end_time = start_time + durationMinutes`
3. Si `barberId` es null: elegir barbero disponible con menos turnos ese día
4. Validar slot libre (constraint DB es backup)
5. Insert con `status = 'confirmed'` (auto-confirmado siempre)
6. Generar `cancellation_token` (nanoid/crypto) para link de gestión
7. Enviar mensaje de confirmación con datos del turno + link de gestión (via `scheduled_messages` o texto plano)
8. Programar recordatorio a `appointment_datetime - reminder_hours_before`
9. Retornar `{ success, appointment }`

#### `cancelAppointment(appointmentId: string, cancelledBy: 'client'|'staff'|'system')`
- Si `cancelledBy === 'client'`: valida `cancellation_min_hours` antes del turno
- Status → `cancelled`, `cancelled_at = now()`
- Cancelar mensajes programados pendientes
- Libera el slot

#### `cancelAppointmentByToken(token: string)`
- Busca appointment por `cancellation_token`
- Valida `cancellation_min_hours`
- Llama `cancelAppointment(..., 'client')`
- Usado desde la página pública de gestión de turno

#### `markNoShow(appointmentId: string, staffId: string)`
- Valida que pasó el `no_show_tolerance_minutes`
- Status → `no_show`
- Si tiene `queue_entry_id`, cancela esa entrada
- Busca conversación del cliente y aplica tag "Ausente"

#### `checkinAppointment(appointmentId: string)`
- Crea `queue_entry` con `is_appointment = true`, `appointment_id`, `barber_id`
- Actualiza appointment: `status = 'checked_in'`, `queue_entry_id`

#### `getAppointmentsForDate(branchId: string, date: string)`
- Retorna todos los turnos del día con joins a client, staff, service
- Usado en dashboard fila y panel barbero

#### `getAppointmentsForClient(clientId: string)`
- Turnos futuros y pasados de un cliente

#### `generateAvailabilityText(slots: AvailableSlot[])`
- Genera texto para el chat: "Tengo disponible el día X a las X"

### Cambios a `src/lib/actions/queue.ts`

- `attendNextClient()`: Ya usa RPC, la migración agrega `AND is_appointment = false` directamente al SQL. No requiere cambio en el action TS.
- `completeService()`: Si el `queue_entry` tiene `appointment_id`, actualizar `appointments.status = 'completed'`

### Tipos nuevos en `src/lib/types/database.ts`

```typescript
export type AppointmentStatus = 'confirmed' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'
export type AppointmentSource = 'public' | 'manual'

export interface AppointmentSettings { /* campos de la tabla */ }
export interface Appointment { /* campos + relaciones opcionales */ }
export interface AppointmentStaff { id: string; organization_id: string; staff_id: string; is_active: boolean }
```

Actualizar `ServiceAvailability` a: `'checkin' | 'upsell' | 'both' | 'appointment' | 'all'`

---

## Fase 3: Página Pública de Turnos

**Ruta:** `/src/app/turnos/[slug]/`

```
src/app/turnos/[slug]/
  page.tsx                    -- Server: resuelve org por slug, carga settings + branches
  turnos-client.tsx           -- Client: wizard multi-paso
  components/
    branch-selector.tsx       -- Paso 1: elegir sucursal
    service-selector.tsx      -- Paso 2: elegir servicio (availability incluye 'appointment'|'all')
    barber-selector.tsx       -- Paso 3: elegir barbero o "cualquier disponible"
    date-picker.tsx           -- Paso 4: calendario (respeta appointment_days + max_advance_days)
    time-slot-grid.tsx        -- Paso 5: grilla de horarios disponibles
    client-form.tsx           -- Paso 6: nombre + teléfono
    booking-summary.tsx       -- Paso 7: resumen + confirmar
    booking-success.tsx       -- Paso 8: confirmación visual
```

**`page.tsx`**: Resuelve org via slug (patrón existente en `org.ts: selectOrganizationBySlug`). Usa `createAdminClient()` (sin auth). Carga branches activas y `appointment_settings`. Si turnos no habilitados → mensaje informativo.

**`turnos-client.tsx`**: Wizard controlado por estado local. Cada paso llama server actions (ej: `getAvailableSlots`) para cargar datos dinámicamente. Solo muestra servicios con `booking_mode IN ('self_service', 'both')`. Al final llama `createAppointment` con `source: 'public'`.

### Página de gestión de turno (cancelación por cliente)

**Ruta:** `/src/app/turnos/gestionar/[token]/`
- `page.tsx` — Server: busca appointment por token, muestra datos
- `gestionar-client.tsx` — Client: muestra resumen del turno, botón "Cancelar turno"
- Valida `cancellation_min_hours` y muestra mensaje si ya no se puede cancelar
- Patrón similar a la review page (`src/app/review/[token]`)

---

## Fase 4: Dashboard — Configuración y Visualización

### 4.1 Configuración de Turnos

**Ruta:** `/src/app/dashboard/configuracion/turnos/`
- `page.tsx` — Server: carga `appointment_settings` y staff
- `turnos-config-client.tsx` — Formulario con todos los campos de settings
- Sección para toggle staff habilitados (`appointment_staff`)

### 4.2 Tab "Turnos" en Fila (Dashboard)

**Modificar:** `src/app/dashboard/fila/fila-client.tsx`
- Agregar `Tabs` de shadcn con "Fila" (contenido existente) y "Turnos del día"
- El tab "Turnos" muestra lista de appointments del día con:
  - Hora, cliente, servicio, barbero, estado
  - Acciones: "Registrar llegada", "Marcar ausente", "Cancelar"

**Componente nuevo:** `src/app/dashboard/fila/appointment-list.tsx`

### 4.3 Tab "Turnos" en Panel Barbero

**Modificar:** `src/components/barber/queue-panel.tsx`
- Agregar tab/sección mostrando turnos del barbero para hoy
- Acciones: "Atender" (start service), "Ausente" (tras tolerancia)

**Componente nuevo:** `src/components/barber/appointment-section.tsx`

**Modificar:** `src/app/barbero/fila/page.tsx`
- Cargar appointments del día para el barbero y pasarlos al `QueuePanel`

---

## Fase 5: Integración con Mensajería

### 5.1 Componente reutilizable de grilla

```
src/components/appointments/
  appointment-grid-dialog.tsx   -- Dialog principal
  slot-grid.tsx                 -- Grilla visual de horarios
  date-selector.tsx             -- Selector de fecha
```

### 5.2 Integración en Chat

**Modificar:** `src/app/dashboard/mensajeria/components/inbox/chat-view.tsx`
- Agregar botón `CalendarPlus` (lucide-react) en la zona de input/header
- Al hacer click: abre `AppointmentGridDialog` con el cliente de la conversación pre-llenado
- **Modo "sugerir"**: Staff selecciona slot → genera texto "Tengo disponible el día X a las X" → se inserta en el textarea del chat. El slot NO se reserva.
- **Modo "agendar"**: Staff selecciona slot + servicio → click "Crear turno" → llama `createAppointment(source: 'manual')` → envía mensaje de confirmación automáticamente

---

## Fase 6: Automatización

### 6.1 Mensaje de Confirmación y Recordatorio

Los turnos se auto-confirman al crearse (no hay paso de confirmación por parte del cliente).

Dentro de `createAppointment`:
1. Si `confirmation_template_name` existe → enviar template WhatsApp con datos del turno + link de gestión `/turnos/gestionar/[token]`
2. Si no hay template → enviar texto plano: "Tu turno para [servicio] el [fecha] a las [hora] en [sucursal] fue confirmado. Podés gestionar tu turno aquí: [link]"
3. Calcular `reminderAt = appointmentDateTime - reminderHoursBefore` → insertar en `scheduled_messages`
4. Al cancelar un turno → cancelar mensajes programados pendientes (recordatorio)

### 6.2 Cron de Check-in Automático

**Archivo nuevo:** `src/app/api/cron/process-appointments/route.ts`

Ejecuta cada minuto:
1. Query appointments: `status = 'confirmed'`, `appointment_date = hoy`, `start_time <= ahora`, `queue_entry_id IS NULL`
2. Para cada uno: crear `queue_entry` con `is_appointment = true`
3. Actualizar appointment con `queue_entry_id` y `status = 'checked_in'`

### 6.3 No-show

Manual por parte del staff. El botón "Marcar Ausente" se habilita después de `start_time + no_show_tolerance_minutes`. Al marcar:
- `status = 'no_show'`
- Cancela `queue_entry` si existe
- Aplica tag "Ausente" a la conversación del cliente

---

## Orden de Implementación

| # | Fase | Dependencias | Archivos principales |
|---|---|---|---|
| 1 | Migración DB + Tipos | Ninguna | `085_appointment_system.sql`, `database.ts` |
| 2 | Server Actions core | Fase 1 | `appointments.ts`, cambios en `queue.ts` |
| 3 | Página pública + gestión | Fases 1-2 | `src/app/turnos/[slug]/*`, `src/app/turnos/gestionar/[token]/*` |
| 4 | Dashboard config + tabs fila | Fases 1-2 | Config turnos, `fila-client.tsx`, `queue-panel.tsx` |
| 5 | Mensajería | Fases 1-2 | `appointment-grid-dialog.tsx`, `chat-view.tsx` |
| 6 | Automatización | Fases 1-5 | Cron endpoint, scheduled messages |

---

## Verificación

1. **Migración**: `supabase db push` sin errores, tablas creadas
2. **Slots**: Crear staff con schedule → verificar que `getAvailableSlots` retorna slots correctos
3. **Booking público**: Navegar a `/turnos/[slug]` → completar wizard → verificar appointment en DB
4. **Dashboard**: Ver turnos del día en tab "Turnos" de fila → check-in, cancelar, marcar ausente
5. **Mensajería**: Abrir chat → click grilla → seleccionar slot → verificar texto insertado / turno creado
6. **Cron**: Crear turno confirmado para "ahora" → esperar cron → verificar queue_entry creada
7. **Walk-in no afectado**: Check-in por tablet sigue funcionando igual, `assign_next_client` ignora entries de turnos

# Auditoria Completa: Sistema de Fila - Monaco Smart Barber

## Contexto

Auditoría del sistema de fila (queue) desde la perspectiva de process engineering. El objetivo es documentar el flujo completo end-to-end: desde que un cliente llega al kiosk de check-in hasta que el barbero finaliza el corte y se registra la visita.

---

## Diagrama de Flujo Completo

```
CLIENTE LLEGA AL LOCAL
        │
        ▼
┌─────────────────────┐
│   KIOSK (TABLET)    │
│  /(tablet)/checkin   │
│                     │
│ 1. Seleccionar      │
│    sucursal         │
│ 2. Identificarse:   │
│    • Face scan      │
│    • Teléfono       │
│    • "Soy Nuevo"    │
│ 3. Elegir servicio  │
│ 4. ¿Cómo querés    │
│    atenderte?       │
│    ┌──────┬────────┐│
│    │MENOR │ ELEGIR ││
│    │ESPERA│BARBERO ││
│    └──┬───┴───┬────┘│
└───────┼───────┼─────┘
        │       │
        ▼       ▼
  barber_id   barber_id
  = NULL      = UUID
  is_dynamic  is_dynamic
  = true      = false
        │       │
        └───┬───┘
            ▼
┌─────────────────────────────────────────────┐
│         INSERT → queue_entries              │
│                                             │
│  status: 'waiting'                          │
│  position: next_queue_position(branch_id)   │
│  checked_in_at: now()                       │
│  client_id, branch_id, service_id           │
│  organization_id (auto via trigger)         │
│                                             │
│  Unique constraint:                         │
│  (client_id, branch_id) WHERE status        │
│  IN ('waiting','in_progress')               │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
         REALTIME broadcast
         a todos los paneles
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│BARBERO 1│ │BARBERO 2│ │  TV     │
│/barbero │ │/barbero │ │  /tv    │
│/fila    │ │/fila    │ │         │
└────┬────┘ └─────────┘ └─────────┘
     │
     │ Si is_dynamic=true:
     │ assignDynamicBarbers() recalcula
     │ en el cliente (frontend) a qué
     │ barbero se le muestra el turno
     │
     ▼
┌─────────────────────────────────────────────┐
│     BARBERO PRESIONA "ATENDER"              │
│     startService(entryId, barberId)         │
│                                             │
│  UPDATE queue_entries SET                   │
│    status = 'in_progress'                   │
│    barber_id = barberId                     │
│    started_at = now()                       │
│    is_dynamic = false                       │
│  WHERE id = entryId AND status = 'waiting'  │
│                                             │
│  → NO dispara trigger                       │
│  → UI muestra timer activo                  │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│    BARBERO PRESIONA "FINALIZAR SERVICIO"    │
│    completeService(entryId, paymentMethod,  │
│      serviceId, isRewardClaim, ...)         │
│                                             │
│  PASO 1: UPDATE queue_entries SET           │
│    status = 'completed'                     │
│    completed_at = now()                     │
│  WHERE id = entryId                         │
│    AND status = 'in_progress'               │
│                                             │
│  PASO 2: TRIGGER on_queue_completed()       │
│    → INSERT visits (amount=0 placeholder)   │
│    → INSERT client_points (puntos ganados)  │
│    → INSERT point_transactions (earned)     │
│                                             │
│  PASO 3: Server action enriquece visita     │
│    → Calcula monto total (servicios +       │
│      extras + productos)                    │
│    → Resuelve comisión (4 niveles prioridad)│
│    → UPDATE visits con datos finales        │
│    → Si redención puntos: deducir           │
│    → Auto-start break ghost si corresponde  │
│    → Programar mensajes post-servicio       │
└─────────────────────────────────────────────┘
```

---

## Archivos Críticos

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/app/(tablet)/checkin/page.tsx` | UI del kiosk (~2300 líneas, todo en un archivo) |
| `src/lib/actions/queue.ts` | Server actions: checkinClient, startService, completeService, cancelQueueEntry, reassignBarber, updateQueueOrder, createBreakEntry |
| `src/lib/actions/kiosk.ts` | getCheckinData() - carga datos iniciales para el kiosk |
| `src/lib/barber-utils.ts` | assignDynamicBarbers() - algoritmo "menor espera" |
| `src/components/barber/queue-panel.tsx` | Panel del barbero - UI + realtime subscriptions |
| `src/components/barber/complete-service-dialog.tsx` | Dialog para finalizar servicio (servicios, pago, notas) |
| `src/lib/actions/breaks.ts` | Gestión de descansos (request, approve, complete) |
| `supabase/migrations/001_initial_schema.sql` | Esquema base + trigger on_queue_completed |

---

## Detalle de Cada Etapa

### 1. CHECK-IN (Kiosk)

**Ruta:** `/(tablet)/checkin`

**Steps del wizard:**
1. `branch` → Selección de sucursal
2. `home` → Pantalla principal (Ingresar / Soy Nuevo / Soy Barbero)
3. `face_scan` → Reconocimiento facial (opcional)
4. `phone` → Ingreso de teléfono (10 dígitos, código `0000000000` = niño virtual)
5. `name` → Confirmación/ingreso de nombre
6. `face_enroll` → Captura facial para futuros check-ins (opcional, solo nuevos)
7. `service_selection` → Elegir servicio
8. `barber` → **Decisión clave**: Menor Espera vs Elegir Barbero
9. `success` → Confirmación con posición en fila
10. `manage_turn` → Si ya tenía turno activo

**Datos escritos a queue_entries:**
```typescript
{
  branch_id: UUID,
  client_id: UUID (encontrado o creado),
  barber_id: UUID | null,        // null = menor espera
  service_id: UUID | null,
  status: 'waiting',
  position: next_queue_position(), // MAX(position)+1 del día
  is_dynamic: !barberId,          // true = menor espera
  is_break: false,
  checked_in_at: now(),
  organization_id: auto (trigger)
}
```

**Protección contra duplicados:** Unique index parcial `(client_id, branch_id) WHERE status IN ('waiting','in_progress')`. Si viola constraint → retorna posición existente.

**Pantalla de decisión (barber step):**
```
┌─────────────────────────────────────────┐
│   ¿Cómo querés atenderte?              │
│   Elegí una opción para continuar       │
├─────────────────────────────────────────┤
│                                         │
│  ⚡ MENOR ESPERA (Recomendada)          │
│  Te asignamos al barbero con menos fila │
│  [Indicador disponibilidad 1-4 sillas]  │
│                                         │
│  👤 ELEGIR BARBERO (Secundaria)         │
│  ¿Tenés preferencia? Elegí con quién    │
│  atenderte                              │
│                                         │
└─────────────────────────────────────────┘
```

- **Menor Espera** → `onSelect(null)` → `barber_id = NULL`, `is_dynamic = true`
- **Elegir Barbero** → Abre dialog con grilla de barberos → `barber_id = UUID`, `is_dynamic = false`

---

### 2. ALGORITMO "MENOR ESPERA" (assignDynamicBarbers)

**Ubicación:** `src/lib/barber-utils.ts`
**Ejecuta:** En el frontend (useMemo) cada vez que cambia la cola

**Algoritmo de asignación:**
1. Filtrar barberos elegibles (no ocultos, no bloqueados por fin de turno, con clock-in)
2. Calcular "carga" por barbero = entries en waiting + in_progress (excluye breaks)
3. Penalización cooldown: si barbero terminó hace <60s, +1 a su carga
4. Ordenar por:
   - **Menor carga** (primary)
   - **Menos servicios hoy** (tiebreaker 1)
   - **Mayor tiempo idle** (tiebreaker 2)
   - **ID alfabético** (tiebreaker 3)
5. Asignar al mejor barbero → incrementar su carga → repetir para siguiente sin asignar

**Importante:** Esta asignación es CLIENT-SIDE (visual). El `barber_id` en DB sigue siendo NULL hasta que el barbero presiona "Atender" y `startService()` lo setea definitivamente.

**Factores de exclusión de barberos:**
- `hidden_from_checkin = true` → excluido
- No tiene clock-in hoy (último attendance_log es clock_out) → excluido
- Bloqueado por fin de turno (margen de 35 min antes de que termine su horario) → excluido

---

### 3. PANEL DEL BARBERO

**Ruta:** `/barbero/fila`
**Componente principal:** `queue-panel.tsx`

**Autenticación:** PIN → cookie `barber_session` (no usa Supabase Auth)

**Realtime subscriptions en:**
- `queue_entries` → refetch cola completa
- `staff` → cambios de disponibilidad/hidden
- `break_requests` → estado de solicitudes de descanso
- `attendance_logs` → clock in/out

**Fallback polling:** cada 30 segundos via `useVisibilityRefresh()`

**Vista del barbero:**
- **Mi cola** (entries asignadas a mí o dinámicamente asignadas, status=waiting)
- **En atención** (mi entry in_progress, con timer de duración)
- **Cola general** (todos los waiting de la sucursal)

**Acciones disponibles:**
| Acción | Server Action | Cambio en DB |
|--------|---------------|--------------|
| Atender | `startService()` | status→in_progress, barber_id, started_at, is_dynamic=false |
| Finalizar | `completeService()` | status→completed, completed_at + trigger crea visit |
| Cancelar/No-show | `cancelQueueEntry()` | status→cancelled |
| Reasignar | `reassignBarber()` | barber_id, is_dynamic (solo si status=waiting) |
| Reordenar (drag) | `updateQueueOrder()` | position, barber_id (batch RPC) |
| Ocultar del check-in | toggle hidden_from_checkin | staff.hidden_from_checkin |
| Solicitar descanso | `requestBreak()` | break_requests.status=pending |

**Alerta de idle:** Si barbero no tiene entry in_progress y hay clientes waiting, suena beep cada 3s después de `nextClientAlertMinutes` (default 5 min).

---

### 4. COMPLETAR SERVICIO (completeService)

**UI Flow:**
1. Barbero presiona "Finalizar Servicio" en su entry activa
2. Se abre `CompleteServiceDialog`:
   - **Step 1:** Seleccionar servicio principal, servicios extra, productos, notas, fotos
   - **Step 2:** Seleccionar método de pago (efectivo/tarjeta/transferencia/puntos)
3. Submit → llama `completeService()` server action

**Flujo del Server Action (10 pasos):**

1. **Marcar completed** → `queue_entries.status = 'completed'`, `completed_at = now()`
2. **Trigger DB** → `on_queue_completed()` dispara automáticamente:
   - Crea `visits` con `amount=0` (placeholder)
   - Lee `rewards_config.is_active` y `points_per_visit`
   - Si rewards activo: INSERT/UPSERT `client_points` + INSERT `point_transactions(type='earned')`
3. **Fetch visit** creada por trigger via `queue_entry_id`
4. **Calcular monto** sumando precios de servicio principal + extras
5. **Resolver comisión** (jerarquía de 4 niveles de prioridad):
   1. `staff_service_commissions.commission_pct` (override específico barbero+servicio)
   2. `services.default_commission_pct` (default del servicio)
   3. `salary_configs.commission_pct` (config salarial del barbero)
   4. `staff.commission_pct` (fallback legacy del barbero)
6. **Procesar productos** si hay → via `processProductSales()` de `actions/sales.ts`
7. **Update visit** con: `amount`, `commission_amount`, `payment_method`, `service_id`, `extra_services`, `payment_account_id`
8. **Redimir puntos** si `isRewardClaim=true`:
   - Deducir de `client_points.points_balance`
   - Incrementar `client_points.total_redeemed`
   - Insertar `point_transactions(type='redeemed')`
9. **Auto-start break** si hay ghost entry con `is_break=true` y `status='waiting'` para este barbero, y no hay clientes reales esperando antes
10. **Programar mensajes post-servicio**: busca `auto_reply_rules` y `automation_workflows` con `trigger_type='post_service'` → inserta en `scheduled_messages`

---

### 5. SISTEMA DE DESCANSOS (BREAKS)

**Flujo completo:**

```
BARBERO                    ADMIN/MANAGER              BASE DE DATOS
   │                            │                          │
   │ requestBreak()             │                          │
   ├───────────────────────────►│                          │
   │                            │  break_requests          │
   │                            │  status='pending'        │
   │                            ├─────────────────────────►│
   │                            │                          │
   │                            │ approveBreak(            │
   │                            │   requestId,             │
   │                            │   cutsBeforeBreak)       │
   │                            │                          │
   │                            │  1. break_requests       │
   │                            │     status='approved'    │
   │                            ├─────────────────────────►│
   │                            │                          │
   │                            │  2. queue_entries INSERT │
   │                            │     is_break=true        │
   │                            │     client_id=null       │
   │                            │     position=calculada   │
   │                            ├─────────────────────────►│
   │                            │                          │
   │ (ghost entry aparece       │                          │
   │  en "Mi cola" como         │                          │
   │  "Tu descanso")            │                          │
   │                            │                          │
   │ completeBreakRequest()     │                          │
   ├───────────────────────────►│                          │
   │                            │  queue_entries           │
   │                            │  status='completed'      │
   │                            │  (NO crea visit)         │
   │                            ├─────────────────────────►│
```

**Ghost entries de descanso:**
- Son `queue_entries` con `is_break=true`, `client_id=null`
- Posición basada en `cutsBeforeBreak` (cuántos clientes atender antes del descanso)
- Si barbero no tiene clientes esperando antes del break → auto-start inmediato
- Al completar un servicio (`completeService`), se verifica si el siguiente entry es un break y si ya no hay clientes antes → auto-start
- Los breaks NO crean visitas ni otorgan puntos (el trigger `on_queue_completed` solo actúa si `client_id IS NOT NULL`)

---

### 6. STATUS MACHINE

```
                    ┌──────────┐
         INSERT →   │ waiting  │
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              ▼                     ▼
     ┌────────────────┐    ┌───────────┐
     │  in_progress   │    │ cancelled │
     └───────┬────────┘    └───────────┘
             │                (terminal)
             ▼
     ┌────────────────┐
     │   completed    │
     └────────────────┘
        (terminal)
        → creates visit
        → awards points
```

**Valores posibles de status:** `'waiting'` | `'in_progress'` | `'completed'` | `'cancelled'`

**Transiciones válidas:**
| De | A | Acción | Server Action |
|----|---|--------|---------------|
| (nuevo) | waiting | Check-in | `checkinClient()` / `checkinClientByFace()` |
| waiting | in_progress | Barbero atiende | `startService()` |
| waiting | cancelled | No-show / cancelar | `cancelQueueEntry()` |
| waiting | waiting | Reasignar barbero | `reassignBarber()` (cambia barber_id, no status) |
| in_progress | completed | Finalizar servicio | `completeService()` |
| in_progress | cancelled | Cancelar en progreso | `cancelQueueEntry()` |

---

### 7. SEÑALES DE SUCURSAL (branch_signals)

**Tabla `branch_signals`** - Métricas de ocupación para la app móvil y TV:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `branch_id` | UUID PK | Sucursal |
| `queue_size` | INT | waiting + in_progress |
| `waiting_count` | INT | Solo waiting |
| `active_barbers` | INT | Con clock-in hoy |
| `available_barbers` | INT | Activos sin servicio |
| `eta_minutes` | INT | `waiting_count * 25` |
| `occupancy_level` | ENUM | sin_espera / baja / media / alta |
| `updated_at` | TIMESTAMPTZ | Última actualización |

**Niveles de ocupación:**
- `sin_espera`: Al menos 1 barbero disponible (available_barbers >= 1)
- `baja`: Todos ocupados pero nadie esperando (waiting_count = 0)
- `media`: Algunos esperando (waiting < 2 * active_barbers)
- `alta`: Cola larga (waiting >= 2 * active_barbers)

**Cálculo:** Via RPC `refresh_branch_signals_for_branch()`. NO se actualiza automáticamente con cada cambio de cola — requiere llamada explícita o cron.

---

### 8. TABLA visits (Resultado Final)

Cuando `queue_entries.status` cambia a `completed`, el trigger `on_queue_completed()` crea automáticamente un registro en `visits`:

**Campos iniciales (trigger):**
```sql
branch_id, client_id, barber_id, queue_entry_id,
amount = 0,  -- placeholder
commission_pct, commission_amount = 0,
started_at, completed_at,
organization_id
```

**Campos enriquecidos (server action):**
```sql
amount,              -- monto real calculado
commission_amount,   -- comisión real calculada
payment_method,      -- cash | card | transfer
service_id,          -- servicio principal
extra_services,      -- array de UUIDs extras
payment_account_id   -- cuenta de pago (transferencias)
```

---

### 9. SISTEMA DE PUNTOS (integrado en el flujo)

**Otorgamiento (automático en trigger):**
- Al completar servicio, `on_queue_completed()` verifica `rewards_config.is_active`
- Prioridad: `services.points_per_service` → `rewards_config.points_per_visit` → default 1
- UPSERT en `client_points(client_id, organization_id)`: incrementa `points_balance` y `total_earned`
- INSERT en `point_transactions(type='earned', visit_id)`

**Redención (manual en completeService):**
- Si `isRewardClaim=true`, el barbero marcó que el cliente canjea puntos
- Costo: `rewards_config.redemption_threshold` (típicamente 10 puntos)
- Decrementa `client_points.points_balance`, incrementa `total_redeemed`
- INSERT en `point_transactions(type='redeemed')`

---

## Hallazgos Clave para Process Engineering

### Arquitectura

1. **La asignación "menor espera" es client-side**: No se persiste en DB hasta que el barbero presiona "Atender". Si dos paneles de barbero están abiertos, cada uno calcula `assignDynamicBarbers()` de forma independiente — pueden mostrar asignaciones diferentes si tienen datos ligeramente desincronizados.

2. **No hay validación de concurrencia en startService**: Si dos barberos intentan atender el mismo cliente simultáneamente, el `WHERE status = 'waiting'` previene la duplicación en DB, pero el segundo barbero solo recibe un error genérico "Error al iniciar servicio".

3. **El trigger on_queue_completed es SECURITY INVOKER**: Como los barberos se autentican con PIN (no Supabase Auth), no hay sesión de usuario. Por eso toda la cadena usa `createAdminClient()` (service role) para evitar fallos de RLS.

### Métricas y Estimaciones

4. **branch_signals no se actualiza en tiempo real**: Depende de llamada manual a `refresh_branch_signals_for_branch()`. No hay trigger automático en queue_entries. La app móvil puede ver datos desactualizados.

5. **ETA hardcoded a 25 min**: La función `refresh_branch_signals_for_branch()` usa `waiting_count * 25` fijo. Existe `buildBarberAvgMinutes()` en `barber-utils.ts` que calcula promedios reales por barbero, pero solo se usa en el frontend del panel de barberos para display, no para el cálculo de ETA.

### Integridad de Datos

6. **Position es secuencial por día**: `next_queue_position()` calcula `MAX(position)+1` del día actual. El reordenamiento manual vía drag-and-drop (`updateQueueOrder`) puede crear gaps en la secuencia.

7. **Puntos se otorgan en el trigger, antes del monto real**: La transacción de puntos se crea cuando `on_queue_completed()` dispara (con `amount=0`). Luego el server action calcula el monto real y actualiza la visita, pero la transacción de puntos ya fue creada sin conocer el monto.

8. **Visit amount empieza en 0**: El trigger crea la visita con `amount=0`. Si el server action falla después del trigger (por ejemplo, error al calcular comisión), la visita queda con amount=0 en la DB.

### Flujo de Descansos

9. **Auto-start de breaks**: Cuando un barbero completa un servicio, `completeService()` verifica si hay un ghost entry de break pendiente. Si no hay clientes reales esperando con position menor al break, el break se auto-inicia. Esto es lógica de aplicación, no un trigger DB.

10. **Position del break**: Calculada como `position del último waiting del barbero + cutsBeforeBreak`. Si el barbero no tiene nadie esperando, el break se inicia inmediatamente.

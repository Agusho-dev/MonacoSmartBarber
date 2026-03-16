# Monaco Smart Barber — Guía técnica para Claude Code

## Descripción del proyecto

Sistema de gestión para barbería con dos componentes:
1. **MonacoSmartBarber** (este directorio): dashboard interno web en Next.js + Supabase
2. **Monaco-mobile** (`../Monaco-mobile`): app móvil Flutter para clientes

Ambos comparten el mismo Supabase project: `https://gzsfoqpxvnwmvngfoqqk.supabase.co`

---

## Stack tecnológico

| Componente | Tecnología |
|---|---|
| Dashboard web | Next.js 14 + TypeScript + Tailwind |
| Auth interna (staff) | Supabase Auth (email+password) |
| Base de datos | PostgreSQL vía Supabase |
| Realtime | Supabase Realtime (WebSocket) |
| Storage | Supabase Storage |
| Edge Functions | Deno (TypeScript) |
| App móvil | Flutter (iOS + Android) |

---

## Schema de base de datos (resumen)

### Tablas principales (sistema interno)
- `staff` — empleados con roles: owner, admin, receptionist, barber
- `branches` — sucursales físicas
- `services` — servicios ofrecidos (corte, afeitado, etc.)
- `queue_entries` — cola de atención en tiempo real
- `visits` — registro histórico de atenciones
- `attendance_logs` — asistencia del staff
- `branch_signals` — señales de ocupación por sucursal

### Tablas de clientes / fidelización
- `clients` — clientes identificados por teléfono
- `client_points` — puntos por sucursal (usa vista global `client_points_global`)
- `point_transactions` — historial de movimientos de puntos
- `reward_catalog` — catálogo de premios y canjes
- `client_rewards` — premios asignados a clientes (con QR de validación)
- `rewards_config` — config de puntos por visita por sucursal

### Tablas de reseñas
- `review_requests` — solicitudes de reseña post-visita
- `client_reviews` — reseñas enviadas (con category: high/improvement/low)
- `crm_cases` — casos de seguimiento para reseñas ≤2 estrellas

### Tablas nuevas (app móvil — agregadas en 030-035)
- `client_device_tokens` — tokens de dispositivo para push (v2)
- `client_notifications` — bandeja de notificaciones in-app
- `billboard_items` — cartelera comercial configurable

---

## Decisiones técnicas importantes

### Autenticación de clientes móviles (v1)
- **Sin OTP SMS** en v1 por decisión de producto.
- Estrategia: cada cliente tiene cuenta Supabase Auth con `email = {phone}@monaco.internal` y `password = device_secret`.
- `device_secret` = SHA256(device_id + 'monaco_salt_2026'), guardado en `flutter_secure_storage`.
- La **biometría** (Face ID / Touch ID) actúa como gate local en el dispositivo (no verifica en servidor).
- El **PIN** (4 dígitos, opcional) se guarda como hash en `flutter_secure_storage`.
- La Edge Function `client-auth` maneja registro/login sin OTP.
- **En v2**: agregar OTP via Twilio cuando esté habilitado en Supabase.

### Puntos (billetera global)
- `client_points` almacena saldo **por sucursal** (para compatibilidad con el sistema interno).
- La vista `client_points_global` agrega el saldo de todas las sucursales.
- La app móvil muestra el saldo global.
- La redención descuenta del bucket de mayor saldo (estrategia greedy).
- El sistema interno (dashboard) sigue viendo los puntos por sucursal.

### Notificaciones push (v1 → v2)
- **v1**: notificaciones solo in-app vía Supabase Realtime. Sin Firebase.
- **v2**: implementar FCM/APNs. La tabla `client_device_tokens` ya está lista.
- Los tokens se guardarían vía la Edge Function `client-auth` o una nueva `register-push-token`.

### Reseñas — Flujo por rating
| Rating | Acción |
|---|---|
| 5 ⭐ | Redirige a `branches.google_review_url` (si existe) o formulario interno |
| 3-4 ⭐ | Formulario interno con categorías de mejora |
| ≤2 ⭐ | Mensaje de contacto + crea `crm_cases` |

La función `submit_client_review` en la DB maneja toda la lógica.

### Catálogo de canjes por puntos
- Items del catálogo con `points_cost IS NOT NULL` son canjeables por puntos.
- La función `client_redeem_points(catalog_id, branch_id)` maneja la transacción atómica.
- El cliente genera un QR (via qrserver.com) que el staff valida con `redeem_reward_by_qr`.

### RLS — Separación staff / cliente
- La mayoría de policies eran staff-only. Las migraciones 030-035 agregan:
  - `clients_update_own`: cliente puede actualizar su propio registro
  - `visits_read_own_client`: cliente ve sus propias visitas (reemplaza `visits_read_all`)
  - `cn_client_*`: cliente lee y marca como leídas sus notificaciones
  - `cdt_client_own`: cliente gestiona sus tokens de dispositivo

---

## Convenciones de código

### Migraciones SQL
- Numeradas secuencialmente: `001_nombre.sql`, `002_nombre.sql`, etc.
- Siempre usar `IF NOT EXISTS` / `IF EXISTS` para idempotencia.
- No modificar datos existentes sin respaldo.
- Agregar comentarios en español.

### Estructura de migraciones
```
supabase/migrations/
  001_initial_schema.sql
  ...
  029_hidden_from_checkin.sql
  030_mobile_client_auth.sql       ← app móvil
  031_mobile_points_global.sql
  032_mobile_catalog_points.sql
  033_mobile_notifications.sql
  034_mobile_billboard.sql
  035_mobile_rls_fixes.sql
```

### Edge Functions
```
supabase/functions/
  client-auth/index.ts   ← única EF en v1
```

### Flutter (Monaco-mobile)
- Arquitectura: Clean Architecture (domain/data/presentation)
- Estado: Riverpod (Provider/AsyncNotifierProvider/StreamProvider)
- Navegación: go_router
- NO usar code generation (build_runner) para riverpod en v1
- Convención de providers: `*Provider` suffix

---

## Variables de entorno requeridas

### Supabase (dashboard web)
```env
NEXT_PUBLIC_SUPABASE_URL=https://gzsfoqpxvnwmvngfoqqk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...  # solo server-side
```

### Flutter (Monaco-mobile)
```dart
// En AppConstants:
static const supabaseUrl = 'https://gzsfoqpxvnwmvngfoqqk.supabase.co';
// La anon key se pasa via --dart-define en build:
// flutter build ios --dart-define=SUPABASE_ANON_KEY=...
```

### Edge Function (Supabase secrets)
```
SUPABASE_URL (automático)
SUPABASE_SERVICE_ROLE_KEY (automático)
```

---

## Checklist antes de cada deploy

### Sistema interno (MonacoSmartBarber)
- [ ] `flutter test` pasa sin errores (si aplica)
- [ ] Migraciones aplicadas con `supabase db push`
- [ ] RLS policies revisadas con `mcp__supabase__get_advisors`
- [ ] No hay cambios breaking en tablas usadas por la app móvil

### App móvil (Monaco-mobile)
- [ ] `flutter analyze` sin errores
- [ ] `flutter test` pasa
- [ ] Probado en simulador iOS y Android
- [ ] Flujo de auth funciona (primer uso + reapertura)
- [ ] Realtime conecta y recibe updates
- [ ] Reseñas → flujo correcto por rating

---

## Riesgos conocidos

1. **device_secret en reinstalación de app**: Si el usuario reinstala la app, pierde el device_secret. Actualmente se le pide el teléfono nuevamente y se crea un nuevo device_secret (sobrescribe la cuenta). Pendiente: mecanismo de recuperación (v2).

2. **Un cliente en múltiples dispositivos**: La tabla `client_device_tokens` usa `UNIQUE(client_id, device_id)`. Si el mismo cliente usa dos teléfonos, tendrá dos device_secrets diferentes y no puede loguear con el mismo. Pendiente: soporte multi-device (v2).

3. **visits_read_all eliminada**: La migración 035 eliminó esta policy y la reemplazó. Verificar que el sistema interno (que usaba `visits_read_all`) no esté roto. El dashboard web usa server-side rendering con service_role key, por lo que las policies de cliente no aplican.

4. **Billboard video**: El campo `video_url` existe en `billboard_items` pero la app v1 solo muestra imágenes. Video se implementará en v2.

---

## Pendientes v2

- [ ] Push notifications (FCM/APNs): implementar `send-push` Edge Function + registro de tokens en app
- [ ] OTP SMS para onboarding: habilitar Twilio en Supabase + migrar flujo de auth
- [ ] Multi-device support: permitir múltiples device_secrets por cliente
- [ ] Check-in remoto: cliente se agrega a la cola desde la app
- [ ] Historial de cortes con fotos
- [ ] Widget de video en billboard
- [ ] Notificaciones admin por reseñas negativas (vía edge function + push)

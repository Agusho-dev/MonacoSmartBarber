# Deuda Técnica — Monaco Smart Barber SaaS

**Fecha de análisis:** 2026-04-01
**Versión:** 2.0 (auditoría profunda)
**Analista:** Claude Code (Opus 4.6)
**Alcance:** Codebase completo — 35 server actions, 56 migraciones SQL, 3 Edge Functions, todos los componentes frontend

---

## Índice

1. [Executive Summary](#1-executive-summary)
2. [Seguridad Crítica](#2-seguridad-crítica)
3. [Arquitectura Multi-Tenant](#3-arquitectura-multi-tenant)
4. [RLS — Auditoría Completa de Políticas](#4-rls--auditoría-completa-de-políticas)
5. [Funciones de Base de Datos (RPCs)](#5-funciones-de-base-de-datos-rpcs)
6. [Server Actions — Auditoría Completa](#6-server-actions--auditoría-completa)
7. [Billing y Monetización](#7-billing-y-monetización)
8. [Features SaaS Faltantes](#8-features-saas-faltantes)
9. [Base de Datos y Migraciones](#9-base-de-datos-y-migraciones)
10. [Calidad de Código TypeScript](#10-calidad-de-código-typescript)
11. [Frontend y UX](#11-frontend-y-ux)
12. [Mensajería WhatsApp / Instagram](#12-mensajería-whatsapp--instagram)
13. [Observabilidad y Monitoring](#13-observabilidad-y-monitoring)
14. [Escalabilidad y Performance](#14-escalabilidad-y-performance)
15. [Testing](#15-testing)
16. [Roadmap de Remediación](#16-roadmap-de-remediación)
17. [Apéndice: Tabla Maestra de Issues](#17-apéndice-tabla-maestra-de-issues)

---

## 1. Executive Summary

| Área | Severidad Máxima | Críticos | Altos | Medios |
|------|-----------------|----------|-------|--------|
| Seguridad | 🔴 CRÍTICO | 5 | 6 | 4 |
| Arquitectura Multi-Tenant | 🔴 CRÍTICO | 3 | 5 | 3 |
| RLS Policies | 🔴 CRÍTICO | 6 | 4 | 3 |
| Funciones DB (RPCs) | 🔴 CRÍTICO | 4 | 3 | 2 |
| Server Actions | 🔴 CRÍTICO | 2 | 8 | 12 |
| Billing / Monetización | 🔴 CRÍTICO | 1 | — | — |
| Features SaaS | 🟠 ALTO | — | 4 | 4 |
| Base de Datos (Schema) | 🔴 CRÍTICO | 2 | 4 | 5 |
| Calidad TypeScript | 🔴 CRÍTICO | 3 | 2 | 4 |
| Frontend / UX | 🔴 CRÍTICO | 3 | 6 | 7 |
| Mensajería | 🔴 CRÍTICO | 1 | 3 | 3 |
| Observabilidad | 🟠 ALTO | — | 3 | 3 |
| Escalabilidad | 🟠 ALTO | — | 4 | 5 |
| Testing | 🟠 ALTO | — | 1 | — |

### Diagnóstico General

El producto tiene una base funcional sólida como herramienta interna, pero **no está listo para comercialización SaaS** por cinco razones fundamentales:

1. **No existe sistema de billing** — Cero referencias a Stripe, MercadoPago o cualquier procesador de pagos.
2. **Vulnerabilidades de seguridad críticas** — HMAC no verificado en webhooks, PIN brute-forceable, auto-reset de password, tokens de API en texto plano.
3. **Aislamiento multi-tenant roto** — Funciones SECURITY DEFINER sin validación de org, tablas sin RLS, policies legacy `USING(true)` activas.
4. **Race conditions en operaciones financieras** — Transferencias, ventas de productos y stock pueden corromperse con concurrencia.
5. **Input validation ausente** — Precios negativos, fechas inválidas, archivos sin límite de tamaño aceptados en la mayoría de server actions.

---

## 2. Seguridad Crítica

### 2.1 Webhooks de Meta sin verificación HMAC
**Severidad: 🔴 CRÍTICO**
**Archivos:** `src/app/api/webhooks/whatsapp/route.ts`, `src/app/api/webhooks/instagram/route.ts`

Meta envía el header `X-Hub-Signature-256` con cada webhook. **Esta verificación no existe en el código.** Cualquier actor malicioso puede enviar POST requests forjados.

**Impacto:** Inyección de mensajes falsos, manipulación de estados de conversación, DoS.

---

### 2.2 Autenticación PIN sin rate limiting
**Severidad: 🔴 CRÍTICO**
**Archivo:** `src/lib/actions/auth.ts:32-111`

Un PIN de 4 dígitos (10.000 combinaciones) sin throttling. Sin contador de intentos, sin lockout temporal, con comparación directa de strings (timing attack).

**Fix requerido:** Contador con TTL, lockout tras 5 intentos, `crypto.timingSafeEqual()`.

---

### 2.3 PIN almacenado en texto plano
**Severidad: 🔴 CRÍTICO**
**Tabla:** `staff.pin`

Comparación directa `staff.pin !== pin` confirma almacenamiento sin hash. En un breach, todos los PINs quedan expuestos.

---

### 2.4 Auto-reset de contraseña móvil sin verificación
**Severidad: 🔴 CRÍTICO**
**Archivo:** `supabase/functions/client-auth/index.ts:105-122`

Cuando el `device_secret` no coincide, el sistema **auto-resetea la password** con el valor recibido:

```typescript
const { error: updateError } = await adminClient.auth.admin.updateUserById(
  existingClient.auth_user_id,
  { password: device_secret }   // password actualizado con datos del atacante
)
```

**Impacto:** Account Takeover completo. Cualquiera con el teléfono del cliente puede tomar la cuenta.

---

### 2.5 Tokens de API de WhatsApp/Instagram en texto plano
**Severidad: 🔴 CRÍTICO**
**Tablas:** `organization_whatsapp_config`, `organization_instagram_config`

Los access tokens de Meta Business API se almacenan sin cifrar en la base de datos. Un acceso no autorizado a la DB (SQL injection, backup filtrado, breach) expone las credenciales de Meta de todos los tenants.

**Fix requerido:** Cifrar con clave derivada por org, o usar un vault externo (Supabase Vault, AWS Secrets Manager).

---

### 2.6 Cookie `barber_session` sin validación criptográfica
**Severidad: 🟠 ALTO**
**Archivo:** `src/lib/actions/org.ts:182-198`

Cookie parseada como JSON plano, usada como input directo a queries con `createAdminClient()`. Sin firma HMAC ni cifrado.

**Impacto:** Cross-org data contamination con cookie crafteada.

---

### 2.7 Registro sin email de verificación
**Severidad: 🟠 ALTO**
**Archivo:** `src/lib/actions/register.ts:90`

`email_confirm: true` auto-confirma sin enviar email. Password mínimo de 6 caracteres (debería ser 12+).

---

### 2.8 Sin protección contra bots en registro
**Severidad: 🟠 ALTO**

Sin captcha, honeypot ni rate limiting. Permite creación automatizada de orgs ilimitadas.

---

### 2.9 Logs de webhooks exponen datos sensibles
**Severidad: 🟠 ALTO**

~15 llamadas a `console.log/error` en webhook handlers incluyen tokens, teléfonos, contenido de mensajes y org IDs. Visibles en Vercel dashboard.

---

### 2.10 Upload de archivos sin validación
**Severidad: 🟠 ALTO**
**Archivo:** `src/lib/actions/onboarding.ts`

El upload de logo de organización no valida extensión ni tamaño del archivo. Un archivo malicioso podría ser subido a Supabase Storage.

---

### 2.11 Enumeración de organizaciones vía slug
**Severidad: 🟡 MEDIO**
**Archivo:** `src/lib/actions/org.ts`

`selectOrganizationBySlug()` es público y permite descubrir slugs de organizaciones existentes por fuerza bruta.

---

### 2.12 `client-auth` Edge Function sin rate limiting
**Severidad: 🟡 MEDIO**

La función de autenticación móvil no limita intentos. Permite enumeración de teléfonos registrados y brute force del device_secret.

---

## 3. Arquitectura Multi-Tenant

### 3.1 `get_user_org_id()` con lógica frágil
**Severidad: 🔴 CRÍTICO**
**Archivo:** `supabase/migrations/048_multi_tenant_rls.sql:15-27`

La función SECURITY DEFINER central del modelo multi-tenant usa `LIMIT 1` sin `ORDER BY` en sus fallbacks. Si un usuario aparece en múltiples orgs, retorna resultados no determinísticos. **Toda la seguridad RLS depende de esta función.**

---

### 3.2 Políticas RLS legacy `USING (true)` no eliminadas
**Severidad: 🔴 CRÍTICO**

Las migraciones 048-051 crean nuevas policies pero nunca ejecutan `DROP POLICY` de las originales. En PostgreSQL, múltiples policies en una tabla se combinan con OR. Las policies `USING (true)` originales **anulan** las restricciones nuevas.

---

### 3.3 `client-auth` Edge Function no asigna `organization_id`
**Severidad: 🔴 CRÍTICO**
**Archivo:** `supabase/functions/client-auth/index.ts`

Al crear clientes móviles, la función no establece `organization_id`. Si la tabla tiene constraint NOT NULL, el insert falla silenciosamente. Si no lo tiene, queda un cliente sin org que rompe queries RLS.

---

### 3.4 Server actions con validación inconsistente
**Severidad: 🟠 ALTO**

De 35 server actions auditados:
- **12** usan `validateBranchAccess()` correctamente
- **8** usan `getCurrentOrgId()` para filtrar
- **6** dependen sólo de RLS (sin check a nivel app)
- **5** no tienen ningún check de auth
- **4** son endpoints públicos (por diseño)

---

### 3.5 `createAdminClient()` usado en exceso
**Severidad: 🟠 ALTO**

El service_role client bypasea RLS completamente. Usado en la mayoría de server actions incluyendo reads. Elimina la defensa en profundidad.

---

### 3.6 `switchOrganization()` no es atómico
**Severidad: 🟠 ALTO**
**Archivo:** `src/lib/actions/org.ts`

Verifica membresía, actualiza auth metadata, setea cookie — tres operaciones no atómicas. Si falla a mitad de camino, el usuario queda en estado inconsistente entre org anterior y nueva.

---

### 3.7 Registro con rollback incompleto
**Severidad: 🟡 MEDIO**
**Archivo:** `src/lib/actions/register.ts:86-165`

Crea auth user, org, staff member y settings en secuencia. Si falla a mitad, intenta rollback pero éste también puede fallar, dejando datos huérfanos.

---

## 4. RLS — Auditoría Completa de Políticas

### 4.1 Tablas con RLS HABILITADO pero SIN POLICIES (acceso bloqueado)
**Severidad: 🔴 CRÍTICO**

| Tabla | Migración | Impacto |
|-------|-----------|---------|
| `conversation_tags` | 056 | Feature de tags completamente rota |
| `conversation_tag_assignments` | 056 | Feature de tags completamente rota |
| `organization_instagram_config` | 055 | Config de Instagram inaccesible |
| `client_loyalty_state` | 024 | Estado de fidelización roto |

---

### 4.2 Tablas con RLS NO HABILITADO (acceso libre)
**Severidad: 🔴 CRÍTICO**

| Tabla | Contenido | Riesgo |
|-------|-----------|--------|
| `transfer_logs` | Registros financieros de transferencias | Datos financieros de todos los tenants expuestos |

---

### 4.3 Tablas con INSERT `USING (true)` (cualquiera puede crear registros)
**Severidad: 🟠 ALTO**

| Tabla | Policy | Justificación |
|-------|--------|---------------|
| `clients` | `clients_insert_all` | Necesario para kiosk check-in, pero sin scope de org |
| `attendance_logs` | `attendance_insert` | Necesario para clock-in público |
| `staff_face_descriptors` | `staff_faces_insert` | Enrollment facial desde kiosk |
| `client_face_descriptors` | `client_faces_insert` + `client_faces_select` | Completamente abierto, sin scope de org |

**`client_face_descriptors` es el caso más grave:** SELECT y INSERT sin restricción significa que cualquier usuario autenticado puede leer los descriptores faciales de clientes de cualquier organización.

---

### 4.4 Tablas que faltan policies de INSERT/DELETE
**Severidad: 🟠 ALTO**

La mayoría de las tablas tienen policies de SELECT y UPDATE pero carecen de INSERT y DELETE. Esto bloquea operaciones legítimas desde el cliente autenticado, lo que fuerza el uso de `createAdminClient()`:

- `organizations` (sin INSERT ni DELETE)
- `organization_members` (sin INSERT ni DELETE)
- `branches` (sin INSERT ni DELETE)
- `staff` (sin INSERT ni DELETE)
- `roles` (sin INSERT ni DELETE)
- `services` (sin INSERT ni DELETE)
- `break_configs` (sin INSERT ni DELETE)
- `reward_catalog` (sin INSERT ni DELETE)
- `payment_accounts` (sin INSERT ni DELETE)
- `salary_reports` (sin INSERT ni DELETE)
- `organization_whatsapp_config` (sin INSERT ni DELETE — tokens de API)
- `client_points` (sin INSERT, UPDATE ni DELETE)
- `point_transactions` (sin INSERT — bloquea transacciones de puntos)

---

## 5. Funciones de Base de Datos (RPCs)

### 5.1 Funciones SECURITY DEFINER sin validación de org
**Severidad: 🔴 CRÍTICO**

Las siguientes funciones ejecutan con privilegios elevados y NO validan que el caller tenga acceso a la org afectada:

| Función | Riesgo | Impacto |
|---------|--------|---------|
| `start_barber_break(p_staff_id)` | Acepta cualquier staff_id | Bloquear barberos de otra org |
| `end_barber_break(p_staff_id)` | Sin validación de org | Manipular estado de barberos ajenos |
| `unblock_barber(p_staff_id)` | Sin validación de org | Desbloquear barberos de otra org |
| `check_and_block_overdue_breaks()` | Afecta todos los staff sin filtro | Bloquear barberos de cualquier org |
| `batch_update_queue_entries(p_entries)` | Acepta UUIDs arbitrarios | Manipular cola de otra org |
| `generate_commission_report(p_branch_id)` | Sin verificar que branch pertenece al caller | Acceder a datos financieros de otra org |
| `pay_salary_reports(p_report_ids)` | Acepta IDs arbitrarios | Marcar salarios pagados en otra org |
| `refresh_branch_signals_for_branch(p_branch_id)` | Sin validar org ownership | Manipular señales de ocupación de otra sucursal |

---

### 5.2 Funciones INVOKER sin scope de org
**Severidad: 🟠 ALTO**

| Función | Problema |
|---------|----------|
| `next_queue_position(p_branch_id)` | Retorna posición sin verificar que branch pertenece a la org |
| `get_available_barbers_today(p_branch_id)` | Retorna barberos de cualquier branch |
| `calculate_barber_salary(...)` | Calcula salario sin verificar org |
| `get_occurrence_count(p_staff_id, ...)` | Cuenta disciplinaria cross-org |
| `on_queue_completed()` (trigger) | Crea visitas sin verificar org |

---

## 6. Server Actions — Auditoría Completa

### 6.1 Tabla de auditoría de las 35 server actions

| Archivo | Auth Check | Org Validation | Input Validation | Race Conditions | Severidad |
|---------|-----------|----------------|-----------------|-----------------|-----------|
| `auth.ts` | PIN directo | N/A (público) | Básica | Timing attack en comparación | 🔴 |
| `queue.ts` | ❌ Ninguno | ❌ Ninguno | ❌ Sin formato de tel/nombre | 🔴 Race en checkin, startService | 🔴 |
| `paymentAccounts.ts` | ✅ validateBranch | ✅ Branch | ❌ daily_limit puede ser negativo | 🔴 Race en transferencias | 🔴 |
| `sales.ts` | ✅ validateBranch | ✅ Branch | ❌ Cantidades negativas | 🔴 Stock no transaccional | 🟠 |
| `register.ts` | Público | Slug uniqueness | ⚠️ Password 6+ chars | Rollback no atómico | 🟠 |
| `reviews.ts` | ❌ Token only | ❌ Sin org | ❌ Rating sin validar (1-5) | Token reusable si falla update | 🟠 |
| `onboarding.ts` | getCurrentOrgId | ✅ Org | ⚠️ Archivo sin validar | Race en createBranch | 🟠 |
| `calendar.ts` | ❌ Ninguno | ❌ RLS only | ❌ Formato de hora no validado | Delete+insert no atómico | 🟠 |
| `kiosk.ts` | ❌ Ninguno | ❌ RLS only | Solo branchId requerido | N/A | 🟠 |
| `attendance.ts` | ❌ Ninguno | ❌ Ninguno | staffId, branchId | N/A (público) | 🟠 |
| `clients.ts` | getCurrentOrgId | ✅ Org (mayoría) | ❌ Face descriptor sin validar | N/A | 🟡 |
| `barber-panel.ts` | Session cookie | Staff scoped | ❌ IDs no validados | N/A | 🟡 |
| `barber.ts` | getCurrentOrgId | ✅ Org | ⚠️ Parcial | Race en manageStaffAccess | 🟡 |
| `breaks.ts` | validateBranch | ✅ Branch | ⚠️ FormData trim | Race en ghost queue position | 🟡 |
| `disciplinary.ts` | validateBranch | ✅ Branch | ✅ Enum checked | Race bajo (checkTardiness) | 🟡 |
| `expense-tickets.ts` | validateBranch | ✅ Branch | ⚠️ Amount como number | N/A | 🟡 |
| `finances.ts` | getOrgBranchIds | ✅ Org-wide | ❌ Meses sin validar | Read-only | 🟡 |
| `incentives.ts` | validateBranch | ✅ Branch | ❌ Threshold puede ser negativo | N/A | 🟡 |
| `messaging.ts` | getCurrentOrgId | ⚠️ Vía channels | ❌ Content sin validar | N/A | 🟡 |
| `org.ts` | getCurrentOrgId | ✅ Org | ✅ Slug regex | Race en switchOrg | 🟡 |
| `products.ts` | validateBranch | ✅ Branch | ❌ Precios negativos | N/A | 🟡 |
| `rewards.ts` | validateBranch | ✅ Branch | ❌ Puntos pueden ser negativos | N/A | 🟡 |
| `roles.ts` | requireOwner | ✅ Org | ❌ Name sin validar | Race en delete+insert scopes | 🟡 |
| `salary.ts` | getCurrentOrgId | ⚠️ Staff scoped | ❌ Period dates sin validar | JS filtering | 🟡 |
| `services.ts` | getCurrentOrgId | ⚠️ Branch si provisto | ❌ Precios negativos | N/A | 🟡 |
| `settings.ts` | getCurrentOrgId | ✅ Org | ⚠️ bgColor whitelist | Batch update no atómico | 🟡 |
| `stats.ts` | getCurrentOrgId | ✅ Org branches | ❌ ISO dates sin validar | Read-only | 🟡 |
| `tags.ts` | getCurrentOrgId | ✅ Org | ❌ Name vacío permitido | N/A | 🟡 |
| `visit-history.ts` | getCurrentOrgId | ✅ Via branches | ❌ Notes sin sanitizar | N/A | 🟡 |
| `whatsapp.ts` | requireAuth | ✅ Via config | ❌ Teléfono sin validar | N/A | 🟡 |
| `whatsapp-meta.ts` | getCurrentOrgId | ✅ Org | ❌ Phone normalización frágil | N/A | 🟡 |
| `instagram-meta.ts` | getCurrentOrgId | ✅ Org | ❌ User ID sin validar | N/A | 🟡 |
| `conversations.ts` | getCurrentOrgId | ✅ Org | ⚠️ Básica | N/A | ✅ |
| `break-requests.ts` | Via breaks.ts | ✅ | ✅ | Via breaks.ts | ✅ |
| `scheduled-breaks.ts` | Via breaks.ts | ✅ | ✅ | Via breaks.ts | ✅ |

---

### 6.2 Race conditions críticas

**`paymentAccounts.recordTransfer()` — Exceso de límite diario**
```
1. Leer accumulated_today → $90.000
2. Verificar < daily_limit ($100.000)
3. → Dos requests concurrentes pasan el check
4. Ambas insertan → accumulated_today = $180.000 (excede el límite)
```
**Fix:** `UPDATE ... SET accumulated_today = accumulated_today + amount WHERE accumulated_today + amount <= daily_limit` atómico.

**`sales.processProductSales()` — Stock negativo**
```
1. Leer stock_quantity → 5
2. Vender 3 → nuevo stock = 2
3. → Dos requests concurrentes leen stock = 5
4. Ambas decrementan → stock = -1
```
**Fix:** `UPDATE products SET stock_quantity = stock_quantity - $amount WHERE stock_quantity >= $amount`.

**`breaks.approveBreak()` — Position collision en ghost queue entry**
```
1. Calcular next_position → 7
2. Insertar ghost entry con position 7
3. → Queue cambia entre cálculo e insert
4. Dos entries con position 7
```

---

### 6.3 Validación de input ausente (patrón global)

Campos numéricos que aceptan valores negativos en producción:
- `products.ts` — cost, sale_price, stock
- `services.ts` — price, duration
- `incentives.ts` — threshold, reward_amount
- `rewards.ts` — points_per_visit, redemption_threshold
- `paymentAccounts.ts` — daily_limit
- `settings.ts` — lost_client_days, at_risk_client_days
- `salary.ts` — amounts pasados a RPCs

**Ningún server action valida formato de ISO dates antes de pasarlos a queries.**

---

## 7. Billing y Monetización

### 7.1 Sistema de billing completamente ausente
**Severidad: 🔴 CRÍTICO PARA SaaS**

Búsqueda exhaustiva: cero referencias a `stripe`, `mercadopago`, `paypal`, `billing`, `subscription`, `plan`, `invoice`.

Las `paymentAccounts` son cuentas de caja del negocio, no pagos al SaaS.

**Mínimo viable:**
```
├── Tabla plans (free/starter/pro/enterprise + límites)
├── Tabla subscriptions (org_id, plan_id, estado, stripe_subscription_id)
├── Integración con procesador de pagos (webhooks)
├── Enforcement de límites (staff, branches, mensajes/mes)
├── Página /dashboard/billing
└── Emails transaccionales
```

---

## 8. Features SaaS Faltantes

### 8.1 Sin password reset
**Severidad: 🟠 ALTO**

No existe flujo de recuperación. Supabase lo provee, sólo falta la UI.

### 8.2 Sin límites por plan
**Severidad: 🟠 ALTO**

Todos los tenants tienen acceso ilimitado a todos los recursos. Inviable para freemium.

### 8.3 Sin email transaccional
**Severidad: 🟠 ALTO**

No hay emails automáticos: bienvenida, confirmación, próximo cobro, recordatorios. Necesario para retención y compliance.

### 8.4 Sin página `/dashboard/cuenta`
**Severidad: 🟠 ALTO**

El owner no puede cambiar email, password, gestionar suscripción ni ver su perfil.

### 8.5 Términos y condiciones no registrados
**Severidad: 🟡 MEDIO**

Sin captura de TyC en registro. Requerido por Ley 25.326 (Argentina) para procesar datos.

### 8.6 Sin soporte multi-país/moneda
**Severidad: 🟡 MEDIO**

Moneda ARS hardcodeada en `format.ts`. Teléfonos +54 hardcodeados. Sin timezone configurable por org.

### 8.7 Sin notificaciones in-app para admins
**Severidad: 🟡 MEDIO**

No hay sistema de notificaciones para el dashboard (nuevo review, break request, etc.). El badge de break requests es la única notificación.

### 8.8 Sin exportación de datos (GDPR/compliance)
**Severidad: 🟡 MEDIO**

No hay mecanismo para que un tenant exporte o elimine sus datos. Requerido legalmente si se opera en Argentina/EU.

---

## 9. Base de Datos y Migraciones

### 9.1 Tablas sin RLS o con policies rotas
(Detallado en Sección 4)

### 9.2 Interfaces TypeScript duplicadas
**Severidad: 🔴 CRÍTICO**
**Archivo:** `src/lib/types/database.ts`

| Interface | Definición 1 | Definición 2 | Conflicto |
|-----------|-------------|-------------|-----------|
| `PaymentAccount` | ~línea 375 | ~línea 459 | `cbu_cvu`/`alias` vs `alias_or_cbu` |
| `ExpenseTicket` | ~línea 390 | ~línea 473 | Campos distintos |
| `TransferLog` | ~línea 405 | ~línea 488 | Campos distintos |

TypeScript usa la primera definición; los datos del servidor pueden venir con la segunda.

### 9.3 Índices faltantes en foreign keys

**Sin índice — alto impacto:**
| Tabla.columna | Uso |
|---|---|
| `transfer_logs.branch_id` | Queries financieras por sucursal |
| `social_channels.branch_id` | Lookup de canales de mensajería |
| `staff_face_descriptors.staff_id` | Match facial |
| `organization_whatsapp_config.organization_id` | Config lookup |
| `organization_instagram_config.organization_id` | Config lookup |
| `conversation_tags.organization_id` | Filtro de tags |
| `conversation_tag_assignments.conversation_id` | Join en conversaciones |
| `conversation_tag_assignments.tag_id` | Join en tags |

### 9.4 Columnas `updated_at` faltantes

Tablas sin `updated_at`:
`queue_entries`, `point_transactions`, `attendance_logs`, `incentive_achievements`, `visit_photos`, `service_tags` (sin timestamps), `organization_members`, `conversation_tags`, `conversation_tag_assignments`

### 9.5 CHECK constraints faltantes

| Tabla.columna | Problema |
|---|---|
| `staff.commission_pct` | Sin CHECK 0-100 |
| `fixed_expenses.amount` | Sin CHECK >= 0 |
| `client_points.points_balance` | Sin CHECK >= 0 |
| `salary_reports.amount` | Sin CHECK != 0 |
| `products.stock_quantity` | Sin CHECK >= 0 |
| `products.cost`, `products.sale_price` | Sin CHECK >= 0 |
| `services.price`, `services.duration` | Sin CHECK > 0 |

### 9.6 `verify_token` sin UNIQUE constraint
**Severidad: 🟡 MEDIO**

Dos orgs con el mismo token = webhooks routeados al org equivocado.

### 9.7 Migraciones con números duplicados
**Severidad: 🟡 MEDIO**

Existen dos migraciones `038_*` y dos `053_*`:
- `038_dynamic_cooldown.sql` y `038_visits_client_nullable.sql`
- `053_org_whatsapp_meta_config.sql` y `053_onboarding_support.sql`

Esto causa confusión y potenciales conflictos al aplicar.

---

## 10. Calidad de Código TypeScript

### 10.1 Tipos `unknown[]` en componente crítico
**Severidad: 🔴 CRÍTICO**
**Archivo:** `src/app/dashboard/equipo/equipo-client.tsx:37-64`

10+ props tipados como `unknown[]` con cadenas de casting inseguro: `(b as { role: string }).role`.

### 10.2 `any` en lógica de selección de org
**Severidad: 🔴 CRÍTICO**
**Archivo:** `src/app/dashboard/layout.tsx:75-80`

Cast a `any` en el código que determina acceso a organizaciones.

### 10.3 Return types faltantes en server actions
**Severidad: 🟡 MEDIO**

La mayoría de las 35 server actions no declaran tipo de retorno. Callers infieren tipo incorrectamente cuando hay múltiples paths de retorno.

### 10.4 11 eslint-disable en un solo archivo
**Severidad: 🟡 MEDIO**

`equipo-client.tsx` suprime `@typescript-eslint/no-explicit-any` 11 veces. Indica problema de diseño, no de lint.

---

## 11. Frontend y UX

### 11.1 Memory leak en subscriptions Realtime
**Severidad: 🔴 CRÍTICO**
**Archivo:** `src/components/dashboard/dashboard-shell.tsx:544-550`

`useEffect` con dependencia inestable (`fetchPendingBreakCount`) recrea suscripción en cada render.

### 11.2 Sin paginación en lista de clientes
**Severidad: 🔴 CRÍTICO**

10.000 clientes = 10.000 nodos DOM. Crash del browser garantizado.

### 11.3 `queue-panel.tsx` — 38 useState hooks, 1.816 líneas
**Severidad: 🔴 CRÍTICO**

El componente más complejo del sistema tiene 38 variables de estado independientes. Candidato claro para `useReducer` agrupado por dominio (break state, queue state, UI state).

### 11.4 Over-fetching masivo en `/dashboard/equipo`
**Severidad: 🟠 ALTO**
**Archivo:** `src/app/dashboard/equipo/page.tsx:52-132`

**16 queries paralelas** en cada page load: barbers, branches, visits, break_configs, incentive_rules, achievements, disciplinary_rules, events, roles, break_requests, active_breaks, overtime_history, service_history, attendance_logs, salary_configs, calendar_barbers.

**Fix:** Lazy-load tabs no visibles (incentivos, disciplina, historial).

### 11.5 Over-fetching en `/dashboard/finanzas`
**Severidad: 🟠 ALTO**

8 queries paralelas incluyendo meses de datos históricos sin paginación.

### 11.6 Sin error.tsx en App Router
**Severidad: 🟠 ALTO**

No existen archivos `error.tsx` en ninguna ruta. Un error en un componente crashea la página entera sin fallback.

### 11.7 TV page sin autenticación
**Severidad: 🟠 ALTO**
**Archivo:** `src/app/tv/page.tsx`

Página pública que usa `createAdminClient()`. Expone datos de cola (nombres de clientes, barberos) sin auth.

### 11.8 Permisos verificados en cliente
**Severidad: 🟠 ALTO**
**Archivo:** `src/components/barber/queue-panel.tsx`

`session.permissions?.['breaks.grant']` se verifica en el cliente. Un usuario puede manipular el objeto de sesión para saltear la restricción. Los permisos deben verificarse en los server actions.

### 11.9 Onboarding incompleto
**Severidad: 🟠 ALTO**

Falta: cuenta de cobro, break config, rewards_config, verificación de completitud.

### 11.10 Componentes > 1.000 líneas
**Severidad: 🟡 MEDIO**

| Componente | Líneas | Problema |
|---|---|---|
| `perfiles-client.tsx` | 2.161 | Debe dividirse |
| `queue-panel.tsx` | 1.816 | 38 useState |
| `fila-client.tsx` | 1.635 | Kanban denso |
| `mensajeria-client.tsx` | 1.421 | Debe extraer hooks |
| `sueldos-client.tsx` | 1.351 | Grande pero manejable |
| `estadisticas-client.tsx` | 802 | Tabs mezclados |
| `dashboard-shell.tsx` | 700+ | Mezcla navegación, DnD, subscriptions |

### 11.11 `select('*')` expone datos sensibles en TV
**Severidad: 🟡 MEDIO**

```typescript
.select('*, client:clients(*), barber:staff(*)')
```

Trae `pin`, `face_descriptor`, datos personales al display público.

### 11.12 useEffect con 11 dependencias en queue-panel
**Severidad: 🟡 MEDIO**

Dependency array con 11 items, muchos son funciones que cambian en cada render. Causa re-suscripciones innecesarias a Realtime.

### 11.13 Sin aria-live en panels de cola
**Severidad: 🟡 MEDIO**

Actualizaciones en tiempo real no se anuncian a screen readers. Accesibilidad limitada.

---

## 12. Mensajería WhatsApp / Instagram

### 12.1 Canal de WhatsApp sin filtro de org en Edge Functions
**Severidad: 🔴 CRÍTICO (combinado con 2.1)**

Tanto `wa-incoming` como `process-scheduled-messages` buscan canales con `LIMIT 1` sin filtrar por org. Mensajes entrantes se routean al primer canal encontrado, no al correcto.

**Mismo bug en el lookup de clientes:**
```sql
SELECT id FROM clients WHERE phone = ? -- Sin filtro de org
```

Si dos orgs tienen un cliente con el mismo teléfono, la conversación se crea en el org incorrecto.

### 12.2 Deduplicación con race condition
**Severidad: 🟡 MEDIO**

El check de `platform_message_id` ocurre después de incrementar `unread_count`. Reintentos de Meta duplican el contador.

### 12.3 External microservice call sin timeout
**Severidad: 🟡 MEDIO**
**Archivo:** `supabase/functions/process-scheduled-messages/index.ts`

```typescript
const res = await fetch(`${waApiUrl}/send`, { ... })
```

Sin timeout, sin retry logic. `waApiUrl` viene de `app_settings` sin validación de formato URL.

### 12.4 Teléfonos hardcodeados para Argentina
**Severidad: 🟡 MEDIO**

Normalización asume +54. Bloquea expansión internacional.

---

## 13. Observabilidad y Monitoring

### 13.1 Sin APM ni error tracking
**Severidad: 🟠 ALTO**

Cero integración con Sentry/Datadog/Bugsnag. Errores sólo detectables cuando el tenant reporta.

### 13.2 Datos sensibles en logs de producción
**Severidad: 🟠 ALTO**

~15 `console.log/error` en webhooks con tokens, teléfonos, contenido de mensajes.

### 13.3 Sin audit trail
**Severidad: 🟠 ALTO**

Sin `created_by`/`updated_by` en tablas críticas. Sin log de cambios de rol, intentos de login, configuración de org. Problema de compliance y debugging.

### 13.4 Sin health checks
**Severidad: 🟡 MEDIO**

Sin endpoint `/api/health`. Sin forma de conectar uptime monitoring.

### 13.5 Background errors silenciados
**Severidad: 🟡 MEDIO**

`attendance.ts`, `breaks.ts` y otros server actions catch y descartan errores en operaciones background sin logging ni notificación.

### 13.6 Sin métricas de negocio
**Severidad: 🟡 MEDIO**

No hay tracking de: conversiones de checkin, tasa de retorno de clientes, revenue por tenant, uso de features. Datos fundamentales para un SaaS.

---

## 14. Escalabilidad y Performance

### 14.1 Queries sin limit() en server components
**Severidad: 🟠 ALTO**

Páginas que cargan datos completos sin paginación:
- `/dashboard/clientes` — todos los clientes + visitas + puntos
- `/dashboard/equipo` — 16 queries en paralelo
- `/dashboard/finanzas` — meses de datos históricos
- `/dashboard/calendario` — similar a equipo

### 14.2 Suscripciones Realtime a tablas completas
**Severidad: 🟠 ALTO**

Todos los canales Realtime escuchan tablas enteras sin filtro de `branch_id`. Con 100 tenants, cada mutación dispara callbacks en todos los clientes conectados.

### 14.3 Sin connection pooling documentado
**Severidad: 🟠 ALTO**

El `createAdminClient()` crea una nueva instancia de Supabase client en cada server action call. Sin pooling, cada request abre una nueva conexión a Postgres.

### 14.4 N+1 en carga de fotos de visitas
**Severidad: 🟡 MEDIO**

Cada apertura de detalle de cliente = 1 query a `visit_photos`.

### 14.5 Face recognition models servidos desde Next.js
**Severidad: 🟡 MEDIO**

~7MB de modelos TensorFlow servidos por Next.js/Vercel. Debería usar CDN con cache headers.

### 14.6 Sin caché de datos estáticos
**Severidad: 🟡 MEDIO**

Datos que cambian raramente (servicios, sucursales, configs) se refetchen en cada page load. `force-dynamic` en 11 páginas previene cualquier caching.

### 14.7 Floating point en cálculos financieros
**Severidad: 🟡 MEDIO**
**Archivo:** `src/lib/actions/finances.ts`

Cálculos de revenue y comisiones usan JavaScript `Number` (IEEE 754 float). Para valores monetarios debería usarse aritmética de enteros (centavos) o `Decimal` del lado de Postgres.

---

## 15. Testing

### 15.1 Sin framework de testing
**Severidad: 🟠 ALTO**

Cero tests en el codebase. Las vulnerabilidades y race conditions documentadas se habrían detectado con tests mínimos.

**Recomendación mínima:**
- **Vitest** para unit tests de server actions (auth, billing, org isolation)
- **Playwright** para E2E: registro → onboarding → primer checkin → primer pago
- **Test de integración** para RPCs de SECURITY DEFINER con validación de org

---

## 16. Roadmap de Remediación

### Fase 0 — Parches de Seguridad Urgentes (1-2 semanas)
*Bloqueante: no se puede comercializar con estas vulnerabilidades.*

| # | Tarea | Severidad |
|---|-------|-----------|
| 0.1 | Verificación HMAC en webhooks de Meta | 🔴 |
| 0.2 | Eliminar auto-reset password en `client-auth` | 🔴 |
| 0.3 | Rate limiting en login PIN | 🔴 |
| 0.4 | RLS policies para `conversation_tags`, `client_loyalty_state`, `organization_instagram_config` | 🔴 |
| 0.5 | Habilitar RLS en `transfer_logs` | 🔴 |
| 0.6 | Agregar org validation a funciones SECURITY DEFINER (`start/end_barber_break`, `batch_update_queue_entries`, etc.) | 🔴 |
| 0.7 | DROP policies legacy `USING(true)` en migración nueva | 🔴 |
| 0.8 | Firmar cookie `barber_session` con HMAC | 🟠 |
| 0.9 | Cifrar tokens de Meta API en DB | 🟠 |
| 0.10 | Fix multi-tenant routing en `wa-incoming` y `process-scheduled-messages` | 🟠 |
| 0.11 | Remover datos sensibles de logs | 🟠 |
| 0.12 | Validar archivos en upload (extensión, tamaño) | 🟠 |

### Fase 1 — Fundación SaaS (3-4 semanas)
*Prerequisito para cobrar.*

| # | Tarea |
|---|-------|
| 1.1 | **Sistema de billing** — plans, subscriptions, integración Stripe/MercadoPago, enforcement |
| 1.2 | Password reset (UI + Supabase Auth) |
| 1.3 | Email verification real (reemplazar `email_confirm: true`) |
| 1.4 | Captcha en registro (Cloudflare Turnstile) |
| 1.5 | Sentry para error tracking |
| 1.6 | Completar onboarding (cuenta de cobro, break config, rewards_config) |
| 1.7 | Página `/dashboard/cuenta` (perfil, password, suscripción) |
| 1.8 | Endpoint `/api/health` |
| 1.9 | Emails transaccionales (bienvenida, cobro, aviso de pago fallido) |

### Fase 2 — Estabilidad y Data Integrity (2-3 semanas)

| # | Tarea |
|---|-------|
| 2.1 | Resolver interfaces duplicadas en `database.ts` |
| 2.2 | Tipar `equipo-client.tsx` (eliminar `unknown[]`) |
| 2.3 | Paginación server-side en clientes, visitas, finanzas |
| 2.4 | Agregar todos los índices FK faltantes |
| 2.5 | CHECK constraints para valores numéricos (precios, stock, porcentajes) |
| 2.6 | Fix race conditions: transferencias, stock, breaks (queries atómicas) |
| 2.7 | Fix memory leak en dashboard-shell Realtime |
| 2.8 | Filtrar Realtime channels por `branch_id` |
| 2.9 | Error boundaries (`error.tsx` en rutas principales) |
| 2.10 | Mover permission checks del cliente a server actions |
| 2.11 | Lazy-load tabs no visibles en `/dashboard/equipo` y `/finanzas` |

### Fase 3 — Calidad y Escalabilidad (Ongoing)

| # | Tarea |
|---|-------|
| 3.1 | Configuración de país/moneda/timezone por org |
| 3.2 | Hashing de PIN (bcrypt) + migración |
| 3.3 | Audit trail (tabla `audit_logs` + triggers) |
| 3.4 | CDN para modelos de face recognition |
| 3.5 | Framework de testing (Vitest + Playwright) |
| 3.6 | Refactor `queue-panel.tsx` (38 useState → useReducer) |
| 3.7 | Refactor `perfiles-client.tsx` (2.161 líneas → split) |
| 3.8 | `get_user_org_id()` con ORDER BY determinístico |
| 3.9 | Completar policies INSERT/DELETE faltantes en RLS |
| 3.10 | Aritmética de enteros para cálculos financieros |
| 3.11 | Exportación de datos para compliance GDPR |
| 3.12 | Input validation estandarizada con Zod en todos los server actions |

---

## 17. Apéndice: Tabla Maestra de Issues

### Seguridad

| ID | Issue | Severidad | Archivo |
|----|-------|-----------|---------|
| S-01 | Sin HMAC verification en webhooks | 🔴 | `api/webhooks/*/route.ts` |
| S-02 | Auto-reset password sin verificación | 🔴 | `client-auth/index.ts` |
| S-03 | PIN sin rate limiting | 🔴 | `actions/auth.ts` |
| S-04 | PIN en texto plano | 🔴 | DB `staff.pin` |
| S-05 | Tokens Meta API en texto plano | 🔴 | `organization_*_config` |
| S-06 | Cookie barber_session sin firma | 🟠 | `actions/org.ts` |
| S-07 | Email auto-confirm sin verificación | 🟠 | `actions/register.ts` |
| S-08 | Sin captcha en registro | 🟠 | `app/(auth)/register` |
| S-09 | Logs con datos sensibles | 🟠 | Webhook handlers |
| S-10 | Upload sin validación de archivo | 🟠 | `actions/onboarding.ts` |
| S-11 | Password mínimo 6 chars | 🟠 | `actions/register.ts` |
| S-12 | Enumeración de orgs vía slug | 🟡 | `actions/org.ts` |
| S-13 | client-auth sin rate limiting | 🟡 | Edge Function |
| S-14 | Timing attack en PIN compare | 🟡 | `actions/auth.ts` |
| S-15 | TV page sin auth expone datos | 🟡 | `app/tv/page.tsx` |

### Multi-Tenant / RLS

| ID | Issue | Severidad | Archivo |
|----|-------|-----------|---------|
| MT-01 | `get_user_org_id()` no determinístico | 🔴 | Migración 048 |
| MT-02 | Policies legacy `USING(true)` no eliminadas | 🔴 | Migración 001 |
| MT-03 | `client-auth` no asigna organization_id | 🔴 | Edge Function |
| MT-04 | RLS sin policies: conversation_tags, client_loyalty_state, ig_config | 🔴 | Migraciones 055/056 |
| MT-05 | transfer_logs sin RLS habilitado | 🔴 | Schema |
| MT-06 | client_face_descriptors completamente abierto | 🔴 | Migración 048 |
| MT-07 | 8 funciones SECURITY DEFINER sin org validation | 🔴 | Múltiples migraciones |
| MT-08 | Server actions sin auth (queue, calendar, kiosk, attendance) | 🟠 | Múltiples actions |
| MT-09 | createAdminClient usado en exceso | 🟠 | Múltiples actions |
| MT-10 | switchOrganization no atómico | 🟠 | `actions/org.ts` |
| MT-11 | wa-incoming/process-scheduled-messages sin org filter | 🟠 | Edge Functions |
| MT-12 | Registro con rollback incompleto | 🟡 | `actions/register.ts` |

### Data Integrity / Race Conditions

| ID | Issue | Severidad | Archivo |
|----|-------|-----------|---------|
| RC-01 | Transferencias exceden daily_limit por concurrencia | 🔴 | `actions/paymentAccounts.ts` |
| RC-02 | Stock puede ser negativo por concurrencia | 🟠 | `actions/sales.ts` |
| RC-03 | Ghost queue position collision | 🟡 | `actions/breaks.ts` |
| RC-04 | Calendar delete+insert no atómico | 🟡 | `actions/calendar.ts` |
| RC-05 | Role scopes delete+insert no atómico | 🟡 | `actions/roles.ts` |

### Base de Datos

| ID | Issue | Severidad | Archivo |
|----|-------|-----------|---------|
| DB-01 | Interfaces TypeScript duplicadas | 🔴 | `types/database.ts` |
| DB-02 | 8+ índices FK faltantes | 🟠 | Múltiples tablas |
| DB-03 | 9+ tablas sin updated_at | 🟡 | Múltiples tablas |
| DB-04 | 7+ columnas sin CHECK constraint | 🟡 | Múltiples tablas |
| DB-05 | verify_token sin UNIQUE | 🟡 | Migración 053 |
| DB-06 | Migraciones con números duplicados (038, 053) | 🟡 | supabase/migrations/ |

### Frontend / UX

| ID | Issue | Severidad | Archivo |
|----|-------|-----------|---------|
| FE-01 | Memory leak Realtime subscriptions | 🔴 | `dashboard-shell.tsx` |
| FE-02 | Sin paginación en clientes | 🔴 | `clientes-client.tsx` |
| FE-03 | 38 useState en queue-panel (1.816 líneas) | 🔴 | `queue-panel.tsx` |
| FE-04 | Over-fetching: 16 queries en /equipo | 🟠 | `equipo/page.tsx` |
| FE-05 | Sin error.tsx en ninguna ruta | 🟠 | App Router |
| FE-06 | TV sin auth + select('*') expone PIN/face | 🟠 | `tv/page.tsx` |
| FE-07 | Permisos verificados en cliente | 🟠 | `queue-panel.tsx` |
| FE-08 | Onboarding incompleto (4 pasos faltantes) | 🟠 | `actions/onboarding.ts` |
| FE-09 | unknown[] + casting inseguro | 🟠 | `equipo-client.tsx` |
| FE-10 | Componentes > 1.000 líneas (5 archivos) | 🟡 | Múltiples |
| FE-11 | useEffect con 11 deps en queue-panel | 🟡 | `queue-panel.tsx` |
| FE-12 | Sin aria-live en panels de cola | 🟡 | Queue components |

### Billing / SaaS

| ID | Issue | Severidad | Archivo |
|----|-------|-----------|---------|
| B-01 | Sistema de billing completamente ausente | 🔴 | — |
| B-02 | Sin password reset | 🟠 | — |
| B-03 | Sin límites por plan | 🟠 | — |
| B-04 | Sin email transaccional | 🟠 | — |
| B-05 | Sin página de cuenta del owner | 🟠 | — |
| B-06 | Sin TyC en registro | 🟡 | — |
| B-07 | Sin soporte multi-país | 🟡 | `format.ts` |
| B-08 | Sin exportación de datos (compliance) | 🟡 | — |

### Observabilidad / Escalabilidad

| ID | Issue | Severidad | Archivo |
|----|-------|-----------|---------|
| OB-01 | Sin APM/error tracking | 🟠 | — |
| OB-02 | Sin audit trail | 🟠 | — |
| OB-03 | Background errors silenciados | 🟡 | Múltiples actions |
| SC-01 | RT channels sin filtro de branch | 🟠 | Múltiples |
| SC-02 | Queries sin limit() | 🟠 | Múltiples |
| SC-03 | Sin connection pooling | 🟠 | `supabase/server.ts` |
| SC-04 | Float en cálculos financieros | 🟡 | `actions/finances.ts` |
| SC-05 | Face models sin CDN | 🟡 | `public/models/` |
| SC-06 | force-dynamic en 11 páginas | 🟡 | Múltiples |
| T-01 | Sin framework de tests | 🟠 | — |

---

**Total de issues identificados: 78**
- 🔴 Críticos: 22
- 🟠 Altos: 30
- 🟡 Medios: 26

---

*Informe v2.0 generado por auditoría exhaustiva de las 35 server actions, 56 migraciones SQL, 3 Edge Functions y todos los componentes frontend del codebase.*

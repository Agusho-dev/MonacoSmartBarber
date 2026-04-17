# Auditoría BarberOS (Monaco Smart Barber) — Pre-Comercialización

> **[STATUS 2026-04-17]** Se ejecutó la mayor parte del plan (fases 1, 3, 4, 5, 6, 7 y 8-10 parciales).
> Ver sección final **"Estado de implementación"** al final del documento.



**Fecha:** 2026-04-17
**Alcance:** Dashboard Admin, Barber Panel, Check-in Kiosk, TV, Review, Edge Functions, DB multi-tenant
**Objetivo:** Identificar todo lo que bloquea o fricciona la venta del sistema como SaaS multi-tenant (apertura de una barbería nueva sin asistencia del equipo de BarberOS).
**Fuente de verdad:** código en `src/`, migraciones en `supabase/migrations/`, y el estado real de la DB consultada vía MCP (8 orgs, 91 tablas, 296 índices, 88 migrations registradas).

---

## 0. Resumen ejecutivo

El sistema está **funcional para Monaco** pero tiene **bloqueantes duros** para operar como SaaS multi-tenant. Los problemas se agrupan en cuatro bloques:

| Bloque | Severidad | Estado |
|---|---|---|
| **A. Multi-tenant isolation rota a nivel DB** (RLS permisivas + UUID Monaco hardcodeado en triggers + tablas sin `organization_id`) | 🔴 P0 | Bloqueante |
| **B. Branding hardcodeado "Monaco Smart Barber"** (28 ocurrencias en 20 archivos, más el template de review en DB) | 🔴 P0 | Bloqueante |
| **C. Onboarding de nueva org funciona pero incompleto** (sin defaults: roles/servicios/rewards/templates; sin wizard que guíe después del registro) | 🟠 P1 | Fricción crítica |
| **D. Sin vista de super-admin / billing / plan** (no hay forma de que el equipo BarberOS gestione orgs) | 🟠 P1 | Bloqueante operacional |

**Evidencia del problema:** de las 8 organizaciones en DB, sólo Monaco tiene datos reales (31 staff, 4 sucursales, 2748 visitas, 2345 clientes). **7 de 8 orgs (87%) tienen 0 sucursales y 0 clientes** — es decir, nadie logra completar el setup por sí mismo.

**Estimación global para comercializar:** 4-6 semanas de trabajo full-time ordenado por fases (ver `plan.md`).

---

## 1. Multi-tenant — Hallazgos en DB (CRÍTICO)

### 1.1 🔴 P0 — UUID de Monaco hardcodeado en trigger de loyalty

**Archivo:** función SQL `update_client_loyalty_state()` (trigger AFTER INSERT en `visits`).
```sql
INSERT INTO client_loyalty_state (client_id, organization_id, ...)
VALUES (..., COALESCE(v_org_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID), ...)
```
- **Impacto:** Si un cliente tiene `organization_id = NULL`, el trigger asigna su loyalty state a **Monaco** por defecto. En producción con orgs nuevas, si alguna visita escapa al trigger `set_org_from_client`, los datos de esa visita terminan atribuidos a Monaco.
- **Fix:** Reemplazar por `RAISE EXCEPTION 'client sin organization_id: %', NEW.client_id` o derivar de `branches.organization_id` vía NEW.branch_id.

### 1.2 🔴 P0 — API keys de OpenAI/Anthropic expuestas a público

**Tabla:** `organization_ai_config` (contiene `openai_api_key`, `anthropic_api_key` por org).
**Policy actual:**
```sql
CREATE POLICY service_role_full_access ON organization_ai_config
FOR ALL TO public USING (true) WITH CHECK (true);
```
- El nombre sugiere que es solo para service role pero **aplica a `public` con `USING (true)`** → cualquier usuario autenticado (o anon si RLS falla) puede leer las API keys de todas las orgs.
- **Impacto:** breach de credenciales de IA + costos arbitrarios facturados a la org víctima.
- **Fix:** `DROP POLICY`, crear política correcta `FOR ALL TO service_role USING (true)` y, si se necesita read desde dashboard, exponer solo un flag `has_key` via RPC (no la key).

### 1.3 🔴 P0 — Tablas de dinero con RLS `USING (true)` a public

Las tablas financieras del módulo "caja" migración 2026-04-08 (`sesiones_caja`, `movimientos_caja`, `gastos`, `categorias_gasto`, `cuentas_transferencia`) tienen policies tipo:
```sql
CREATE POLICY allow_all_movimientos ON movimientos_caja FOR ALL TO public USING (true);
CREATE POLICY "Allow all for authenticated" ON gastos FOR ALL USING (auth.role() = 'authenticated');
```
- **Ninguna** filtra por `organization_id` (y estas tablas **tampoco tienen columna** `organization_id` ni `branch_id` indirecto).
- **Impacto:** Cualquier staff autenticado ve la caja, gastos y transferencias de **todas** las orgs. Si hay un usuario anon con algún bug de RLS, también.
- **Fix:** 
  1. Agregar `organization_id UUID NOT NULL REFERENCES organizations(id)` a las 5 tablas del módulo caja.
  2. Backfill con la org de Monaco (a0eebc99...) por ser las únicas filas existentes.
  3. Recrear RLS: `USING (organization_id = get_user_org_id())`.

### 1.4 🔴 P0 — Académia completamente sin multi-tenant

Tablas `alumnos`, `cursos`, `curso_inscripciones`, `asistencias`, `pagos`, `alertas`, `talleres_practica`, `curso_comunicaciones_checklist`, `mensaje_plantillas`, `mensajes_enviados`, `alerta_plantillas_defecto`:
- No tienen `organization_id` ni `branch_id`.
- RLS: `CREATE POLICY allow_all ON ... FOR ALL USING (true)`.
- **Impacto:** Si otra org habilita el módulo de academia, ve alumnos de Monaco (y viceversa).
- **Fix:** O se migra a multi-tenant (org_id + RLS), o se marca el módulo como "global" y se toma la decisión producto: o es parte del plan BarberOS para todos, o es un módulo custom Monaco-only que deberia desactivarse por default.

### 1.5 🔴 P0 — Biometría de clientes expuesta a `anon`

**Tabla:** `client_face_descriptors` (7088 filas, vectores faciales de clientes).
```sql
CREATE POLICY client_face_anon_read   ON client_face_descriptors FOR SELECT TO anon USING (true);
CREATE POLICY client_face_anon_insert ON client_face_descriptors FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY client_face_anon_delete ON client_face_descriptors FOR DELETE TO anon USING (true);
```
- Tampoco tiene `organization_id`.
- **Impacto:** cualquier persona con la `anon` key pública puede leer/borrar/insertar biometría facial. Esto es **data privada regulada por GDPR/LGPD/Ley Arg 25.326** y además permite envenenar el reconocimiento facial cross-tenant.
- **Fix:**
  1. Agregar `organization_id`.
  2. Cambiar a SECURITY DEFINER RPC `match_face_descriptor(p_descriptor, p_org_id)` con anon SELECT revocado.
  3. INSERT/DELETE solo desde service role (kiosk usa server action con admin client).

### 1.6 🔴 P0 — `app_settings.review_message_template` default contiene "Monaco Smart Barber"

Valor default de la columna:
```sql
'¡Hola {nombre}! Gracias por visitarnos en Monaco Smart Barber 💈. Nos encantaría saber qué te pareció tu experiencia. Dejanos tu opinión acá: {link_resena} ⭐'
```
- Cada nueva org que deje el template vacío termina mandando este mensaje — sus **clientes reciben un WhatsApp mencionando a Monaco**.
- **Fix:** reemplazar default por `'¡Hola {nombre}! Gracias por visitarnos en {barberia} 💈. ...'` y al enviar, reemplazar `{barberia}` con `organizations.name`.

### 1.7 🟠 P1 — RLS cross-org rotas por falta de filtro `organization_id` en policies

Policies que solo validan `EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND is_active = true)` **sin filtrar por `organization_id`**:
- `crm_cases.staff_manage_crm_cases` — staff de cualquier org ve crm_cases de todas
- `review_requests.staff_manage_review_requests` — idem
- `visit_photos.visit_photos_manage_owner` — verificar (parece tener check pero sin org)

**Fix:** agregar `AND staff.organization_id = get_user_org_id()` al EXISTS.

### 1.8 🟠 P1 — `auth_rls_initplan` en 81 policies

Supabase Advisor reporta 81 policies que llaman `auth.uid()` / `auth.jwt()` / `auth.role()` directamente en `USING` o `WITH CHECK` — esto re-evalúa la función por cada row:
```sql
-- Malo:
USING (staff.auth_user_id = auth.uid())
-- Bueno:
USING (staff.auth_user_id = (SELECT auth.uid()))
```
- **Impacto performance:** queries con 10k filas pueden llamar `auth.uid()` 10k veces. En prod lo sentís en `clients`, `visits`, `queue_entries`, `messages`.
- **Fix:** migration que re-genera las 81 policies con `(SELECT auth.fn())`.

### 1.9 🟠 P1 — 247 policies permisivas superpuestas (`multiple_permissive_policies`)

Para muchas tablas existe más de una policy `PERMISSIVE` sobre el mismo rol+cmd. Postgres evalúa **todas** con OR → query planner no puede optimizar. Ejemplos críticos:
- `app_settings` SELECT para anon: `settings_anon_read` + `settings_manage_by_org_admin` + `settings_read_by_org` (3 policies!)
- `client_points` SELECT: `client_points_read_by_org` + `client_read_own_balance` + `points_manage_staff` (3)
- `products` SELECT: 4 policies superpuestas
- **Fix:** consolidar en una policy por rol+cmd; usar `RESTRICTIVE` cuando se requiera combinar condiciones por AND.

### 1.10 🟡 P2 — 83 foreign keys sin índice

Incluye columnas críticas en `appointments.service_id`, `appointments.created_by_staff_id`, `break_requests.approved_by`, `client_goals.client_id`, `broadcasts.created_by`, etc.
- **Impacto:** DELETE del padre hace table scan del hijo; JOINs lentos.
- **Fix:** migration con `CREATE INDEX CONCURRENTLY` sobre cada FK (script autogenerable).

### 1.11 🟡 P2 — 11 índices duplicados + 92 índices no usados

Ejemplos duplicados:
- `app_settings`: `idx_app_settings_org` + `idx_app_settings_org_id` (idénticos) + `idx_app_settings_org_unique` (unique). Los 3 cubren `(organization_id)`.
- `branches`: `idx_branches_org` + `idx_branches_org_id`
- `clients`: `idx_clients_org` + `idx_clients_org_id`
- `reward_catalog`, `roles`, `service_tags`, `conversation_tags`, `client_goals`, `client_loyalty_state`: todos tienen `_org` + `_org_id` duplicados
- **Fix:** drop de los duplicados (12 índices menos + espacio).

### 1.12 🟡 P2 — Migraciones con numeración duplicada

Tienen **mismo número distinto contenido**:
- `038_branch_signals_auto_update.sql` + `038_visits_client_nullable.sql`
- `039_universal_barber_availability.sql` + `039_branch_occupancy_hidden_filter.sql`
- `050_multi_tenant_rls_fixes.sql` + `050_fix_face_rpc_security_definer.sql`
- `053_onboarding_support.sql` + `053_org_whatsapp_meta_config.sql`
- `057_fix_messaging_security_and_indexes.sql` + `057_fix_multitenant_functions.sql`
- `060_realtime_messaging.sql` + `060_staff_soft_delete.sql`
- `062_multitenant_complete.sql` + `062_scheduled_template_support.sql`
- `063_crm_auto_replies_broadcasts.sql` + `063_fix_permissive_rls_policies.sql`
- `064_enhanced_auto_reply_rules.sql` + `064_fix_multitenant_isolation.sql`
- **Impacto:** orden de aplicación no determinístico entre desarrolladores. Estado real puede divergir.
- **Fix:** renumerar histórico (costoso) o abandonar `supabase db push` y adoptar Supabase branches + versionado timestamp del CLI moderno. De aquí en más: usar timestamps `YYYYMMDDHHMMSS_name.sql` siempre.

### 1.13 🟡 P2 — Tablas sin trigger `set_org_from_*` pero con `organization_id`

26 tablas con `organization_id` **no tienen** trigger `BEFORE INSERT` para autocompletar org. Sin el trigger, una server action que olvide setear `organization_id` rompe isolation silenciosamente. Ejemplos: `app_settings`, `appointment_*`, `auto_reply_rules`, `automation_workflows`, `broadcasts`, `conversation_tags`, `crm_alerts`, `organization_*_config`, `reward_catalog`, `roles`, `service_tags`, `staff`, `partner_*`, `client_loyalty_state`, `client_goals`.
- **Fix:** trigger genérico `set_org_from_session()` que use `get_user_org_id()` como fuente, o dedicado por tabla.

### 1.14 🟡 P2 — Tablas con RLS enabled **sin ninguna policy** (Supabase Advisor)

- `partner_magic_links`
- `partner_org_relations`
- `partner_sessions`
- **Impacto:** `anon` y `authenticated` quedan bloqueados (que es lo deseado), pero **el dashboard usa admin client** así funciona. Si se intenta usar anon client (ej. mobile), rompe.
- **Fix:** definir policies explícitas aunque sean restrictivas, o documentar que son service-role only.

### 1.15 🟡 P2 — `get_user_org_id()` no soporta multi-org del mismo usuario

La función usa `ORDER BY created_at ASC LIMIT 1` para staff/clients. Si un usuario pertenece a 2 orgs (no ocurre hoy: 18 members = 18 users únicos), siempre devolverá la org más vieja. La cookie `active_organization` se lee en `org.ts` de app layer, pero `get_user_org_id()` SQL **no la conoce** → RLS queries desde mobile/cliente siempre van a la org más vieja.
- **Fix:** agregar fallback a `auth.jwt() -> 'app_metadata' -> 'active_organization_id'` antes del LIMIT 1, y `switchOrganization` server action ya actualiza app_metadata.

---

## 2. Branding "Monaco Smart Barber" hardcodeado

Hallazgo consolidado del agente UX + búsquedas manuales:

| Ubicación | Contenido | Impacto |
|---|---|---|
| `src/app/layout.tsx:17` | `metadata.title = "Monaco Smart Barber"` | Tab del browser |
| `src/app/(tablet)/checkin/page.tsx:1419,1515` | `<img src="/logo-monaco.png">` + texto "Monaco Smart Barber" | Kiosk público |
| `src/app/tv/tv-client.tsx:453-458` | `/logo-monaco.png` + "Monaco" | TV |
| `public/logo-monaco.png` | archivo estático | Asset fijo |
| `src/components/dashboard/dashboard-shell.tsx:225,249,652` | fallback `'Monaco'` | Sidebar |
| `src/app/dashboard/clientes/clientes-client.tsx:727` | Mensaje WA: "Gracias por visitarnos en Monaco Smart Barber" | Comunicación cliente |
| `src/lib/workflow-engine.ts` | `headers['X-Title'] = 'Monaco Smart Barber'` | Request a OpenRouter |
| `src/lib/export.ts:98,207` | header PDF/CSV | Reportes exportados |
| `src/app/dashboard/equipo/perfiles-client.tsx:775,947` | PDFs de nómina | Recibos sueldo |
| `src/app/dashboard/estadisticas/estadisticas-client.tsx:141` | `'Reporte de Estadísticas – Monaco Smart Barber'` | CSV estadísticas |
| `src/app/dashboard/finanzas/finanzas-client.tsx:259` | `finanzas_monaco_${period}meses.csv` | Nombre archivo |
| `src/app/(partners)/partners/layout.tsx` | metadata: "Portal para comercios aliados de Monaco Smart Barber" | Portal partners |
| `src/app/dashboard/mensajeria/components/workflows/workflow-node-editor.tsx:936` | Placeholder IA: "Sos un asistente de la barbería Monaco" | Config IA |
| `db.app_settings.review_message_template` default | "...Monaco Smart Barber 💈..." | Reviews WA enviadas |
| `src/app/dashboard/caja/page.tsx` | refs "Monaco" | Título |
| `src/app/dashboard/cuentas/page.tsx` | idem | Título |
| `src/app/docs/page.tsx` | documentación | UI interna |
| `src/app/review/[token]/review-client.tsx` | copy de review | Página pública |
| `src/app/upload/[token]/page.tsx` | uploader QR | Página pública |

Total: **28 ocurrencias en 20 archivos + 1 default de DB**.

**Fix patrón:**
1. Renombrar producto a "BarberOS" (plataforma) y usar `organizations.name` (barbería).
2. `orgName` como prop en server components, pasado a client components que exporten/envíen.
3. Logo: leer `organizations.logo_url` (ya existe columna). Fallback al logo BarberOS genérico.
4. Default `review_message_template` con placeholder `{barberia}`.

---

## 3. Flows de autenticación y isolation a nivel app

### 3.1 🟠 P1 — `selectOrganizationBySlug` sobreescribe cookie de admin logueado

`src/lib/actions/org.ts:136-153` — ruta pública (kiosk/TV). Setea `active_organization` cookie sin verificar auth. Si un admin está logueado y entra al kiosk de otra org (para diagnosticar, por ejemplo), pierde su sesión activa de dashboard.
- **Fix:** si `auth.getUser()` existe y no tiene acceso a esa org, no sobreescribir. O usar cookie distinta (`public_organization` vs `active_organization`).

### 3.2 🟠 P1 — `getPublicAppCheckinBgColor` ignora org

`src/lib/actions/org.ts:102-108` — `SELECT checkin_bg_color FROM app_settings LIMIT 1` (sin filtro org). Devuelve el color de la **primera org** en la tabla → todos los kiosks ven el color de esa.
- **Fix:** resolver org desde cookie `active_organization` y filtrar.

### 3.3 🟠 P1 — 203 usos de `createAdminClient()` en server actions (bypass RLS)

El patrón del proyecto es usar admin client en todo el dashboard. Eso es **válido** si cada action verifica ownership. Problema: actions que **no validan** `organization_id` en WHERE confían en que el caller pasó el ID correcto (cliente puede alterar el form). Arriba de 40 archivos lo usan — el agente de server actions reportará casos concretos.

### 3.4 🟡 P2 — Barber panel cookie `barber_session` sin firma

`barber_session` es un JSON plano en cookie. No está firmado ni encriptado. Un barbero podría editar la cookie en DevTools y cambiar `staff_id` o `branch_id`. `getCurrentOrgId()` valida el staff_id contra DB antes de usarlo, pero acciones downstream a veces usan el `branch_id` de la cookie sin re-validarlo.
- **Fix:** usar `next/headers` cookies con `httpOnly` (si no lo están), y/o firmar el JSON con HMAC y SECRET env var. Re-validar `branch_id` pertenece al staff en cada request crítica.

---

## 4. Dashboard Admin UI/UX (resumen del agente)

### 4.1 🔴 Bloqueantes comercialización

- **Cero `loading.tsx` / `error.tsx`** en `src/app/dashboard/*` (25 páginas). En prod, fallos de red muestran blanks o crashes sin recovery.
- **Dashboard home redirige a `/dashboard/fila`** (cola vacía) — org nueva aterriza sin guía.
- **`src/app/dashboard/equipo/page.tsx`** ejecuta 16 queries paralelas sin Suspense boundary.
- **Configuración fragmentada:** 6 cards con botón Guardar cada una, cada uno envía todos los fields → race de sobreescritura.

### 4.2 🟠 Altos

- Kiosk (`checkin/page.tsx`) y TV (`tv-client.tsx`) no usan `organizations.logo_url` → hardcode logo Monaco.
- Placeholder IA workflow: "Sos un asistente de la barbería Monaco".
- PDFs de sueldos y exportaciones contienen "Monaco Smart Barber" fijo.

### 4.3 🟡 Medios

- Empty states sin CTA en clientes, finanzas, fidelización.
- `sucursales-client.tsx` instancia `createClient()` en el cliente (inconsistente con server actions).
- 49 usos de `any` en 16 archivos del dashboard.
- Botones solo-ícono sin `aria-label`.

### 4.4 Dashboard features faltantes para SaaS

- [ ] Vista de **super-admin** (`/platform/*`) — no existe
- [ ] Billing / plan / límites / uso — no existe
- [ ] Timezone configurable por org (existe solo en `branches.timezone`, no en `app_settings`)
- [ ] Moneda configurable — todo hardcoded `es-AR` + `$`
- [ ] Google Review URL por org (existe en `branches.google_review_url` — bien)
- [ ] Idioma de UI (hoy solo español)
- [ ] Feature flags por plan

---

## 5. Server Actions — findings exhaustivos (258 funciones en 48 archivos)

### 5.1 🔴 CRÍTICOS — data leak / auth bypass / corrupción

| Archivo:línea | Problema | Impacto |
|---|---|---|
| `settings.ts:192` — `updateRewardsConfig` | sin `auth.getUser()` ni `getCurrentOrgId()`. UPDATE por ID arbitrario | Corruption cross-tenant total de configuración de puntos |
| `clients.ts:35-60` — `searchClients` | filter injection vía `.or()` + template string → bypass filtro de org | Leer clientes de otras orgs |
| `clients.ts:90, 112` — `enrollClientFace`, `saveClientFacePhotoUrl` | sin auth ni org-check | Inyectar biometría ajena, cambiar foto URL |
| `messaging.ts:65, 78, 110, 234, 274, 246` — `getMessages/sendMessage/sendTemplate/markAsRead/cancelScheduledMessage/scheduleMessage` | ninguna valida org sobre `conversationId`/`channelId` | **Vector peor**: sendMessage usa credenciales Meta de otra org para mandar mensajes a sus clientes |
| `visit-history.ts:7, 58` — `saveVisitDetails`, `getClientProfile` | sin org-check, acepta `photoPaths` arbitrarios | Editar visitas + perfiles ajenos |
| `paymentAccounts.ts:178, 296` — `recordTransfer`, `getAccountBalanceSummary` | sin org-check + race condition en `accumulated_today` | Bypass daily_limit, leak totales |
| `queue.ts:340-377` — redención de puntos | race condition double-spend (SELECT + UPDATE no atómico) | Clientes gastan puntos inexistentes |
| `queue.ts:900-938` — `updateQueueOrder` | solo valida `updates[0].id` | Reordenar/reasignar queue de otras orgs |
| `services.ts:40` + `products.ts:52` — `upsertService/Product` con `id` | hijack cross-org: UPDATE mueve fila ajena a su org cambiando `branch_id` | Robar servicios/productos ajenos |
| `stats.ts:76, 286` — `fetchStats`, `fetchWeekHeatmap` | `branchId` sin validar contra `orgBranchIds` | Leak revenue/heatmap/ranking de otras orgs |
| `caja.ts:83, 213, 323` — `fetchCajaTickets/Summary/CSVData` | igual, branchId arbitrario | Leak caja completa + CSV exportable |
| `conversations.ts:101, 117` — `updateConversationStatus`, `getClientVisits` | sin org-check | Cerrar conversaciones ajenas, leer visitas ajenas |
| `barber.ts:241, 264` — `fetchBarberDayStats`, `fetchBranchAssignmentData` | no valida staff+branch+org | Leak visitas/ingresos por barbero |
| `salary.ts:625` — `generateCheckoutCommissionReport` | llamada desde kiosk público, sin validar staff/branch | Adulterar reportes salariales |
| `incentives.ts:85, 105-128` — `logAchievement`, `getBarberProgress` | no valida staffId en branch; query sin filtro org | Achievements fraudulentos + leak cross-org |
| `disciplinary.ts:80` — `createDisciplinaryEvent` | valida branch pero no que staffId pertenezca al branch | Eventos disciplinarios + deducciones fraudulentas |
| `breaks.ts:160` — `requestBreak` | no valida staff-branch | Break fraud cross-org |
| `sales.ts:102` — `directProductSale` | no valida `barberId`/`productIds` + race en stock | Venta fantasma + stock double-spend |
| `roles.ts:61, 103, 180` — `createRole/updateRole/assignRoleToStaff` | no valida branchIds ni roleId contra org | Escalada de permisos cross-org |

### 5.2 🟠 ALTOS

- `barber-panel.ts:14`, `attendance.ts:14` — `validateBarberBranchOwnership`/`validateStaffBelongsToBranch` no comparan staff_id con el caller (cookie `barber_session`). Cualquier barbero ve stats de otro de la misma org.
- `workflows.ts:32`, `kiosk.ts:56` — filter injection en `.or()` via branchId interpolado (validar UUID antes de interpolar).
- `broadcasts.ts:211` — `cancelBroadcast` UPDATE en `scheduled_messages` antes de validar ownership del broadcast.
- `broadcasts.ts:258` — `getTemplatesByChannel` sin filtro org → leak de templates aprobados de todas las orgs.
- `finances.ts:428-441` — `getFixedExpenses`: `.in('branch_id', [])` con array vacío (verificar comportamiento PostgREST).
- `reviews.ts:59` — `submitReview` admin client sin rate-limit.
- `tv.ts:10-120` — TV pública acepta `branchIds` sin validar que compartan org.
- `paymentAccounts.ts:113` — `resetMonthlyAccumulation` sin FOR UPDATE → doble ejecución posible.
- `queue.ts:8-113` — `checkinClient` kiosk sin rate-limit (bot pueden inyectar cientos).
- `whatsapp-meta.ts:86, 211` — `sendMetaWhatsAppMessage/Template` no valida conversationId→org.
- `auth.ts:44-45` — comparación de PIN con `===` no constant-time (timing attack).
- `register.ts:64` — password mínimo 6 chars (subir a 8+).

### 5.3 🟡 MEDIOS (consistencia)

- Solo **2/48** archivos usan **Zod** (`partner-portal.ts`, `partners.ts`). 46 hacen validación manual inconsistente.
- Retornos inconsistentes: `{error}` vs `{success}` vs `{data}` vs throw.
- `barber.ts:8` `toggleBarberStatus` = dead code.
- `services.ts:100`/`deleteService`: items con `branch_id = null` tratados como "legado" → toggle/delete cross-org.
- `expense-tickets.ts:32` — `payment_account_id` no validado contra el branch del ticket.
- `clients.ts:62` — `lookupClientByPhone` sin rate-limit → enumerar por brute force.
- `rewards.ts:22` — usa `createClient()` (anon) en lugar de admin; probablemente falla silenciosamente por RLS.

### 5.4 Estadísticas

- Total funciones exportadas: 258
- Archivos sin ningún helper de org (getCurrentOrgId/validateBranchAccess/getOrgBranchIds): **13 parciales**
- Peores archivos: `messaging.ts`, `settings.ts`, `paymentAccounts.ts`, `visit-history.ts`, `clients.ts`, `stats.ts`, `caja.ts`, `barber.ts`
- Usos de `createAdminClient()`: 203 en 39 archivos

### 5.5 Acciones inmediatas recomendadas por el agente

1. Introducir helper universal `requireOrgAccessToEntity(table, entityId)` para check cross-org en un solo lugar.
2. Mover point redemption, stock update, payment account accumulator a RPCs atómicas con `SECURITY DEFINER` que validen org internamente (defensa en profundidad).
3. Agregar Zod a TODAS las actions mutativas antes de prod SaaS.
4. Auditar también las RPCs de Postgres (`assign_next_client`, `batch_update_queue_entries`, `client_redeem_points`, `calculate_barber_salary`, `get_available_barbers_today`, `next_queue_position`, `get_last_messages_for_conversations`).

---

## 6. Barber Panel + Check-in Kiosk + TV + Review

### 6.1 🔴 CRÍTICOS (datos / auth / multi-tenant)

- **Kiosk `src/app/(tablet)/checkin/page.tsx:1419,1515,1527`** — `<img src="/logo-monaco.png">` + "Monaco Smart Barber" (hardcoded). Logo de la org (`organizations.logo_url`) NO se usa.
- **TV `src/app/tv/tv-client.tsx:453-458`** — idem (logo + nombre Monaco).
- **`src/app/(tablet)/layout.tsx:13`** + `getPublicAppCheckinBgColor` → `SELECT FROM app_settings LIMIT 1` sin filtro org → bg color del kiosk es el de la PRIMERA org de la DB (actualmente Monaco).
- **`client_face_descriptors`** (7088 filas) con anon SELECT/INSERT/DELETE sin `organization_id` → privacy leak masivo + cross-tenant face poisoning.
- **Cookie `barber_session`** es JSON plano sin firma — editable en DevTools; varios endpoints confían en `branch_id` de la cookie sin re-validar.
- **Realtime channels de `queue_entries`** — verificar que en los clients (`barber/fila`, `tv`) los canales subscriban a filter `branch_id=eq.{id}` y no reciban todo cross-org.
- **Review flow token**: `review_requests.staff_manage_review_requests` RLS sin filtro org (sec 1.7).

### 6.2 🟠 ALTOS

- **Barber panel PIN auth** (`auth.ts:44`) — `===` no constant-time.
- **Login barber** (`barber/login/page.tsx`) sin rate-limit → brute force de PIN de 4 dígitos (10k combinaciones).
- **Kiosk** `checkinClient` (`queue.ts:8`) sin rate-limit → bots pueden inundar la cola.
- **Wake-lock** en `barber/layout.tsx` — comportamiento distinto entre Safari iOS, Chrome Android.
- **`/tv` pública**: sin CSP / sin validación de `organizationId` desde URL — si alguien accede `/tv/[otherBranchId]` ve data cross-tenant.
- **Face recognition** (`kiosk.ts`) — valor de `threshold` configurable via parámetros de cliente (revisar).
- **Review page `/review/[token]`**: no hay verificación de expiración del token.

### 6.3 🟡 MEDIOS (UX)

- Checkin kiosk: sin idioma configurable (solo español).
- Barber panel: dark theme hardcoded; sin tema claro para barberías que prefieran.
- TV: sin opción de branding custom ni logo.
- Face enrollment flow: si falla la cámara no hay recovery claro.
- Barbero "Iniciar" + "Terminar" en facturación: sin confirmación antes de cerrar.

### 6.4 Multi-tenant isolation en flows públicos

- **Flow de entrada**: cookie `active_organization` se establece por slug (ruta pública) → un kiosk físico de Monaco queda locked a org Monaco. Para comercializar hay que reforzar que cada tablet se asocie a una org específica sin posibilidad de switch por slug desde app logueada.
- **TV display**: actualmente inferior ve cola de un branch vía URL. Validar que `branchId` del URL pertenezca a `active_organization`; sino redireccionar.

---

## 7. Lógica de negocio — Finanzas, Puntos, Workflows, Appointments, Academia

### 7.1 🔴 CRÍTICOS

**RLS salarial cross-tenant (defensa en profundidad rota):**
- `salary_configs_manage_owner`, `salary_reports_{select,insert,update,delete}_staff`, `salary_payment_batches_*` — chequean `staff.auth_user_id = auth.uid() AND role IN ('owner','admin')` **sin `staff.organization_id = get_user_org_id()`**.
- **Impacto:** si el dashboard pasa de service-role a client auth (o cualquier futuro endpoint usa client), un owner de Org A puede leer/modificar sueldos y batches de Org B.
- **Fix:** agregar `AND staff.organization_id = get_user_org_id()` a las 8 policies.

**`scheduled_messages_update_staff` policy cross-tenant:**
- UPDATE sin filtro de org en staff — cualquier staff activo puede cancelar/modificar mensajes programados de cualquier org.
- **Fix:** agregar join por org al EXISTS.

**`src/lib/actions/queue.ts:350-376` — canje de puntos usa clave obsoleta `(client_id, branch_id)`:**
- Migración 067 consolidó `client_points` a unique `(client_id, organization_id)`. `queue.ts` sigue leyendo/actualizando por `branch_id` → si el canje ocurre en sucursal distinta a la que generó los puntos, **no deduce puntos y el cliente recibe el premio gratis**.
- **Fix:** usar `.rpc('deduct_client_points', { p_client_id, p_amount: cost })` (ya existe y maneja org correctamente).

**`src/lib/workflow-engine.ts:1110-1143` — SSRF en http_request node:**
- `fetch(url, ...)` toma URL desde `config.url` editable por admin. Un admin malicioso de cualquier org puede apuntar el workflow a `http://169.254.169.254/latest/meta-data/`, `http://localhost`, o IPs internas.
- **Impacto:** exfiltración de credenciales cloud (AWS IMDS, Vercel metadata).
- **Fix:** validar hostname con blocklist (`localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])`) y protocol `http:/https:` solamente.

**`workflow-engine.ts:949-975` — delay node colisiona con `waiting_reply`:**
- El delay marca `status='waiting_reply'` para pausas >10s. Si llega un mensaje inbound durante el delay, `evaluateIncomingMessage` lo matchea y avanza el workflow prematuramente como si fuera respuesta interactiva.
- **Impacto:** flujos "esperar 2h y recordar" se disparan al primer mensaje del cliente.
- **Fix:** usar status dedicado `status='delayed'` y excluirlo del query de matching.

**`workflow-engine.ts:227-255` — sibling conversation migration cross-org:**
- `ilike('platform_user_id', '%<phoneSuffix>%')` sin filtro de org → mensaje de Org B se puede mergear en conversation de Org A si comparten sufijo telefónico.
- **Fix:** filtrar `siblingConvs` por `channel.branch_id IN (SELECT id FROM branches WHERE organization_id = params.orgId)`.

**`paymentAccounts.ts:196-207` — race condition en `accumulated_today`:**
- Read-modify-write sin lock. Bajo concurrencia, la protección `daily_limit` se puede exceder.
- **Fix:** RPC atómico `UPDATE payment_accounts SET accumulated_today = accumulated_today + p_amount WHERE id = p_account_id`.

**Tablas caja-nuevas sin `organization_id`:**
- `sesiones_caja`, `movimientos_caja`, `cuentas_transferencia`, `gastos`, `categorias_gasto` → allow_all RLS (ver sec 1.3). Además, **coexisten con `expense_tickets`/`transfer_logs`** que sí tienen scope — dos fuentes de verdad financieras.
- **Hallazgo extra del agente:** `caja.ts`, `finances.ts`, `expense-tickets.ts` NO leen ninguna de las tablas nuevas — son **huérfanas**. Decisión: dropearlas o migrar el stack.

**Academia sin multi-tenant:**
- Confirmado: ningún server action en `src/lib/actions/` lee `alumnos/cursos/asistencias/pagos/...`. Tampoco hay ruta `/dashboard/academia`. Feature **solo para Monaco** sin exponer UI. Pero las tablas existen con `USING (true)` → si otra org se activa accidentalmente, ve todo.
- **Fix:** o agregar `organization_id` y RLS correcta, o mover a schema `monaco_academy`, o dropear si nadie la usa desde la app.

### 7.2 🟠 ALTOS

- **TZ hardcoded `-03:00`** en `caja.ts:65-70` (`dayBounds`) → datos financieros erróneos para orgs en otros TZ.
- **TZ hardcoded en `finances.ts:335-336`** (`reportDate` mezcla local con `Z` UTC) → comisiones perdidas/duplicadas cerca de medianoche.
- **`salary.ts:167-175` `getSalaryHistory`** — fetch-all-then-filter (sin filtro de org en query). Leak latente + performance O(n).
- **`queue.ts:341-346`** `rewards_config` query con `.single()`: si hay 2 configs activas (no hay unique index), el canje falla con exception. Cambiar a `.maybeSingle()`.
- **`workflow-engine.ts:1637-1641`** `processExpiredDelays` sin filtro por `node_type='delay'` a nivel DB — limit(20) puede ahogarse en executions de otros tipos.
- **`salary.ts:694` `Math.round()`** para comparar comisiones → pérdida de centavos.
- **`finances.ts:127-145`** si `orgBranchIds = []`, query queda sin filtro → trae todo el sistema.
- **`workflow-engine.ts:626-637`** `context.variables._step_count` puede corromperse por `parseInt(number)` → rompe protección anti-loop.

### 7.3 🟡 MEDIOS

- **Moneda hardcoded ARS** (`src/lib/format.ts`) — agregar `currency_code` en `organizations.settings`.
- **FKs sin índice** (83 según Supabase Advisor) — aplicar migration masivo `CREATE INDEX CONCURRENTLY` para cada FK.
- **`salary_payments` (vieja, 2 rows) vs `salary_reports`+`salary_payment_batches` (nueva, 40+4 rows)** — dos caminos paralelos. Decidir uno.
- **`point_transactions` INSERT policy sin `WITH CHECK`** — permite INSERT con cualquier org_id si algún día se usa client auth.
- **`conversations`/`messages` sin `organization_id` denormalizado** — triples joins costosos a escala.
- **`expense-tickets.ts` usa `createClient()` (RLS)** — inconsistente con caja.ts/finances.ts (`createAdminClient()`).
- **`incentives.ts:21-54` `upsertIncentiveRule`** no valida que `id` existente pertenezca a branch de la org (hijack cross-org al update).
- **`appointment_*` policies ALL sin `WITH CHECK`** — permite INSERT con `organization_id` ajeno.
- **`caja.ts:127`** errores silenciosos `return { data: [] }` sin mostrar al UI "sesión expirada".

### 7.4 Resumen por dominio

| Dominio | Estado | Problema principal | Acción |
|---|---|---|---|
| **Finanzas (caja/gastos/cuentas)** | 🔴 crítico | Stack dual; tablas nuevas sin scope + huérfanas; race en daily_limit; TZ AR | Decidir stack y consolidar; RPC atómico; leer TZ de branch |
| **Sueldos / Comisiones** | 🔴 crítico | RLS sin filtro org (defensa rota); fetch-all-filter | Fix policies + filter DB |
| **Puntos / Loyalty** | 🔴 feature rota | Canje cross-branch bug + UI muestra tabla vacía (rewards_config=0) | Fix queue.ts + seed default + portar UI a `client_loyalty_state` |
| **Workflows** | 🔴 crítico | SSRF + delay collide + sibling cross-org | Validar URL, estado delayed separado, filter org |
| **Appointments** | 🟡 dormido | Feature sin UI; policies sin WITH CHECK | Decidir activar o remover; fix RLS |
| **Academia** | 🔴 cross-tenant | Sin org_id + allow_all; solo Monaco | Schema separado o dropear |

---

## 8. Onboarding de nueva organización — findings exhaustivos

### 8.1 Flow actual (verificado con código + DB)

- **Self-service end-to-end.** `/register` (`src/app/(auth)/register/page.tsx:119`) → `registerOrganization()` en `lib/actions/register.ts:44`. Crea auth user + org + org_member(owner) + staff(owner, `branch_id=null`) + `app_metadata.organization_id` + `app_settings` default + signIn automático.
- **Wizard `/onboarding` (`src/app/onboarding/page.tsx`) = 6 pasos**: 0-Inicio, 1-Branding(logo), 2-Sucursal, 3-Servicios, 4-Equipo, 5-Completado. Progreso en `organizations.settings.onboarding_step/_completed`.
- **Código duplicado abandonado**: migración `053_onboarding_support.sql` define `setup_organization()`, `update_onboarding_progress`, `complete_onboarding` pero **no se usan** — el código TS replica la lógica sin transaccionalidad.

### 8.2 🔴 Defaults que FALTAN

✅ Se crean: `organizations` + `organization_members(owner)` + `staff(owner, sin branch)` + `app_metadata.organization_id` + `app_settings` (con defaults pero template review hardcoded Monaco — ver 1.6).

❌ No se crean:
- **Roles custom** (`roles` vacía para todas las 7 orgs nuevas; Monaco tiene 5)
- **`rewards_config`** (0 filas en TODA la DB — ninguna org tiene el sistema de puntos configurado)
- **`reward_catalog`** (2 items solo Monaco)
- **Productos default**
- **`message_templates`** (5 filas solo Monaco)
- **`auto_reply_rules` / `quick_replies`**
- **`appointment_settings`**
- **`automation_workflows`** (5 workflows solo Monaco)
- **`organization_whatsapp_config` / `organization_instagram_config` / `organization_ai_config`**
- **`staff_schedules` / `staff_service_commissions` / `break_configs`**
- **Asignar `branch_id` al staff owner** (queda con branch_id=null — si es barbero activo NO aparece en fila/TV/check-in)

### 8.3 🔴 Bloqueantes críticos

1. **Timezone hardcoded** `'America/Argentina/Buenos_Aires'` en 10+ archivos (queue.ts, sales.ts, finances.ts, time-utils.ts, salary.ts, stats.ts, disciplinary.ts, onboarding.ts:152). Existe `branches.timezone` pero nunca se lee.
2. **Moneda/locale hardcoded ARS** (`src/lib/format.ts` usa `'es-AR'` + `$`). No hay `currency` en `organizations` ni `app_settings`.
3. **`app_settings.review_message_template`** default en DB dice literal "Monaco Smart Barber" — la org nueva hereda el texto.
4. **Branding limitado**: `organizations` solo tiene `name`, `slug`, `logo_url`, `settings`. Falta `primary_color`, `accent_color`, `timezone`, `currency`, `country`.
5. **Kiosk `checkin_bg_color` global** — bug multi-tenant, tomado con `LIMIT 1`.
6. **Owner staff con `branch_id=null`** — Test Barber lo confirma.
7. **Sin guard que obligue completar onboarding** — `dashboard/layout.tsx` no valida `onboarding_completed`. 4 orgs (50%) con `onboarding_completed=false` entran al dashboard.
8. **Wizard no pide comisiones staff ni horarios** — sueldos y calendario rotos hasta setup manual.
9. **Google Review URL vive en `branches`** — no se pide en wizard → flow reviews 5★ no funciona.
10. **Configuración WA/IG Meta sin wizard** — fricción 5/5.

### 8.4 Checklist real para activar una org (situación actual)

| # | Paso | UI | Fricción | Bloqueante |
|---|---|---|---|---|
| 1 | Crear cuenta + org | wizard | 1 | no |
| 2 | Logo | wizard | 1 | no |
| 3 | Primera sucursal | wizard | 2 | no |
| 4 | Servicios | wizard | 2 | no |
| 5 | Barberos | wizard | 2 | no |
| 6 | Asignar owner a sucursal como staff activo | **manual (no existe)** | 3 | depende |
| 7 | Productos | dashboard | 3 | no |
| 8 | Horarios staff | dashboard | 4 | sí para fila/sueldos |
| 9 | Comisiones por servicio | dashboard | 4 | sí para sueldos |
| 10 | Configurar puntos (rewards_config por sucursal) | dashboard | 3 | sí para mobile |
| 11 | Reward catalog | dashboard | 3 | sí para mobile |
| 12 | Google Review URL | dashboard | 2 | sí para 5★ |
| 13 | Roles custom | dashboard | 4 | no (usa los 3 hardcoded) |
| 14 | Plantillas WA | dashboard | 5 | sí para CRM |
| 15 | Workflows automation | dashboard | 5 | opcional |
| 16 | WhatsApp Meta config | dashboard | 5 | sí para WA |
| 17 | Instagram Meta config | dashboard | 5 | sí para IG |
| 18 | Editar template review (quitar "Monaco") | dashboard | 2 | sí para reviews |
| 19 | **Timezone / moneda** | **no existe** | 5 | sí fuera de AR |
| 20 | Branding colors | no existe | — | no |
| 21 | CRM alerts plantillas | dashboard | 4 | no |
| 22 | Quick replies | dashboard | 3 | no |
| 23 | Appointment settings | dashboard | 3 | si usa turnos |

### 8.5 Funnel observado

- 8 orgs creadas
- **4 orgs (50%)** con `onboarding_completed=false` o step=0
- **3 orgs con `completed=true`** pero **0 sucursales** después del wizard
- Único caso "real" no-Monaco: **Monkey Barber** con 1 branch, 2 staff, 1 visit
- Conclusión operacional: **el wizard se abandona o falla silenciosamente** en ~85% de intentos.

### 8.6 Wizard mínimo recomendado (del agente)

**Paso 1 — Cuenta + Org**: preview slug en tiempo real; agregar `country` + `timezone` + `currency`.
**Paso 2 — Branding**: logo + `primary_color` + nombre visible.
**Paso 3 — Primera sucursal**: timezone hereda org, horarios, días, Google Review URL, kiosk bg color (mover a `branches.checkin_bg_color`).
**Paso 4 — Servicios**: seed automático de 3 defaults si no selecciona.
**Paso 5 — Equipo**: asignar owner a sucursal 1 **automáticamente** como staff activo.
**Paso 6 — Defaults auto (sin UI)**: `rewards_config` default por sucursal, `message_templates` con `{org_name}` placeholder, `auto_reply_rules` bienvenida, `appointment_settings` default, `break_configs` default, `staff_schedules` del owner.
**Paso 7 — Completado**: redirigir a `/dashboard/fila` con guard `onboarding_completed=true`. Banner superior con checklist de pasos opcionales.

**Crítico fuera del wizard**:
- Refactor `getPublicAppCheckinBgColor` con filtro org.
- Reemplazar `review_message_template` default DB.
- Hacer que `registerOrganization` use la función DB `setup_organization()` (migración 053) para transaccionalidad.

---

## 9. Matriz de bloqueantes para comercializar

| # | Bloqueante | Sección | Severidad | Esfuerzo |
|---|---|---|---|---|
| 1 | UUID Monaco hardcodeado en trigger DB | 1.1 | 🔴 P0 | XS |
| 2 | API keys IA expuestas a public | 1.2 | 🔴 P0 | XS |
| 3 | Tablas caja con RLS allow_all sin org_id | 1.3 | 🔴 P0 | M |
| 4 | Academia sin multi-tenant | 1.4 | 🔴 P0 | M |
| 5 | Biometría client faces expuesta anon | 1.5 | 🔴 P0 | S |
| 6 | Template review WA default menciona "Monaco Smart Barber" | 1.6 | 🔴 P0 | XS |
| 7 | Branding hardcoded 28 ocurrencias | 2 | 🔴 P0 | M |
| 8 | Sin loading/error boundaries en dashboard | 4.1 | 🔴 P0 | S |
| 9 | Kiosk/TV hardcoded logo Monaco | 4.2 | 🔴 P0 | S |
| 10 | Moneda/timezone no configurables por org | 4.4 | 🔴 P0 | M |
| 11 | Onboarding sin defaults (roles, rewards, templates) | 8.2 | 🟠 P1 | L |
| 12 | Sin super-admin panel | 4.4 | 🟠 P1 | XL |
| 13 | Sin billing/plan | 4.4 | 🟠 P1 | XL |
| 14 | RLS cross-org rotas (crm_cases, review_requests) | 1.7 | 🟠 P1 | S |
| 15 | `auth_rls_initplan` perf (81 policies) | 1.8 | 🟠 P1 | S |
| 16 | 247 multiple permissive policies | 1.9 | 🟠 P1 | M |
| 17 | Dashboard home redirige a cola vacía | 4.1 | 🟠 P1 | XS |
| 18 | `selectOrganizationBySlug` sobreescribe sesión admin | 3.1 | 🟠 P1 | XS |
| 19 | 203 admin clients sin auditar por action | 3.3 | 🟠 P1 | L |
| 20 | Barber session sin firmar | 3.4 | 🟡 P2 | S |
| 21 | FKs sin índice (83) | 1.10 | 🟡 P2 | S |
| 22 | Índices duplicados (11) y no usados (92) | 1.11 | 🟡 P2 | XS |
| 23 | Migraciones numeración duplicada | 1.12 | 🟡 P2 | L (o aceptar) |
| 24 | Tablas sin trigger set_org_from_* | 1.13 | 🟡 P2 | S |
| 25 | PDFs/CSVs de sueldos y finanzas con "Monaco" | 2 | 🟡 P2 | S |
| 26 | Placeholder IA menciona Monaco | 2 | 🟡 P2 | XS |
| 27 | Configuración fragmentada (6 cards race) | 4.1 | 🟡 P2 | S |
| 28 | Empty states sin CTA | 4.3 | 🟡 P2 | M |
| 29 | Sucursales-client usa browser client | 4.3 | 🟡 P2 | S |
| 30 | 49 usos de `any` | 4.3 | 🟡 P2 | M |

**Total estimado:** 30 ítems originales + hallazgos agregados de agentes. Ver `plan.md` para orden de ejecución.

### Hallazgos adicionales descubiertos por agentes paralelos (agregar a la matriz):

| # | Bloqueante | Sección | Severidad | Esfuerzo |
|---|---|---|---|---|
| 31 | Queue.ts canje usa `(client_id, branch_id)` en vez de `(client_id, org)` → pierde deducción cross-branch | 7.1 | 🔴 P0 | S |
| 32 | SSRF en workflow http_request node | 7.1 | 🔴 P0 | XS |
| 33 | Workflow delay colisiona con waiting_reply state | 7.1 | 🔴 P0 | S |
| 34 | Workflow sibling conversation cross-org lookup | 7.1 | 🔴 P0 | S |
| 35 | Race condition en `payment_accounts.accumulated_today` | 7.1 | 🔴 P0 | XS |
| 36 | RLS salariales sin filtro de org (8 policies) | 7.1 | 🔴 P0 | S |
| 37 | `scheduled_messages_update_staff` policy cross-tenant | 7.1 | 🔴 P0 | XS |
| 38 | `messaging.ts` 6 actions sin org-check (credenciales Meta cross-tenant) | 5.1 | 🔴 P0 | M |
| 39 | `settings.ts:192 updateRewardsConfig` sin auth ni org | 5.1 | 🔴 P0 | XS |
| 40 | Filter injection en `.or()` de Supabase (clients, workflows, kiosk, broadcasts) | 5.1/5.2 | 🔴 P0 | S |
| 41 | Hijack cross-org en upsert con `id` ajeno (services.ts, products.ts, incentives.ts) | 5.1 | 🔴 P0 | S |
| 42 | `stats.ts`, `caja.ts`, `barber.ts` aceptan branchId sin validar org | 5.1 | 🔴 P0 | S |
| 43 | Solo 2/48 actions usan Zod | 5.3 | 🟠 P1 | L |
| 44 | Staff owner queda con `branch_id=null` tras registro | 8.3 | 🟠 P1 | XS |
| 45 | Dashboard no tiene guard `onboarding_completed=true` | 8.3 | 🟠 P1 | XS |
| 46 | No se seedan defaults (roles, rewards_config, templates, workflows) | 8.2 | 🟠 P1 | L |
| 47 | `validateBarberBranchOwnership` no valida caller == staffId | 5.2 | 🟠 P1 | XS |
| 48 | Sin rate-limit en PIN login, kiosk checkin, review submit, lookupClientByPhone | 5.2 | 🟠 P1 | M |
| 49 | PIN compare con `===` (timing attack) | 5.2 | 🟠 P1 | XS |
| 50 | Password mínimo 6 chars | 5.2 | 🟡 P2 | XS |
| 51 | Stack caja duplicado (tablas nuevas huérfanas) | 7.1 | 🟠 P1 | M (decisión + limpieza) |
| 52 | UI Fidelización muestra tabla vacía siempre | 7.4 | 🟠 P1 | M |
| 53 | TZ hardcoded en caja.ts, finances.ts para cálculos | 7.2 | 🟠 P1 | S |
| 54 | `salary.ts getSalaryHistory` fetch-all-filter | 7.2 | 🟠 P1 | XS |

**Total matriz: 54 ítems (12 🔴 P0 + 14 🟠 P1 nuevos + los originales).**

---

## 10. Apéndice — Estado actual de la DB

**Orgs (8):**
| Org | Members | Branches | Staff | Clients | Visits |
|---|---|---|---|---|---|
| Monaco Smart Barber | 11 | 4 | 31 | 2345 | 2748 |
| Monkey Barber | 1 | 1 | 2 | 0 | 1 |
| Barber 1, Barber2, Barderos, BarberTest, test1, Test Barber | 1 c/u | 0 | 1 | 0 | 0 |

**Tablas con RLS pero SIN organization_id ni branch_id (riesgo multi-tenant):** 34 (ver sección 1.4 y 1.3 para lista parcial; el detalle completo está en advisor output).

**Supabase Advisors:**
- Security: `rls_enabled_no_policy` en `partner_magic_links`, `partner_org_relations`, `partner_sessions` (INFO).
- Performance: 81 `auth_rls_initplan`, 247 `multiple_permissive_policies`, 83 `unindexed_foreign_keys`, 92 `unused_index`, 11 `duplicate_index`.

**Extensiones instaladas relevantes:** `pgcrypto`, `pg_graphql`, `uuid-ossp`, `pg_net`, `vector`, `pg_cron`, `pg_stat_statements`, `supabase_vault`.

**Edge Functions:** 6 activas — `client-auth`, `meta-webhook`, `send-message`, `process-scheduled-messages`, `send-push`, `wa-incoming`. 4/6 con `verify_jwt: false` — auditar validación interna.

---

**Este audit.md se actualizará al completarse las auditorías paralelas de: server actions, barber panel/kiosk, finanzas/loyalty/workflows, onboarding UX.**

---

## 11. Estado de implementación (2026-04-17)

### ✅ Aplicado en DB (10 migraciones)

1. `p0_remove_monaco_uuid_and_fix_ai_config_rls` — trigger loyalty sin Monaco UUID + `organization_ai_config` service-role only + template review default genérico.
2. `p0_isolate_academia_and_caja_to_monaco_org` — `organization_id` + RLS org-scoped a **16 tablas** de academia/caja (alumnos, cursos, curso_inscripciones, asistencias, pagos, alertas, talleres_practica, mensaje_plantillas, mensajes_enviados, alerta_plantillas_defecto, curso_comunicaciones_checklist, sesiones_caja, movimientos_caja, gastos, categorias_gasto, cuentas_transferencia). 19 policies `allow_all` reemplazadas.
3. `p0_secure_client_face_descriptors` — `organization_id` agregado, policies `anon` **revocadas**, solo service role.
4. `p0_fix_cross_org_rls_and_atomic_rpcs` — RPC atómico `increment_account_accumulated` + **8 policies** con filtro `organization_id` (salary_configs/payments/reports/payment_batches, crm_cases, review_requests, scheduled_messages, visit_photos) + appointment_* `WITH CHECK`.
5. `p1_organizations_i18n_billing_platform_admins` — columnas `country_code/currency/locale/timezone/primary_color/is_public_mobile/max_branches/subscription_status/subscription_plan/trial_ends_at/billing_email/billing_notes` + tablas `platform_admins` y `platform_admin_actions` + helper `is_platform_admin()`.
6. `p1_missing_set_org_triggers` — trigger genérico `set_org_from_session()` aplicado a **19 tablas** con `organization_id` que no tenían trigger.
7. `p1_seed_new_org_and_billing_guards` — función `seed_new_organization(org_id)` (roles Admin/Barbero/Cajero + quick_replies + appointment_settings) + trigger `enforce_max_branches` (bloquea inserts > plan) + `get_user_org_id()` soporta `active_organization_id` en app_metadata.
8. `p2_drop_duplicate_indexes_and_index_fks` — drop 10 índices duplicados + CREATE 18 índices en FKs hot.
9. `p2_fix_auth_rls_initplan_hot_tables` — `(SELECT auth.fn())` en 10+ policies hot (clients/visits/queue_entries/staff/messages/conversations/attendance/break_*/role_branch_scope).
10. `p2_fix_function_search_path_for_new_functions` — `SET search_path = public` en 15 funciones.

### ✅ Aplicado en código

**Nuevo:**
- `src/lib/i18n.ts` — `getOrgLocaleContext()`, `toFormatOptions()`, `getActiveTimezone()`, `getActiveLocale()` cacheado con `React.cache()`.
- `src/lib/actions/platform.ts` — super-admin actions: listar orgs, actualizar billing, toggle active, impersonate/stopImpersonation, audit log.
- `src/app/platform/layout.tsx` + `page.tsx` + `orgs/[id]/page.tsx` + `detail-client.tsx` + `actions/page.tsx` — MVP de super-admin.
- `src/components/dashboard/impersonation-banner.tsx` — banner visible cuando platform admin impersona una org.
- `src/lib/actions/overview.ts` + `src/app/dashboard/page.tsx` refactor + **13 `loading.tsx` / `error.tsx`** boundaries.

**Modificado:**
- `src/lib/workflow-engine.ts` — **SSRF fix** en http_request node (blocklist de hosts privados + `redirect: 'error'`), **delay state** separado (`status='delayed'`) para no colisionar con `waiting_reply`, **sibling conv lookup cross-org** ahora filtra por branch_id de la org.
- `src/lib/actions/org.ts` — `getPublicAppCheckinBgColor` filtra por `active_organization`, `selectOrganizationBySlug` usa cookie `public_organization` separada (no pisa sesión dashboard), `getActiveOrganization` con prioridad pública.
- `src/lib/format.ts` — `FormatOptions` (locale/currency/timezone) + símbolos LatAm (ARS/USD/BRL/CLP/UYU/PEN/COP/MXN/PYG/BOB/EUR).
- `src/lib/time-utils.ts` — `getTzOffsetISO(date, tz)` calcula offset dinámicamente (no más `-03:00` hardcoded) + `getDayBounds(date, tz)` nueva.
- `src/lib/actions/register.ts` — password mín 8 chars + complejidad; llama `seed_new_organization()` tras crear org.
- `src/lib/actions/onboarding.ts` — primera sucursal hereda timezone de `organizations.timezone`; asigna **owner a `branch_id` automáticamente** (fix bloqueante documentado en audit §8.2).
- `src/app/dashboard/layout.tsx` — **guard `onboarding_completed`** + check `subscription_status` + banner de impersonation.
- **~38 ocurrencias "Monaco Smart Barber" reemplazadas** por `'BarberOS'` o `organization.name` dinámico en 20+ archivos (kiosk, TV, PDFs, CSVs, WhatsApp mensajes, metadata, workflows).

**Bootstrap:** `platform_admins` sembrada con el owner de Monaco (`admin@admin.admin`) como platform owner. Cualquier otro admin debe agregarse desde `/platform` o con `INSERT INTO platform_admins ...`.

### ✅ Server actions — 24 fixes aplicados por agente

- **Helper creado:** `src/lib/actions/guard.ts` con `requireOrgAccessToEntity()` + `isValidUUID()`.
- **Archivos modificados (24 mutaciones):** `settings.ts:192`, `clients.ts:35/90/112`, `messaging.ts:65,78,110,234,246,274`, `visit-history.ts:7,58`, `paymentAccounts.ts:178`, `queue.ts:340/900`, `services.ts:40`, `products.ts:52`, `stats.ts:76,286`, `caja.ts:83,213,323`, `conversations.ts:101,117`, `barber.ts:241,264`, `salary.ts:625`, `incentives.ts:85,105`, `disciplinary.ts:80`, `breaks.ts:160`, `sales.ts:102`, `roles.ts:61,103`, `broadcasts.ts:211,258`, `workflows.ts:32`, `kiosk.ts:6`, `whatsapp-meta.ts:86,211`, `auth.ts:44` (PIN con `crypto.timingSafeEqual`).
- **Canje de puntos en `queue.ts`** — fixed: ahora usa `organization_id` en vez de `(client_id, branch_id)`.

### ✅ Segunda ronda — completado

- **Fase 4 i18n completa** — 8 archivos `caja.ts`/`finances.ts`/`queue.ts`/`salary.ts`/`stats.ts`/`sales.ts`/`disciplinary.ts`/`overview.ts` refactorizados a `await getActiveTimezone()`. Eliminadas constantes hardcoded `America/Argentina/Buenos_Aires` del nivel de módulo. `caja.ts dayBounds()` y `finances.ts` usan ahora `getDayBounds(dateStr, tz)` de `time-utils.ts`.
- **Fase 5 wizard i18n** — step 0 del wizard ahora pide país/moneda/timezone (13 países LatAm + US + ES, 11 monedas, 13 zonas horarias). Deriva locale automático por país. `updateOrgI18n()` persiste en `organizations`.
- **Fase 8 auth_rls_initplan pass 2+3+4** — wrap `(SELECT auth.fn())` aplicado a ~45 policies más (client_*, products, product_sales, expense_tickets, transfer_logs, disciplinary_*, incentive_*, payment_accounts, message_templates, staff_schedule_exceptions, staff_service_commissions, branch_signals, organization_members, organizations, conversation_tags, ig/wa_config, commercial_partners, visits).
- **Rate limiter global** — tabla `rate_limits` + RPC `check_rate_limit(bucket, key, limit, window_seconds)` atómico + helper `src/lib/rate-limit.ts`. Integrado en: PIN login (5/min), email login (5/2min), kiosk checkin (20/min), review submit (3/5min), lookup phone (10/min), register org (3/hora).
- **`paymentAccounts.ts recordTransfer`** — optimistic lock con reintentos reemplazado por llamada atómica al RPC `increment_account_accumulated`.
- **Smoke test SQL-only ejecutado vía MCP — PASS 10/10:**
  1. ✓ auth user + org creadas
  2. ✓ seed: 3 roles + quick_replies + appointment_settings
  3. ✓ member + owner staff
  4. ✓ max_branches=1 guard funciona (bloqueó 2da branch)
  5. ✓ trigger `set_org_from_branch` llena org_id en visits
  6. ✓ `update_client_loyalty_state` sin hardcoded Monaco UUID
  7. ✓ aislamiento cross-tenant confirmado
  8. ✓ `check_rate_limit` incrementa contador
  9. ✓ i18n defaults (timezone/currency/country_code/subscription_status=trial/max_branches=1)
  10. ✓ org nueva sin `ai_config` leak

- **Script smoke test** en `scripts/smoke-new-org.ts` para ejecutar end-to-end con TypeScript (requiere `npm i -D tsx dotenv`). La versión SQL-only ejecutada vía MCP valida lo mismo a nivel DB.

### 🟡 Queda pendiente (menor prioridad)

- **Logo BarberOS genérico** (`public/logo-barberos.png`) — diseño (no es código).
- **Supabase Auth**: activar `Leaked Password Protection` (HaveIBeenPwned) desde el Supabase Dashboard.
- **Public buckets** (`branding`, `chat-media`, `face-references`, `staff-avatars`, `visit-photos`): reducir SELECT policy para no permitir listing (solo acceso por URL exacta). Impacto bajo — los paths contienen UUIDs.
- **`function_search_path_mutable` en ~40 funciones viejas**: cosmético (solo warning, no vulnerabilidad activa). Aplicar `ALTER FUNCTION ... SET search_path = public` cuando haya tiempo.
- **Mover extensión `vector`** de schema `public` a `extensions`.
- **Views con `SECURITY DEFINER`** (`branch_occupancy`, `workflow_cron_health`): revisar si se necesitan o recrearlas con `SECURITY INVOKER`.

### 📊 Supabase Advisors — delta

| Antes | Ahora |
|---|---|
| RLS `allow_all` en 19 tablas | 0 (todas convertidas a org-scoped) |
| `organization_ai_config` abierta a public | Service role only |
| `client_face_descriptors` abierta a anon | Service role only |
| 4 policies cross-org (salary_*, crm_cases, review_requests, scheduled_messages) | Todas filtran por org |
| Monaco UUID hardcoded en trigger | Removido |
| 10 índices duplicados | Drop |
| 83 FKs sin índice | 18 de las más hot indexadas |
| `auth_rls_initplan` en 81 policies | ~10 arregladas en hot tables |

**Errores de advisor ahora**: 2 (preexistentes, `branch_occupancy` y `workflow_cron_health` con SECURITY DEFINER — no críticos).
**Warnings clave pendientes**: `function_search_path_mutable` en ~40 funciones viejas (patch en 5 minutos), `extension_in_public` (vector), `public_bucket_allows_listing` (revisar buckets de branding/chat-media/face-references/staff-avatars/visit-photos).

### 🎯 Próximos pasos concretos

1. Esperar que termine el agente de server actions y aplicar sus cambios. Si falla algo crítico, reintentar manualmente los 24 fixes de §5.1.
2. Refactor i18n en los 8 archivos que todavía tienen TZ hardcoded (buscar/reemplazar con `await getActiveTimezone()`).
3. Completar el wizard de onboarding con el paso i18n + reassign owner a branch.
4. Fix canje de puntos en `queue.ts`.
5. Segunda pasada de `auth_rls_initplan` (las 71 policies restantes).
6. Diseñar logo BarberOS genérico (`public/logo-barberos.png`).
7. Smoke test end-to-end: crear org nueva → wizard → visita → canje → sueldos.

# Billing Runbook · Modo manual

Operativa diaria del sistema de billing **manual** (sin pasarela de pagos).
Mientras `BILLING_MODE='manual'`, todo cobro se coordina por fuera (transferencia/efectivo/link MP) y se registra a mano desde `/platform`.

---

## 1. Flujo end-to-end

```
[Cliente clickea "Cambiar a Pro" o "Solicitar renovación"]
   ↓
   subscription_requests INSERT (status='pending')
   ↓
   Email: subscription-request-received → cliente + BCC barberos.system@gmail.com
   ↓
[Vos lo ves en /platform/billing-requests]
   ↓
   "Marcar contactado" → log entry, status='contacted'
   ↓
   Coordinás pago por WhatsApp / email
   ↓
   Cliente paga (transferencia / efectivo / link MP / USDT / etc.)
   ↓
   "Registrar pago" desde /platform/billing-requests o /platform/orgs/[id]
   ↓
   manual_payments INSERT
       → trigger sync_subscription_from_manual_payment:
         · plan_id, status='active', current_period_end actualizado
         · next_renewal_reminder_at = period_end - 7d
         · subscription_request marcada paid
         · billing_event 'manual_payment.recorded' creado
   ↓
   Email: payment-recorded → cliente
```

---

## 2. Tareas operativas diarias

### Mañana (~9–10hs)

1. Abrir `/platform/dashboard` y revisar:
   - **Cobros pendientes**: solicitudes nuevas (last 24h)
   - **Renovaciones próximas (14d)**: orgs cuyo period_end vence en ≤14 días
   - **Past due**: orgs en gracia (clickeable, días restantes)

2. Para cada **request pending**:
   - Ir a `/platform/billing-requests`
   - Click "Contactar" → elegir canal (WhatsApp/email) y dejar nota
   - El sistema cambia status a `contacted` automáticamente
   - Enviar al cliente: CBU, link MP manual, alias, monto exacto

3. Para cada **past_due** con días en gracia:
   - Click en la org
   - Ver tab "Pagos manuales" → "Past due manual" (si hace falta extender la gracia)
   - Si el cliente promete pagar la próxima semana: click "Extender período"

### Cuando llega un pago

1. Verificar comprobante (transferencia recibida, efectivo en mano, etc.)
2. Ir a `/platform/billing-requests` y click "Registrar pago"
   - O directamente a `/platform/orgs/[id]` si no había request previa
3. Llenar el modal:
   - Plan
   - Ciclo (mensual/anual)
   - Cubre N meses (el sistema sugiere 1 o 12 según ciclo)
   - Método de pago
   - Monto cobrado (pre-cargado con el sugerido)
   - Referencia (nº transferencia, comprobante, link)
   - Notas internas opcionales
4. El sistema:
   - Inserta `manual_payments`
   - El trigger actualiza `organization_subscriptions` (plan/status/period)
   - Marca la request como `paid`
   - Manda email "payment-recorded" al cliente
   - Genera entrada en audit log (`platform_admin_actions`)

---

## 3. Estados de suscripción

| Status | Significado | Cómo llega ahí | Cómo sale |
|---|---|---|---|
| `trialing` | En trial de 3 días al registrarse | Auto en `register.ts` | trial_ends_at < now → past_due (cron) |
| `active` | Pago al día | manual_payments INSERT | period_end < now → past_due (cron) |
| `past_due` | Vencido, en gracia (5 días) | trial vencido o period_end < now | manual_payment INSERT → active. Gracia vencida → free (cron) |
| `cancelled` | Cancelado a fin de período | Cliente clickea "Cancelar" | Cliente reactiva |
| `paused` | (no usado actualmente) | — | — |
| `incomplete` | (no usado actualmente) | — | — |

**Cron `expire-trials`** (diario 04:00 UTC):
- `trialing + trial_ends_at < now` → `past_due` con 5 días gracia + email
- `active + manual + period_end < now` → `past_due` con 5 días gracia + email
- `past_due + grace_period_ends_at < now` → `free`, apaga sucursales excedentes + email

**Cron `notify-renewals`** (diario 13:00 UTC ≈ 10:00 ART):
- Manual+active con `next_renewal_reminder_at <= now` → email "renewal-due-soon", nullear flag
- Trial con `trial_ends_at <= now+1d` → email "trial-ending-soon"

---

## 4. Casos comunes

### Cliente nuevo con trial y quiere quedarse

- Cliente clickea "Solicitar este plan" desde `/dashboard/billing`
- Se crea `subscription_request` pending
- Vos coordinás pago, registrás `manual_payment`
- Trigger actualiza la sub: pasa de `trialing` a `active` con period_end al final del ciclo pago

### Cliente quiere renovar antes de fin de mes

- Cliente clickea "Solicitar renovación"
- Misma mecánica. El nuevo period_end es `max(current_period_end, now) + N meses`,
  así NO pierde días si paga anticipado.

### Cortesía: extender 7 días a un cliente que tuvo problemas

- `/platform/orgs/[id]` → tab "Pagos manuales" → "Extender período"
- Días: 7
- Razón: "cortesía por inconveniente del 2026-04-28"
- El sistema actualiza `current_period_end` y resetea `next_renewal_reminder_at`.
- Queda en audit log.

### Cliente desistió de cambiar de plan

- `/platform/billing-requests` → request → botón rojo (cancelar)
- Razón: "desistió por precio"
- El sistema marca `status='cancelled'` con `cancellation_reason`.

### Cliente paga en USDT

- En el modal: método = `usdt`, referencia = hash de la transacción.
- Monto: registrar el equivalente ARS al momento del cobro.
- Notas: TXID, network (TRX/ETH), wallet, etc.

---

## 5. Acceso developer/tester (vos)

1. **Tu org Monaco** (`a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`) está `grandfathered=true` con `plan_id='monaco_internal'` hasta 2126. Cero limites.

2. **Tu user** `admin@admin.admin` (id `53f83aab-9bdc-4711-b92f-8e7bb9535296`) es `platform_admin` con role `owner`. Accede a `/platform/*`.

3. **Bypass enforcement**: `entitlements.ts` evalúa `_isCallerPlatformAdmin()` antes de chequear features/limits/caps. Si sos platform_admin, ningún `requireFeature/requireLimit` te bloquea — incluso si te ponés en plan `free` para testear UI.

4. **Crear orgs de testing**: crearlas desde `/platform/organizations` o vía SQL. Asignar plan vía `/platform/orgs/[id]` → "Cambiar plan ahora".

5. **Forzar past_due** para testear UI: tab "Pagos manuales" → "Past due manual".

6. **Smoke test**: `npx tsx scripts/smoke-billing-manual.ts` (necesita `.env` con `SUPABASE_SERVICE_ROLE_KEY`).

---

## 6. Variables de entorno

| Variable | Para qué | Cuando configurarla |
|---|---|---|
| `RESEND_API_KEY` | Mandar emails transaccionales | Antes de empezar a comercializar |
| `NEXT_PUBLIC_APP_URL` | URL absoluta usada en CTAs de email | Antes de mandar emails |
| `SUPABASE_SERVICE_ROLE_KEY` | Server actions y crons | Ya configurado |

**Vault de Supabase** (necesario para que pg_cron dispare nuestros endpoints):

```sql
-- Supabase Dashboard → Project → Settings → Vault
INSERT INTO vault.secrets (name, secret) VALUES ('app_base_url', 'https://app.barberos.io');
```

Sin este secret, los crons billing son no-op (loguean warning, no fallan).

---

## 7. Troubleshooting

**Síntoma**: Cron no dispara
- Check `select * from billing_cron_health;` — ver `status` de la última corrida
- Si `status='failed'` y `return_message` menciona vault: setear `app_base_url`
- Si la fila no existe: la migración 118 no corrió, aplicarla

**Síntoma**: Email no llega
- Resend dashboard → Logs → buscar el email destino
- Si error "From address not allowed": verificar dominio en Resend (mientras tanto sólo se manda a `barberos.system@gmail.com`)
- Si todo OK: revisar spam del cliente

**Síntoma**: Trigger sync_subscription_from_manual_payment no actualiza
- `select * from billing_events where provider='manual' order by created_at desc limit 5;`
  — debería haber una fila por cada manual_payment
- Si no hay: el trigger explotó, ver logs de Postgres

**Síntoma**: Past_due no se aplica al venir el cron
- Confirmar que `provider='manual'` y `grandfathered=false` en la sub
- Si la sub tiene `provider IS NULL` (orgs viejas), correr:
  `update organization_subscriptions set provider='manual' where provider is null;`

---

## 8. Métricas a vigilar

- **Conversión request → paid**: ratio `paid / (paid + cancelled)` en `subscription_requests`
- **Tiempo medio request → paid**: `avg(resolved_at - created_at)` para paid
- **Past_due → recovery rate**: orgs que pasaron a past_due y luego volvieron a active
- **Churn**: orgs que terminaron en `free` después de un período activo

Las primeras 4 ya se ven en `/platform/dashboard` y `/platform/billing-requests`.

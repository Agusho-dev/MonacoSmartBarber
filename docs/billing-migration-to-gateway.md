# Migración de billing manual → pasarela de pagos

Cuando llegue el momento de activar **MercadoPago** (u otra pasarela), este documento describe el switch zero-downtime.

## 1. Filosofía

El sistema fue diseñado para que **toda la lógica de planes/entitlements/trials/past_due no cambie** al activar la pasarela. Lo único que cambia es:

- Quién escribe en `organization_subscriptions` (un platform_admin → un webhook)
- Qué pasa cuando el cliente clickea "Cambiar a Pro" (crea request → redirige a checkout)

Cero migración de datos. Las orgs en modo manual pueden coexistir con orgs en modo gateway.

---

## 2. Pre-requisitos

### 2.1 Cuenta Mercado Pago empresa

1. Crear cuenta en https://www.mercadopago.com.ar como vendedor
2. Verificar identidad + agregar CBU
3. Categoría del negocio: "Software / SaaS"

### 2.2 Aplicación de developers

1. https://www.mercadopago.com.ar/developers/panel/app → Crear aplicación
2. Modelo: **Pagos online y presenciales**, producto **Suscripciones**
3. Guardar credenciales:
   - `Public Key` y `Access Token` para **Test**
   - `Public Key` y `Access Token` para **Producción**
4. **Comisión**: ~6,29% + IVA por transacción (≈7,6% efectivo en Argentina, sin costo fijo mensual). Confirmar tarifa vigente al activar.

### 2.3 Webhook configurado

1. En la app MP → Webhooks → Configurar notificaciones
2. URL: `https://app.barberos.io/api/webhooks/mercadopago`
3. Eventos: `subscription_preapproval`, `subscription_authorized_payment`, `payment`
4. Guardar el secret HMAC que MP genera

### 2.4 Variables de entorno

Agregar a Vercel (Settings → Environment Variables):

```
MERCADOPAGO_ACCESS_TOKEN=APP_USR-xxxxx        # producción
MERCADOPAGO_PUBLIC_KEY=APP_USR-xxxxx
MERCADOPAGO_WEBHOOK_SECRET=xxxxx
MP_RETURN_URL_SUCCESS=https://app.barberos.io/dashboard/billing?status=success
MP_RETURN_URL_PENDING=https://app.barberos.io/dashboard/billing?status=pending
MP_RETURN_URL_FAILURE=https://app.barberos.io/dashboard/billing?status=failure
```

---

## 3. Code changes (orden de ejecución)

### Paso 1 · Cambiar el switch

`src/lib/billing/config.ts`:

```ts
export const BILLING_MODE: BillingMode = 'mercadopago'   // antes: 'manual'
```

### Paso 2 · Implementar branch `gateway` en `requestPlanChange`

`src/lib/actions/billing.ts` ya tiene la estructura:

```ts
if (isManualBilling()) { ... }
// Modo gateway (futuro): crear preapproval en MP y devolver checkoutUrl
return { error: 'not_implemented', ... }
```

Reemplazar el `return` final por:

```ts
const { createPreapproval } = await import('@/lib/billing/mercadopago')
const preapproval = await createPreapproval({
  reason: `Suscripción ${plan.name} ${billingCycle}`,
  external_reference: orgId,
  payer_email: user?.email ?? '',
  back_url: process.env.MP_RETURN_URL_SUCCESS!,
  auto_recurring: {
    frequency: billingCycle === 'yearly' ? 12 : 1,
    frequency_type: 'months',
    transaction_amount: (billingCycle === 'yearly' ? plan.price_ars_yearly : plan.price_ars_monthly) / 100,
    currency_id: 'ARS',
  },
})

await supabase.from('organization_subscriptions').update({
  provider: 'mercadopago',
  provider_subscription_id: preapproval.id,
}).eq('organization_id', orgId)

return {
  ok: true,
  mode: 'gateway',
  checkoutUrl: preapproval.init_point,
}
```

### Paso 3 · Verificar webhook

`src/app/api/webhooks/mercadopago/route.ts` ya está listo. Una vez configurado el secret, los webhooks empiezan a llegar y escriben en `organization_subscriptions` los mismos campos que escribía `recordManualPayment`:

- `status` (active / past_due / cancelled)
- `current_period_end`
- `provider_subscription_id`
- `cancel_at_period_end`

### Paso 4 · Migración convivencia

Las orgs en modo manual siguen funcionando. Para migrarlas gradualmente:

1. **Opcional**: notificarlas que próximamente migrarán a cobro automático
2. La próxima vez que renueven, en lugar de pagar manualmente, las invitamos a clickear el nuevo CTA "Pagar con MP"
3. Eso crea un preapproval y desde ese momento la org queda con `provider='mercadopago'`

NO conviene migrar de golpe a todas — dejar elegir al cliente.

### Paso 5 · Apagar modo manual gradualmente

Cuando >80% esté en gateway, ofrecer al resto y eventualmente bajar el banner "te contactamos por WhatsApp".

El código de cobro manual (`recordManualPayment`, `/platform/billing-requests`) **se queda** — sirve para casos especiales (cobros fuera de MP, USDT, etc.) incluso después de la migración.

---

## 4. Testing en sandbox

MP provee test users + tarjetas de prueba:

- Tarjeta APRO (aprobado): `5031 7557 3453 0604`, CVV `123`, vto futuro, nombre `APRO`
- Tarjeta OTHE (rechazado): mismo número, nombre `OTHE`

Flujo de test:
1. Setear `MERCADOPAGO_ACCESS_TOKEN=TEST-xxxxx`
2. Crear org de testing
3. Click "Cambiar a Pro" → debería redirigir a checkout MP test
4. Usar tarjeta APRO
5. Volver al dashboard → la sub debe estar `active` con `provider_subscription_id` seteado
6. Verificar que llegó webhook (revisar `billing_events`)

---

## 5. Estimación

- Setup MP + variables: **0.5 días**
- Implementar gateway branch + testing sandbox: **2 días**
- Verificación webhook end-to-end: **1 día**
- Migración gradual de clientes: **continuo, no bloqueante**

**Total dev efectivo**: 3-4 días una vez tengas la cuenta MP lista.

---

## 6. Path alternativo: Stripe

Si más adelante se requiere Stripe (clientes internacionales en USD):

1. El campo `provider` en `organization_subscriptions` ya soporta varios valores (es `text`)
2. Crear `src/lib/billing/stripe.ts` análogo a `mercadopago.ts`
3. Crear `/api/webhooks/stripe`
4. En `requestPlanChange`, detectar moneda objetivo: si `currency='USD'` → Stripe, si `'ARS'` → MP

El flow downstream (entitlements, past_due, etc.) sigue idéntico.

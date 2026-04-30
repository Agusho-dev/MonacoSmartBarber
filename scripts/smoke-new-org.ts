/**
 * Smoke test end-to-end: simula crear una org nueva, completar onboarding, hacer check-ins,
 * visitas y canje de puntos. Valida que no haya leak cross-tenant con Monaco.
 *
 * Run:
 *   npx tsx scripts/smoke-new-org.ts
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (de .env)
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const MONACO_ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ─── helpers ────────────────────────────────────────────────────────────

const NL = '\n'
let passCount = 0
let failCount = 0

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) { console.log(`  ✅ ${label}`); passCount++ }
  else    { console.log(`  ❌ ${label}`, detail ?? ''); failCount++ }
}

async function cleanup(orgId: string | null, userId: string | null) {
  if (!orgId) return
  console.log(NL + 'Limpieza…')
  // Cascade manual (branches, staff, visits, queue_entries, etc.)
  await admin.from('visits').delete().eq('organization_id', orgId)
  await admin.from('queue_entries').delete().eq('organization_id', orgId)
  await admin.from('client_points').delete().eq('organization_id', orgId)
  await admin.from('point_transactions').delete().eq('organization_id', orgId)
  await admin.from('client_loyalty_state').delete().eq('organization_id', orgId)
  await admin.from('clients').delete().eq('organization_id', orgId)
  await admin.from('staff').delete().eq('organization_id', orgId)
  await admin.from('branches').delete().eq('organization_id', orgId)
  await admin.from('app_settings').delete().eq('organization_id', orgId)
  await admin.from('roles').delete().eq('organization_id', orgId)
  await admin.from('quick_replies').delete().eq('organization_id', orgId)
  await admin.from('appointment_settings').delete().eq('organization_id', orgId)
  await admin.from('organization_members').delete().eq('organization_id', orgId)
  await admin.from('organizations').delete().eq('id', orgId)
  if (userId) await admin.auth.admin.deleteUser(userId)
  console.log('  🧹 cleanup hecho')
}

// ─── main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('Smoke test — nueva org end-to-end' + NL)
  const stamp = Date.now()
  const slug  = `smoke-${stamp}`
  const email = `smoke-${stamp}@example.com`

  let orgId: string | null = null
  let userId: string | null = null
  let branchId: string | null = null
  let staffId: string | null = null
  let clientId: string | null = null

  try {
    // ── 1. Registro de org ──
    console.log('1. Crear auth user y org')
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email, password: 'Passw0rd!', email_confirm: true, app_metadata: {},
    })
    check('auth user creado', !authErr && !!authData.user, authErr)
    if (!authData.user) throw new Error('no user')
    userId = authData.user.id

    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .insert({ name: `Smoke ${stamp}`, slug, is_active: true, settings: { onboarding_completed: false, onboarding_step: 0 } })
      .select('id').single()
    check('organizations insert', !orgErr && !!org, orgErr)
    if (!org) throw new Error('no org')
    orgId = org.id

    await admin.from('organization_members').insert({ organization_id: orgId, user_id: userId, role: 'owner' })
    await admin.from('staff').insert({ organization_id: orgId, auth_user_id: userId, role: 'owner', full_name: 'Test Owner', email, is_active: true })
    await admin.auth.admin.updateUserById(userId, { app_metadata: { organization_id: orgId } })
    await admin.from('app_settings').insert({ organization_id: orgId, lost_client_days: 60, at_risk_client_days: 30 })

    // ── 2. Seed defaults ──
    console.log(NL + '2. Seed defaults')
    const { error: seedErr } = await admin.rpc('seed_new_organization', { p_org_id: orgId })
    check('seed_new_organization OK', !seedErr, seedErr)

    const [{ data: roles }, { data: qr }, { data: apptSet }] = await Promise.all([
      admin.from('roles').select('name').eq('organization_id', orgId),
      admin.from('quick_replies').select('title').eq('organization_id', orgId),
      admin.from('appointment_settings').select('id').eq('organization_id', orgId).maybeSingle(),
    ])
    check('3 roles creados', roles?.length === 3, roles)
    check('quick_replies seedados', (qr?.length ?? 0) >= 3, qr)
    check('appointment_settings seedado', !!apptSet, apptSet)

    // ── 3. Crear sucursal ──
    console.log(NL + '3. Primera sucursal')
    const { data: branch, error: brErr } = await admin
      .from('branches')
      .insert({ organization_id: orgId, name: 'Sucursal 1', is_active: true, timezone: 'America/Argentina/Buenos_Aires' })
      .select('id').single()
    check('branch insert', !brErr && !!branch, brErr)
    if (!branch) throw new Error('no branch')
    branchId = branch.id

    // ── 4. max_branches enforcement ──
    console.log(NL + '4. max_branches guard (debe bloquear 2da sucursal en plan starter con max=1)')
    const { error: br2Err } = await admin
      .from('branches')
      .insert({ organization_id: orgId, name: 'Sucursal 2', is_active: true })
    check('2da sucursal bloqueada por max_branches', br2Err?.message?.includes('max_branches_exceeded') === true, br2Err)

    // ── 5. Asignar staff owner a branch ──
    await admin.from('staff').update({ branch_id: branchId }).eq('organization_id', orgId).eq('role', 'owner')
    const { data: owner } = await admin.from('staff').select('branch_id').eq('organization_id', orgId).eq('role', 'owner').single()
    check('owner asignado a branch', owner?.branch_id === branchId)

    // ── 6. Crear cliente + visita ──
    console.log(NL + '5. Cliente + check-in + visita')
    const { data: client, error: cliErr } = await admin
      .from('clients')
      .insert({ organization_id: orgId, name: 'Cliente Test', phone: `+54911${stamp}` })
      .select('id').single()
    check('cliente insert', !cliErr && !!client)
    if (!client) throw new Error('no client')
    clientId = client.id

    const { data: staff } = await admin.from('staff').select('id').eq('organization_id', orgId).eq('role', 'owner').single()
    staffId = staff?.id ?? null

    // ── 7. Trigger set_org_from_branch en visits ──
    const { data: visit } = await admin
      .from('visits')
      .insert({ branch_id: branchId, client_id: clientId, barber_id: staffId, amount: 5000, commission_pct: 50, commission_amount: 2500, completed_at: new Date().toISOString() })
      .select('organization_id').single()
    check('visit trigger set_org_from_branch', visit?.organization_id === orgId, visit)

    // ── 8. Aislamiento cross-tenant ──
    console.log(NL + '6. Aislamiento cross-tenant con Monaco')
    const { data: monacoBranches } = await admin.from('branches').select('id').eq('organization_id', MONACO_ORG)
    const { data: myBranches } = await admin.from('branches').select('id').eq('organization_id', orgId)
    check('mis branches no se mezclan con Monaco',
      monacoBranches?.length !== myBranches?.length || !monacoBranches?.some(b => myBranches?.some(m => m.id === b.id)))

    // ── 9. Rate limit check ──
    console.log(NL + '7. Rate limit')
    for (let i = 0; i < 3; i++) {
      await admin.rpc('check_rate_limit', { p_bucket: 'smoke_test', p_key: slug, p_limit: 2, p_window_seconds: 60 })
    }
    const { data: rlRow } = await admin.from('rate_limits').select('count').eq('bucket', 'smoke_test').eq('key', slug).maybeSingle()
    check('rate_limits tabla incrementa count', (rlRow?.count ?? 0) >= 3, rlRow)

    // ── 10. i18n fields ──
    console.log(NL + '8. i18n defaults')
    const { data: orgRow } = await admin.from('organizations').select('timezone, currency, country_code, subscription_status, max_branches').eq('id', orgId).single()
    check('org tiene timezone', !!orgRow?.timezone)
    check('org tiene currency', !!orgRow?.currency)
    check('org tiene subscription_status trial', orgRow?.subscription_status === 'trial')
    check('org max_branches default = 1', orgRow?.max_branches === 1)

    // ── 11. RLS sanity: client_face_descriptors sin anon ──
    console.log(NL + '9. RLS sanity: anon NO puede leer client_face_descriptors')
    const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false } })
    const { data: faceLeak, error: faceErr } = await anon.from('client_face_descriptors').select('id').limit(1)
    check('anon NO puede leer client_face_descriptors', !faceLeak || faceLeak.length === 0, { faceLeak, faceErr })

  } catch (e) {
    console.error(NL + 'Error fatal:', e)
    failCount++
  } finally {
    await cleanup(orgId, userId).catch(() => {})
  }

  console.log(NL + `Resumen: ${passCount} passed, ${failCount} failed`)
  process.exit(failCount > 0 ? 1 : 0)
}

main()

import 'server-only'

import { createHash } from 'crypto'
import { embed, embedMany } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_EMBEDDING_MODEL } from './models'

// ── pgvector helpers ────────────────────────────────────────────────
function toVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// ── Chunking (heading/párrafo-aware, con overlap) ───────────────────
export function chunkText(text: string, maxChars = 1400, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= maxChars) return [clean]

  const paras = clean.split(/\n{2,}/)
  const chunks: string[] = []
  let cur = ''
  for (const p of paras) {
    const candidate = cur ? `${cur}\n\n${p}` : p
    if (candidate.length > maxChars && cur) {
      chunks.push(cur.trim())
      cur = `${cur.slice(-overlap)}\n\n${p}`
    } else {
      cur = candidate
    }
    while (cur.length > maxChars * 1.6) {
      chunks.push(cur.slice(0, maxChars).trim())
      cur = cur.slice(maxChars - overlap)
    }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks.filter((c) => c.length > 0)
}

// ── Embeddings (OpenAI) ─────────────────────────────────────────────
async function getOpenAiKey(orgId: string): Promise<{ key: string; model: string } | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('organization_ai_config')
    .select('openai_api_key, embedding_model')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!data?.openai_api_key) return null
  return { key: data.openai_api_key, model: data.embedding_model || DEFAULT_EMBEDDING_MODEL }
}

export async function embedQuery(orgId: string, query: string): Promise<number[] | null> {
  const cfg = await getOpenAiKey(orgId)
  if (!cfg) return null
  const openai = createOpenAI({ apiKey: cfg.key })
  const { embedding } = await embed({ model: openai.textEmbeddingModel(cfg.model), value: query })
  return embedding
}

// ── Búsqueda semántica (RAG) ────────────────────────────────────────
export interface RagHit {
  content: string
  title: string | null
  source_type: string
  similarity: number
}

export async function searchKnowledge(
  orgId: string,
  query: string,
  opts: { sources?: string[]; matchCount?: number } = {},
): Promise<{ hits: RagHit[]; embedded: boolean }> {
  const embedding = await embedQuery(orgId, query)
  if (!embedding) return { hits: [], embedded: false }
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('match_assistant_chunks', {
    query_embedding: toVector(embedding),
    p_org_id: orgId,
    match_count: opts.matchCount ?? 6,
    similarity_threshold: 0.2,
    source_filter: opts.sources ?? null,
  })
  if (error) {
    console.error('[rag] match_assistant_chunks error:', error.message)
    return { hits: [], embedded: true }
  }
  const hits: RagHit[] = (data ?? []).map((r: Record<string, unknown>) => ({
    content: r.content as string,
    title: (r.title as string) ?? null,
    source_type: r.source_type as string,
    similarity: Number(r.similarity),
  }))
  return { hits, embedded: true }
}

// ── Ingesta de documentos (dedup por content_hash) ──────────────────
interface UpsertDocInput {
  orgId: string
  sourceType: 'kb' | 'message' | 'review' | 'crm' | 'note' | 'visit'
  sourceId: string | null
  title: string | null
  content: string
  metadata?: Record<string, unknown>
}

/** Inserta/actualiza un documento + sus chunks (embedding pendiente). Devuelve true si cambió. */
export async function upsertAssistantDocument(input: UpsertDocInput): Promise<boolean> {
  const content = input.content?.trim()
  if (!content) return false
  const supabase = createAdminClient()
  const hash = sha256(content)

  // ¿Ya existe con el mismo hash? → no-op
  if (input.sourceId) {
    const { data: existing } = await supabase
      .from('assistant_documents')
      .select('id, content_hash')
      .eq('organization_id', input.orgId)
      .eq('source_type', input.sourceType)
      .eq('source_id', input.sourceId)
      .maybeSingle()
    if (existing?.content_hash === hash) return false
    if (existing) {
      await supabase.from('assistant_chunks').delete().eq('document_id', existing.id)
      await supabase
        .from('assistant_documents')
        .update({ title: input.title, content, content_hash: hash, metadata: input.metadata ?? {}, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      await insertChunks(existing.id, input.orgId, content)
      return true
    }
  }

  const { data: doc, error } = await supabase
    .from('assistant_documents')
    .insert({
      organization_id: input.orgId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      title: input.title,
      content,
      content_hash: hash,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()
  if (error || !doc) {
    console.error('[rag] insert document error:', error?.message)
    return false
  }
  await insertChunks(doc.id, input.orgId, content)
  return true
}

async function insertChunks(documentId: string, orgId: string, content: string): Promise<void> {
  const supabase = createAdminClient()
  const chunks = chunkText(content)
  if (chunks.length === 0) return
  const rows = chunks.map((c, i) => ({
    document_id: documentId,
    organization_id: orgId,
    chunk_index: i,
    content: c,
    embedding: null,
    token_count: Math.ceil(c.length / 4),
  }))
  const { error } = await supabase.from('assistant_chunks').insert(rows)
  if (error) console.error('[rag] insert chunks error:', error.message)
}

// ── Worker incremental: embebe chunks pendientes ────────────────────
export async function embedPendingChunks(maxChunks = 100): Promise<{ embedded: number; errors: number }> {
  const supabase = createAdminClient()
  const { data: pending } = await supabase
    .from('assistant_chunks')
    .select('id, organization_id, content')
    .is('embedding', null)
    .limit(maxChunks)

  if (!pending || pending.length === 0) return { embedded: 0, errors: 0 }

  // Agrupar por org (cada org usa su propia API key)
  const byOrg = new Map<string, { id: string; content: string }[]>()
  for (const row of pending) {
    const arr = byOrg.get(row.organization_id) ?? []
    arr.push({ id: row.id, content: row.content })
    byOrg.set(row.organization_id, arr)
  }

  let embedded = 0
  let errors = 0
  for (const [orgId, rows] of byOrg) {
    const cfg = await getOpenAiKey(orgId)
    if (!cfg) { errors += rows.length; continue }
    const openai = createOpenAI({ apiKey: cfg.key })
    // Lotes de hasta 96 para no exceder límites del endpoint
    for (let i = 0; i < rows.length; i += 96) {
      const batch = rows.slice(i, i + 96)
      try {
        const { embeddings } = await embedMany({
          model: openai.textEmbeddingModel(cfg.model),
          values: batch.map((b) => b.content),
        })
        await Promise.all(
          batch.map((b, j) =>
            supabase.from('assistant_chunks').update({ embedding: toVector(embeddings[j]) }).eq('id', b.id),
          ),
        )
        embedded += batch.length
      } catch (e) {
        console.error('[rag] embedMany error:', e instanceof Error ? e.message : String(e))
        errors += batch.length
      }
    }
  }
  return { embedded, errors }
}

// ── Backfill / seed ─────────────────────────────────────────────────

/** Documentos base de conocimiento (glosario + cómo leer las métricas). */
function defaultKnowledgeDocs(orgName: string): { sourceId: string; title: string; content: string }[] {
  return [
    {
      sourceId: 'glosario-metricas',
      title: 'Glosario de métricas del negocio',
      content: `Glosario de métricas de ${orgName} (BarberOS):
- Ingresos / Facturación: suma de los montos cobrados por las visitas completadas (visits.amount).
- Cortes / Atenciones: cantidad de visitas completadas en el período.
- Ticket promedio: ingresos divididos por la cantidad de cortes.
- Comisión: parte del cobro que se le paga al barbero por la atención.
- Contribución neta del barbero: ingresos que genera menos sus comisiones.
- Margen: contribución neta dividida por los ingresos, en porcentaje.
- Break-even (punto de equilibrio): cantidad de cortes necesarios para cubrir los gastos fijos del mes.
- Gastos fijos: costos mensuales recurrentes (alquiler, servicios, sueldos base).
- Gastos variables: gastos puntuales registrados como tickets de egreso.
- Propina (tip): monto extra que deja el cliente, separado del cobro del servicio.
- Cliente nuevo: primera visita dentro del período analizado.
- Cliente recurrente: con 2 o más visitas en la ventana extendida.
- Cliente en riesgo: su última visita fue hace bastante (umbral configurable, ~25-40 días).
- Cliente perdido: sin visitas hace más del umbral de pérdida (~40 días).`,
    },
    {
      sourceId: 'como-usar-asistente',
      title: 'Cómo trabaja el asistente',
      content: `El Asistente IA de ${orgName} responde preguntas sobre el negocio usando los datos reales del sistema en tiempo real. Para cualquier número usa herramientas que consultan la base de datos (nunca inventa cifras). Para preguntas sobre opiniones de clientes, quejas o cómo funciona el sistema usa búsqueda semántica sobre los mensajes y esta base de conocimiento. Puede generar informes descargables en PDF. Respeta los permisos del usuario: por ejemplo, solo quien tiene permiso de sueldos puede ver comisiones y salarios.`,
    },
  ]
}

export async function seedKnowledgeBase(orgId: string, orgName: string): Promise<number> {
  let count = 0
  for (const doc of defaultKnowledgeDocs(orgName)) {
    const changed = await upsertAssistantDocument({
      orgId,
      sourceType: 'kb',
      sourceId: doc.sourceId,
      title: doc.title,
      content: doc.content,
      metadata: { seeded: true },
    })
    if (changed) count++
  }
  return count
}

/** Indexa los mensajes entrantes de texto de la org (corpus semántico real). */
export async function backfillInboundMessages(orgId: string, limit = 2000): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('messages')
    .select('id, content, created_at, conversation:conversations!inner(channel:social_channels!inner(organization_id))')
    .eq('direction', 'inbound')
    .eq('content_type', 'text')
    .eq('conversation.channel.organization_id', orgId)
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[rag] backfill messages error:', error.message)
    return 0
  }
  let count = 0
  for (const m of data ?? []) {
    const content = (m.content as string | null)?.trim()
    if (!content || content.length < 8) continue
    const changed = await upsertAssistantDocument({
      orgId,
      sourceType: 'message',
      sourceId: m.id,
      title: 'Mensaje de cliente',
      content,
      metadata: { created_at: m.created_at },
    })
    if (changed) count++
  }
  return count
}

export interface RagStats {
  documents: number
  chunks: number
  embedded: number
  pending: number
  lastIndexedAt: string | null
}

export async function getRagStats(orgId: string): Promise<RagStats> {
  const supabase = createAdminClient()
  const [docs, chunksTotal, embeddedRes, pendingRes, last] = await Promise.all([
    supabase.from('assistant_documents').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('assistant_chunks').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('assistant_chunks').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).not('embedding', 'is', null),
    supabase.from('assistant_chunks').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('embedding', null),
    supabase.from('assistant_documents').select('updated_at').eq('organization_id', orgId).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  return {
    documents: docs.count ?? 0,
    chunks: chunksTotal.count ?? 0,
    embedded: embeddedRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    lastIndexedAt: (last.data?.updated_at as string) ?? null,
  }
}

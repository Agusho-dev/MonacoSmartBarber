'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { validateBranchAccess } from './org'

export async function createReviewRequest(
    clientId: string,
    branchId: string,
    visitId: string,
    barberId: string | null
) {
    // Validar que la sucursal pertenece a la org del usuario autenticado
    const orgAccess = await validateBranchAccess(branchId)
    if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

    const supabase = await createClient()

    const { data: existing } = await supabase
        .from('review_requests')
        .select('token')
        .eq('visit_id', visitId)
        .single()

    if (existing) {
        return { token: existing.token }
    }

    const { data, error } = await supabase
        .from('review_requests')
        .insert({
            client_id: clientId,
            branch_id: branchId,
            visit_id: visitId,
            barber_id: barberId,
        })
        .select('token')
        .single()

    if (error) {
        return { error: 'Error al generar solicitud de reseña' }
    }

    return { token: data.token }
}

export async function getReviewRequestInfo(token: string) {
    // Operación pública (acceso por token único): no requiere auth de org
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('review_requests')
        .select('*, branch:branches(name, google_review_url)')
        .eq('token', token)
        .single()

    if (error || !data) return null
    return data
}

export async function submitReview(
    requestId: string,
    rating: number,
    category: 'high' | 'improvement' | 'low',
    comment: string | null,
    redirectedToGoogle: boolean
) {
    // Operación pública (acceso por token): usamos admin client para no depender de sesión
    const supabase = createAdminClient()

    // Rate limit por requestId: 3 intentos cada 5 min (evita flood de reviews desde un token)
    const { RateLimits } = await import('@/lib/rate-limit')
    const gate = await RateLimits.reviewSubmit(requestId)
    if (!gate.allowed) {
        return { error: 'Esta reseña ya fue procesada' }
    }

    const { data: reqData } = await supabase
        .from('review_requests')
        .select('*')
        .eq('id', requestId)
        .single()

    if (!reqData) return { error: 'Solicitud no encontrada' }

    if (reqData.status !== 'pending') {
        return { error: 'Esta solicitud ya fue completada' }
    }

    const { error: revError } = await supabase
        .from('client_reviews')
        .insert({
            review_request_id: requestId,
            client_id: reqData.client_id,
            branch_id: reqData.branch_id,
            rating,
            category,
            comment,
            redirected_to_google: redirectedToGoogle
        })

    if (revError) return { error: 'Error al enviar reseña' }

    await supabase
        .from('review_requests')
        .update({ status: 'completed' })
        .eq('id', requestId)

    return { success: true }
}

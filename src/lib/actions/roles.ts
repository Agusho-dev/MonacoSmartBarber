'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId, getOrgBranchIds } from './org'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireOwner() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: staff } = await supabase
        .from('staff')
        .select('id, role')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .single()

    if (!staff || staff.role !== 'owner') {
        throw new Error('Solo el propietario puede gestionar roles')
    }

    // Obtener el organization_id del usuario actual
    const orgId = await getCurrentOrgId()
    if (!orgId) throw new Error('Organización no encontrada')

    return { supabase, staffId: staff.id, orgId }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getRoles() {
    const supabase = await createClient()

    // Filtrar roles por organización
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'Organización no encontrada', data: null }

    const { data: roles, error } = await supabase
        .from('roles')
        .select('*, role_branch_scope(branch_id)')
        .eq('organization_id', orgId)
        .order('name')

    if (error) return { error: error.message, data: null }
    return { error: null, data: roles }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createRole(input: {
    name: string
    description?: string
    permissions: Record<string, boolean>
    branchIds: string[]
}) {
    const { supabase, orgId } = await requireOwner()

    // Validar que todos los branchIds pertenecen a la org
    if (input.branchIds.length > 0) {
        const orgBranchIds = await getOrgBranchIds()
        const foreign = input.branchIds.find(id => !orgBranchIds.includes(id))
        if (foreign) return { error: 'Una sucursal no pertenece a tu organización' }
    }

    const { data: role, error: roleError } = await supabase
        .from('roles')
        .insert({
            name: input.name,
            description: input.description || null,
            permissions: input.permissions,
            organization_id: orgId,
        })
        .select('id')
        .single()

    if (roleError) return { error: roleError.message }

    // Insert branch scopes if any
    if (input.branchIds.length > 0) {
        const scopeRows = input.branchIds.map((branchId) => ({
            role_id: role.id,
            branch_id: branchId,
        }))
        const { error: scopeError } = await supabase
            .from('role_branch_scope')
            .insert(scopeRows)

        if (scopeError) return { error: scopeError.message }
    }

    revalidatePath('/dashboard/equipo')
    return { error: null, id: role.id }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateRole(
    roleId: string,
    input: {
        name: string
        description?: string
        permissions: Record<string, boolean>
        branchIds: string[]
    }
) {
    const { supabase, orgId } = await requireOwner()

    // Validar que todos los branchIds pertenecen a la org
    if (input.branchIds.length > 0) {
        const orgBranchIds = await getOrgBranchIds()
        const foreign = input.branchIds.find(id => !orgBranchIds.includes(id))
        if (foreign) return { error: 'Una sucursal no pertenece a tu organización' }
    }

    const { error: updateError } = await supabase
        .from('roles')
        .update({
            name: input.name,
            description: input.description || null,
            permissions: input.permissions,
        })
        .eq('id', roleId)
        .eq('organization_id', orgId)

    if (updateError) return { error: updateError.message }

    // Replace branch scopes: delete all, then insert new
    await supabase.from('role_branch_scope').delete().eq('role_id', roleId)

    if (input.branchIds.length > 0) {
        const scopeRows = input.branchIds.map((branchId) => ({
            role_id: roleId,
            branch_id: branchId,
        }))
        const { error: scopeError } = await supabase
            .from('role_branch_scope')
            .insert(scopeRows)

        if (scopeError) return { error: scopeError.message }
    }

    revalidatePath('/dashboard/equipo')
    return { error: null }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteRole(roleId: string) {
    const { supabase, orgId } = await requireOwner()

    // Verificar que el rol pertenece a la organización y si es del sistema
    const { data: role } = await supabase
        .from('roles')
        .select('is_system')
        .eq('id', roleId)
        .eq('organization_id', orgId)
        .single()

    if (role?.is_system) {
        return { error: 'No se pueden eliminar roles del sistema' }
    }

    const { error } = await supabase
        .from('roles')
        .delete()
        .eq('id', roleId)
        .eq('organization_id', orgId)

    if (error) return { error: error.message }

    revalidatePath('/dashboard/equipo')
    return { error: null }
}

// ---------------------------------------------------------------------------
// Assign role to staff
// ---------------------------------------------------------------------------

export async function assignRoleToStaff(staffId: string, roleId: string | null) {
    const { supabase, orgId } = await requireOwner()

    const { error } = await supabase
        .from('staff')
        .update({ role_id: roleId })
        .eq('id', staffId)
        .eq('organization_id', orgId)

    if (error) return { error: error.message }

    revalidatePath('/dashboard/equipo')
    revalidatePath('/dashboard/barberos')
    return { error: null }
}

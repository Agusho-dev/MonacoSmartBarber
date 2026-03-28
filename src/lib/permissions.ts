// =============================================================
// Permission constants and helpers for the role management system
// =============================================================

export interface PermissionCategory {
    label: string
    permissions: Record<string, string>
}

/**
 * All available permission categories and their individual permissions.
 * Key format: "category.permission" (e.g. "dashboard.access")
 */
export const PERMISSION_CATEGORIES: Record<string, PermissionCategory> = {
    dashboard: {
        label: 'Panel de Administración',
        permissions: {
            'dashboard.access': 'Acceso al sistema (Obligatorio para entrar)',
            'dashboard.home': 'Ver inicio (Métricas generales)',
        },
    },
    queue: {
        label: 'Fila',
        permissions: {
            'queue.view': 'Ver fila',
            'queue.manage': 'Gestionar fila (iniciar, completar)',
            'queue.reassign': 'Reasignar clientes entre barberos',
            'queue.hide_self': 'Ocultarse del check-in de clientes',
        },
    },
    staff: {
        label: 'Equipo',
        permissions: {
            'staff.view': 'Ver equipo',
            'staff.create': 'Crear miembros del staff',
            'staff.edit': 'Editar miembros del staff',
            'staff.deactivate': 'Activar/Desactivar miembros',
            'staff.hide': 'Ocultar/Mostrar miembros en check-in',
        },
    },
    breaks: {
        label: 'Descansos',
        permissions: {
            'breaks.view': 'Ver descansos',
            'breaks.grant': 'Otorgar descansos',
            'breaks.configure': 'Configurar tipos de descanso',
        },
    },
    finances: {
        label: 'Finanzas',
        permissions: {
            'finances.view_summary': 'Ver resumen financiero',
            'finances.view_expenses': 'Ver egresos (gastos variables)',
            'finances.view_fixed': 'Ver gastos fijos',
            'finances.view_accounts': 'Ver cuentas de cobro',
            'finances.create_expense': 'Crear gastos',
            'finances.manage_accounts': 'Gestionar cuentas de pago',
        },
    },
    salary: {
        label: 'Sueldos',
        permissions: {
            'salary.view': 'Ver sueldos',
            'salary.view_commissions': 'Ver comisiones',
            'salary.configure': 'Configurar esquemas de sueldo',
            'salary.pay': 'Registrar pagos de sueldo',
        },
    },
    clients: {
        label: 'Clientes',
        permissions: {
            'clients.view': 'Ver clientes',
            'clients.edit': 'Editar clientes',
        },
    },
    services: {
        label: 'Servicios y Productos',
        permissions: {
            'services.view': 'Ver servicios y productos',
            'services.manage': 'Crear/editar/eliminar servicios',
            'products.manage': 'Crear/editar/eliminar productos',
            'products.sell': 'Registrar ventas de productos',
        },
    },
    stats: {
        label: 'Estadísticas',
        permissions: {
            'stats.view': 'Ver estadísticas',
        },
    },
    incentives: {
        label: 'Incentivos',
        permissions: {
            'incentives.view': 'Ver incentivos',
            'incentives.manage': 'Gestionar reglas de incentivos',
            'incentives.achieve': 'Registrar logros',
        },
    },
    discipline: {
        label: 'Disciplina',
        permissions: {
            'discipline.view': 'Ver disciplina',
            'discipline.manage': 'Gestionar reglas disciplinarias',
            'discipline.record': 'Registrar eventos disciplinarios',
        },
    },
    calendar: {
        label: 'Calendario',
        permissions: {
            'calendar.view': 'Ver calendario y horarios',
            'calendar.manage': 'Gestionar horarios y excepciones',
        },
    },
    branches: {
        label: 'Sucursales',
        permissions: {
            'branches.view': 'Ver sucursales',
            'branches.manage': 'Crear/editar sucursales',
        },
    },
    rewards: {
        label: 'Fidelización',
        permissions: {
            'rewards.view': 'Ver programa de fidelización',
            'rewards.manage': 'Gestionar recompensas y catálogo',
        },
    },
    settings: {
        label: 'Configuración',
        permissions: {
            'settings.view': 'Ver configuración',
            'settings.manage': 'Modificar configuración general',
        },
    },
    roles: {
        label: 'Roles',
        permissions: {
            'roles.manage': 'Gestionar roles y permisos',
        },
    },
}

/**
 * Flat list of all permission keys for validation
 */
export const ALL_PERMISSION_KEYS: string[] = Object.values(PERMISSION_CATEGORIES).flatMap(
    (cat) => Object.keys(cat.permissions)
)

/**
 * Check if a permissions object has a specific permission enabled.
 */
export function hasPermission(
    permissions: Record<string, boolean> | null | undefined,
    key: string
): boolean {
    if (!permissions) return false
    return permissions[key] === true
}

/**
 * Get effective permissions for a staff member.
 * Owner always gets all permissions.
 */
export function getEffectivePermissions(
    rolePermissions: Record<string, boolean> | null | undefined,
    isOwner: boolean
): Record<string, boolean> {
    if (isOwner) {
        const allPerms: Record<string, boolean> = {}
        ALL_PERMISSION_KEYS.forEach((key) => {
            allPerms[key] = true
        })
        return allPerms
    }
    return rolePermissions ?? {}
}

/**
 * Count how many permissions are enabled in a permissions object.
 */
export function countActivePermissions(permissions: Record<string, boolean> | null | undefined): number {
    if (!permissions) return 0
    return Object.values(permissions).filter(Boolean).length
}

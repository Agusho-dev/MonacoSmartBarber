// =============================================================
// Plantillas de roles predefinidas. Sirven como "quick start"
// al crear un rol — el usuario las elige y los permisos quedan
// prellenados, pudiendo personalizarse antes de guardar.
// =============================================================

import {
    Award,
    ClipboardList,
    Eye,
    Headphones,
    Scissors,
    Wallet,
    type LucideIcon,
} from 'lucide-react'
import { ALL_PERMISSION_KEYS } from './permissions'
import type { UserRole } from './types/database'

export interface RoleTemplate {
    /** Identificador estable para tracking/keys de UI */
    id: string
    /** Nombre sugerido (editable antes de guardar) */
    name: string
    /** Tagline corto que aparece en la card */
    tagline: string
    /** Descripción larga que aparece como description del rol creado */
    description: string
    /** Icono Lucide */
    icon: LucideIcon
    /** Clases Tailwind para el badge del icono (bg + text) */
    accent: { bg: string; text: string; ring: string }
    /** Rol base del enum legacy (`staff.role`) que mejor representa este template */
    baseRole: UserRole
    /** Lista de permission keys habilitados por defecto */
    permissionKeys: string[]
}

const TEMPLATE_DEFS: RoleTemplate[] = [
    {
        id: 'manager',
        name: 'Encargado de Sucursal',
        tagline: 'Lleva la operación del día',
        description:
            'Gestiona equipo, fila, descansos, turnos y caja del día. No puede crear sucursales ni configurar el sistema.',
        icon: ClipboardList,
        accent: {
            bg: 'bg-blue-500/10 dark:bg-blue-500/20',
            text: 'text-blue-600 dark:text-blue-400',
            ring: 'ring-blue-500/30',
        },
        baseRole: 'admin' as UserRole,
        permissionKeys: [
            'dashboard.access',
            'dashboard.home',
            'queue.view',
            'queue.manage',
            'queue.reassign',
            'staff.view',
            'staff.edit',
            'staff.deactivate',
            'staff.hide',
            'breaks.view',
            'breaks.grant',
            'finances.view_summary',
            'finances.view_expenses',
            'finances.view_accounts',
            'finances.create_expense',
            'salary.view',
            'salary.view_commissions',
            'clients.view',
            'clients.edit',
            'services.view',
            'products.sell',
            'stats.view',
            'incentives.view',
            'incentives.achieve',
            'discipline.view',
            'discipline.record',
            'calendar.view',
            'calendar.manage',
            'appointments.view',
            'appointments.manage',
            'branches.view',
            'rewards.view',
            'agreements.view',
            'settings.view',
        ],
    },
    {
        id: 'receptionist',
        name: 'Recepcionista',
        tagline: 'Atiende mostrador y agenda',
        description:
            'Maneja la fila, los turnos, ventas de productos y el check-in de clientes. Sin acceso a finanzas, sueldos ni equipo.',
        icon: Headphones,
        accent: {
            bg: 'bg-fuchsia-500/10 dark:bg-fuchsia-500/20',
            text: 'text-fuchsia-600 dark:text-fuchsia-400',
            ring: 'ring-fuchsia-500/30',
        },
        baseRole: 'receptionist' as UserRole,
        permissionKeys: [
            'dashboard.access',
            'queue.view',
            'queue.manage',
            'staff.view',
            'clients.view',
            'clients.edit',
            'services.view',
            'products.sell',
            'calendar.view',
            'appointments.view',
            'appointments.manage',
            'rewards.view',
            'agreements.view',
        ],
    },
    {
        id: 'senior-barber',
        name: 'Barbero Senior',
        tagline: 'Barbero con vista financiera',
        description:
            'Como Barbero, pero con acceso a sus estadísticas, comisiones e incentivos. Ideal para referentes del equipo.',
        icon: Award,
        accent: {
            bg: 'bg-amber-500/10 dark:bg-amber-500/20',
            text: 'text-amber-600 dark:text-amber-500',
            ring: 'ring-amber-500/30',
        },
        baseRole: 'barber' as UserRole,
        permissionKeys: [
            'dashboard.access',
            'dashboard.home',
            'queue.view',
            'queue.manage',
            'queue.hide_self',
            'clients.view',
            'services.view',
            'products.sell',
            'salary.view_commissions',
            'stats.view',
            'incentives.view',
            'calendar.view',
            'appointments.view',
            'rewards.view',
        ],
    },
    {
        id: 'barber',
        name: 'Barbero',
        tagline: 'Atiende clientes en la fila',
        description:
            'Acceso esencial: fila, sus clientes, su calendario y la posibilidad de ocultarse del check-in.',
        icon: Scissors,
        accent: {
            bg: 'bg-slate-500/10 dark:bg-slate-500/20',
            text: 'text-slate-700 dark:text-slate-300',
            ring: 'ring-slate-500/30',
        },
        baseRole: 'barber' as UserRole,
        permissionKeys: [
            'dashboard.access',
            'queue.view',
            'queue.manage',
            'queue.hide_self',
            'clients.view',
            'services.view',
            'calendar.view',
            'appointments.view',
        ],
    },
    {
        id: 'cashier',
        name: 'Cajero',
        tagline: 'Cobra y registra movimientos',
        description:
            'Maneja caja, métodos de cobro y ventas de productos. Ve el resumen financiero del día sin tocar sueldos ni configuración.',
        icon: Wallet,
        accent: {
            bg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
            text: 'text-emerald-600 dark:text-emerald-400',
            ring: 'ring-emerald-500/30',
        },
        baseRole: 'receptionist' as UserRole,
        permissionKeys: [
            'dashboard.access',
            'queue.view',
            'clients.view',
            'services.view',
            'products.sell',
            'finances.view_summary',
            'finances.view_expenses',
            'finances.view_accounts',
            'finances.create_expense',
            'appointments.view',
        ],
    },
    {
        id: 'auditor',
        name: 'Auditor / Solo lectura',
        tagline: 'Ve todo, no modifica nada',
        description:
            'Lectura total del negocio: finanzas, sueldos, estadísticas, clientes, equipo. Pensado para contadores o socios silenciosos.',
        icon: Eye,
        accent: {
            bg: 'bg-violet-500/10 dark:bg-violet-500/20',
            text: 'text-violet-600 dark:text-violet-400',
            ring: 'ring-violet-500/30',
        },
        baseRole: 'admin' as UserRole,
        permissionKeys: ALL_PERMISSION_KEYS.filter(
            (k) =>
                k === 'dashboard.access' ||
                k === 'dashboard.home' ||
                k.endsWith('.view') ||
                k.startsWith('finances.view_') ||
                k.startsWith('salary.view'),
        ),
    },
]

export const ROLE_TEMPLATES: readonly RoleTemplate[] = TEMPLATE_DEFS

/**
 * Construye el objeto `permissions` (record bool) para una plantilla.
 */
export function buildTemplatePermissions(
    template: RoleTemplate,
): Record<string, boolean> {
    const perms: Record<string, boolean> = {}
    template.permissionKeys.forEach((key) => {
        perms[key] = true
    })
    return perms
}

/**
 * Devuelve la plantilla cuyos permission keys coinciden 1:1 con el set dado.
 * Útil para mostrar el badge de "creado desde plantilla X" en la card del rol.
 */
export function findMatchingTemplate(
    permissions: Record<string, boolean> | null | undefined,
): RoleTemplate | null {
    if (!permissions) return null
    const enabled = Object.entries(permissions)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .sort()
    const enabledKey = enabled.join('|')
    for (const t of ROLE_TEMPLATES) {
        const tplKey = [...t.permissionKeys].sort().join('|')
        if (tplKey === enabledKey) return t
    }
    return null
}

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
    agreements: {
        label: 'Convenios Comerciales',
        permissions: {
            'agreements.view': 'Ver convenios y partners',
            'agreements.manage': 'Invitar partners, aprobar/rechazar convenios',
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
 * Descripciones breves de cada permiso para mostrar al usuario en el editor de roles.
 */
export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
    'dashboard.access': 'Sin este permiso el usuario no puede ingresar al panel. Es obligatorio para cualquier rol.',
    'dashboard.home': 'Muestra las métricas del día: atenciones, ingresos y resumen general.',

    'queue.view': 'Permite ver la fila de espera de clientes en tiempo real.',
    'queue.manage': 'Permite iniciar atenciones, marcarlas como completadas y gestionar el flujo de la fila.',
    'queue.reassign': 'Permite mover un cliente de un barbero a otro dentro de la fila activa.',
    'queue.hide_self': 'El barbero puede ocultarse del listado de selección en el kiosco de check-in.',

    'staff.view': 'Permite ver el listado del equipo, sus datos y estadísticas básicas.',
    'staff.create': 'Permite agregar nuevos barberos u otros miembros al equipo.',
    'staff.edit': 'Permite modificar nombre, sucursal, PIN y datos de miembros existentes.',
    'staff.deactivate': 'Permite activar o dar de baja miembros sin eliminarlos permanentemente.',
    'staff.hide': 'Permite ocultar o mostrar un miembro en el flujo de selección del check-in.',

    'breaks.view': 'Permite ver el historial y estado actual de los descansos del equipo.',
    'breaks.grant': 'Permite autorizar y otorgar descansos a los miembros del equipo.',
    'breaks.configure': 'Permite crear y editar los tipos de descanso disponibles y su duración.',

    'finances.view_summary': 'Permite ver el resumen de ingresos y egresos del negocio.',
    'finances.view_expenses': 'Permite ver el detalle de gastos variables registrados.',
    'finances.view_fixed': 'Permite ver los gastos fijos configurados para el negocio.',
    'finances.view_accounts': 'Permite ver las cuentas de cobro (efectivo, transferencia, etc.).',
    'finances.create_expense': 'Permite registrar nuevos gastos e ingresos en el sistema.',
    'finances.manage_accounts': 'Permite crear, editar y eliminar cuentas y métodos de pago.',

    'salary.view': 'Permite ver los sueldos configurados para cada miembro del equipo.',
    'salary.view_commissions': 'Permite ver el detalle de comisiones generadas por atención.',
    'salary.configure': 'Permite definir el esquema de sueldo: fijo, comisión por corte o combinado.',
    'salary.pay': 'Permite registrar el pago de sueldos y marcarlos como liquidados.',

    'clients.view': 'Permite ver el listado de clientes y su historial de visitas.',
    'clients.edit': 'Permite modificar los datos de perfil de los clientes.',

    'services.view': 'Permite ver el catálogo de servicios y productos del negocio.',
    'services.manage': 'Permite crear, editar y eliminar servicios del catálogo.',
    'products.manage': 'Permite crear, editar y eliminar productos del inventario.',
    'products.sell': 'Permite registrar ventas de productos desde el panel.',

    'stats.view': 'Permite acceder a los reportes y estadísticas históricas del negocio.',

    'incentives.view': 'Permite ver las reglas y logros del programa de incentivos.',
    'incentives.manage': 'Permite crear y modificar las reglas del programa de incentivos.',
    'incentives.achieve': 'Permite registrar manualmente un logro de incentivo para un barbero.',

    'discipline.view': 'Permite ver el registro de eventos y reglas disciplinarias del equipo.',
    'discipline.manage': 'Permite crear y modificar las reglas del sistema disciplinario.',
    'discipline.record': 'Permite cargar un evento disciplinario a un miembro del equipo.',

    'calendar.view': 'Permite ver los horarios semanales y excepciones de los barberos.',
    'calendar.manage': 'Permite editar horarios, agregar bloques y registrar ausencias o días especiales.',

    'branches.view': 'Permite ver el listado de sucursales y sus datos básicos.',
    'branches.manage': 'Permite crear nuevas sucursales y modificar la configuración de las existentes.',

    'rewards.view': 'Permite ver el programa de fidelización y el catálogo de recompensas.',
    'rewards.manage': 'Permite crear y editar recompensas, niveles y reglas del programa de fidelización.',

    'agreements.view': 'Permite ver el listado de partners aliados y los beneficios que ofrecen a los clientes.',
    'agreements.manage': 'Permite invitar nuevos partners, aprobar o rechazar beneficios y pausar convenios.',

    'settings.view': 'Permite ver la configuración general del negocio.',
    'settings.manage': 'Permite modificar la configuración del sistema, datos del negocio y preferencias.',

    'roles.manage': 'Permite crear, editar y eliminar roles, y asignar permisos a cada uno. Solo para dueños.',
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

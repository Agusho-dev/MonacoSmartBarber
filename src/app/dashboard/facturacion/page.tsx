import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getCurrentUserPermissions } from '@/lib/actions/permissions-gate'
import { getEstadoFacturador } from '@/lib/actions/arca'
import { getComprobantes } from '@/lib/actions/arca-emision'
import { FacturacionClient } from './facturacion-client'

export const dynamic = 'force-dynamic'
// Las server actions heredan el segment config de la página. Emitir un lote son
// 2-3 round-trips SOAP a ARCA POR comprobante, secuenciales: con el default de
// la plataforma, un lote de 60 se corta a la mitad y el usuario no se entera.
export const maxDuration = 300
export const metadata: Metadata = { title: 'Facturación ARCA | BarberOS' }

export default async function FacturacionPage() {
    const orgId = await getCurrentOrgId()
    if (!orgId) redirect('/login')

    const perms = await getCurrentUserPermissions()
    if (!perms['arca.view']) redirect('/dashboard')

    const [estado, comprobantes] = await Promise.all([
        getEstadoFacturador(),
        getComprobantes({ limite: 100 }),
    ])

    return (
        <FacturacionClient
            estadoInicial={estado}
            comprobantesIniciales={comprobantes}
            puedeConfigurar={perms['arca.manage'] === true}
            puedeEmitir={perms['arca.emit'] === true}
        />
    )
}

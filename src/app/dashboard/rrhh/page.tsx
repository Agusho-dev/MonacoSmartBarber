import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentOrgId } from '@/lib/actions/org'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import {
  listarCandidatos,
  getMetricasRrhh,
  getEtiquetasRrhh,
  getPlantillasRrhh,
  getDifusionesRrhh,
} from '@/lib/actions/rrhh'
import { RrhhClient, PAGINA_RRHH } from './rrhh-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Recursos humanos · Monaco',
  description: 'Barberos que se postularon por WhatsApp e Instagram',
}

export default async function RrhhPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  if (!(await currentUserCan('rrhh.view'))) redirect('/dashboard')

  const [candidatos, metricas, etiquetas, plantillas, difusiones, canManage] = await Promise.all([
    // El mismo tamaño de página que usa el cliente: con dos tamaños distintos,
    // el primer "Ver más" pedía offset 48 sobre 60 ya cargadas y repetía 12 fichas.
    listarCandidatos({ limit: PAGINA_RRHH, orden: 'reciente' }),
    getMetricasRrhh(),
    getEtiquetasRrhh(),
    getPlantillasRrhh(false),
    getDifusionesRrhh(),
    currentUserCan('rrhh.manage'),
  ])

  return (
    <RrhhClient
      candidatosIniciales={candidatos.data}
      totalInicial={candidatos.total}
      sinEtiqueta={candidatos.sinEtiqueta}
      errorInicial={candidatos.error}
      metricas={metricas.data}
      etiquetas={etiquetas.data}
      plantillas={plantillas.data}
      difusiones={difusiones.data}
      canManage={canManage}
    />
  )
}

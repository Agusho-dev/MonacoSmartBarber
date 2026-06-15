import { z } from 'zod'

// Contrato del objeto "reporte" que produce la herramienta generar_reporte.
// El mismo objeto alimenta el render en pantalla (ReportCard / preview) y el PDF
// de marca (exportAssistantReportPDF). El modelo NO genera imágenes: para los
// gráficos solo provee datos (label + value) y el cliente los dibuja con recharts.

export const reportKpiSchema = z.object({
  label: z.string().describe('Nombre del indicador, ej: "Ingresos"'),
  value: z.string().describe('Valor ya formateado, ej: "$1.420.300" o "32%"'),
  delta: z.string().optional().describe('Variación, ej: "+12% vs mes anterior"'),
  tone: z.enum(['up', 'down', 'neutral']).optional(),
})

export const reportTableSchema = z.object({
  title: z.string(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number()]))),
})

export const reportChartSchema = z.object({
  title: z.string(),
  type: z.enum(['area', 'bar', 'pie']),
  data: z.array(z.object({ label: z.string(), value: z.number() })),
})

export const assistantReportSchema = z.object({
  title: z.string().describe('Título del informe, ej: "Resumen financiero — Mayo 2026"'),
  periodLabel: z.string().optional().describe('Período cubierto, ej: "1 al 31 de mayo 2026"'),
  branchLabel: z.string().optional().describe('Sucursal o "Todas las sucursales"'),
  kpis: z.array(reportKpiSchema).default([]),
  tables: z.array(reportTableSchema).default([]),
  charts: z.array(reportChartSchema).default([]),
  narrative: z.string().optional().describe('Síntesis ejecutiva en markdown (2-4 párrafos).'),
})

export type ReportKpi = z.infer<typeof reportKpiSchema>
export type ReportTable = z.infer<typeof reportTableSchema>
export type ReportChart = z.infer<typeof reportChartSchema>
export type AssistantReport = z.infer<typeof assistantReportSchema>

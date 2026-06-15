'use client'

import type { AssistantReport } from '@/lib/asistente/report-schema'

export function exportCSV(
  headers: string[],
  rows: (string | number)[][],
  filename: string
) {
  if (rows.length === 0) return
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n')

  const blob = new Blob(['\ufeff' + csvContent], {
    type: 'text/csv;charset=utf-8;',
  })
  triggerDownload(blob, `${filename}.csv`)
}

export async function exportPDF(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  filename: string
) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text(title, 14, 20)
  doc.setFontSize(10)
  doc.text(`Generado: ${new Date().toLocaleDateString('es-AR')}`, 14, 28)

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map(String)),
    startY: 35,
    theme: 'grid',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [40, 40, 40] },
  })

  doc.save(`${filename}.pdf`)
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Recibo de pago salarial ─────────────────────────────────────────────────

const REPORT_TYPE_LABELS: Record<string, string> = {
  commission: 'Comisión',
  base_salary: 'Sueldo base',
  bonus: 'Bono',
  advance: 'Adelanto',
  hybrid_deficit: 'Déficit híbrido',
  product_commission: 'Comisión producto',
  tip: 'Propina',
}

export interface ReceiptReport {
  id: string
  type: string
  amount: number
  report_date: string
  notes: string | null
}

export interface ReceiptData {
  barberName: string
  batchDate: string
  totalAmount: number
  notes: string | null
  reports: ReceiptReport[]
  orgName?: string
}

export async function exportPaymentReceiptPDF(data: ReceiptData) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()

  const orgName = data.orgName ?? 'BarberOS'

  // Header
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Recibo de Pago', pageWidth / 2, 22, { align: 'center' })

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(orgName, pageWidth / 2, 30, { align: 'center' })

  doc.setDrawColor(200)
  doc.line(14, 34, pageWidth - 14, 34)

  // Info del pago
  let y = 42
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Barbero:', 14, y)
  doc.setFont('helvetica', 'normal')
  doc.text(data.barberName, 50, y)

  y += 7
  doc.setFont('helvetica', 'bold')
  doc.text('Fecha de pago:', 14, y)
  doc.setFont('helvetica', 'normal')
  doc.text(
    new Date(data.batchDate).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    50,
    y
  )

  // Período comprendido
  const sortedDates = data.reports
    .map((r) => r.report_date)
    .sort((a, b) => a.localeCompare(b))
  const periodFrom = sortedDates[0]
  const periodTo = sortedDates[sortedDates.length - 1]

  y += 7
  doc.setFont('helvetica', 'bold')
  doc.text('Período:', 14, y)
  doc.setFont('helvetica', 'normal')
  const fmtDate = (d: string) =>
    new Date(d + 'T12:00').toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  doc.text(`${fmtDate(periodFrom)} — ${fmtDate(periodTo)}`, 50, y)

  if (data.notes) {
    y += 7
    doc.setFont('helvetica', 'bold')
    doc.text('Notas:', 14, y)
    doc.setFont('helvetica', 'normal')
    doc.text(data.notes, 50, y)
  }

  y += 10

  // Tabla de detalle
  const bodyRows = data.reports
    .sort((a, b) => a.report_date.localeCompare(b.report_date))
    .map((r) => {
      const isNeg = r.amount < 0
      const fmtAmt = isNeg
        ? `-$${Math.abs(r.amount).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
        : `$${r.amount.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
      return [
        fmtDate(r.report_date),
        REPORT_TYPE_LABELS[r.type] ?? r.type,
        r.notes ?? '—',
        fmtAmt,
      ]
    })

  // Fila de total
  const totalFmt = data.totalAmount < 0
    ? `-$${Math.abs(data.totalAmount).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
    : `$${data.totalAmount.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`

  bodyRows.push(['', '', 'TOTAL', totalFmt])

  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Tipo', 'Detalle', 'Monto']],
    body: bodyRows,
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 30 },
      2: { cellWidth: 'auto' },
      3: { halign: 'right', cellWidth: 30 },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (hookData) => {
      // Estilizar fila de total
      if (hookData.row.index === bodyRows.length - 1) {
        hookData.cell.styles.fontStyle = 'bold'
        hookData.cell.styles.fillColor = [240, 240, 240]
      }
    },
  })

  // Footer
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(
      `${orgName} · Recibo de pago · Página ${i} de ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    )
  }

  const safeName = data.barberName.replace(/\s+/g, '-').toLowerCase()
  doc.save(`recibo-${safeName}-${periodFrom}-${periodTo}.pdf`)
}

// ─── Informe del Asistente IA ────────────────────────────────────────────────

export async function exportAssistantReportPDF(
  report: AssistantReport,
  opts: { orgName?: string } = {}
) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const orgName = opts.orgName ?? 'BarberOS'

  // Header de marca
  doc.setFillColor(17, 17, 17)
  doc.rect(0, 0, pageWidth, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.text(report.title, margin, 14)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(190, 190, 190)
  const sub = [report.periodLabel, report.branchLabel].filter(Boolean).join('  ·  ')
  if (sub) doc.text(sub, margin, 21)
  doc.setTextColor(180, 150, 70)
  doc.text(orgName.toUpperCase(), pageWidth - margin, 14, { align: 'right' })

  let y = 40
  doc.setTextColor(20, 20, 20)

  // KPIs en grilla de tarjetas
  if (report.kpis.length > 0) {
    const perRow = report.kpis.length >= 4 ? 4 : report.kpis.length
    const gap = 4
    const cardW = (pageWidth - margin * 2 - gap * (perRow - 1)) / perRow
    const cardH = 22
    report.kpis.forEach((k, i) => {
      const col = i % perRow
      const row = Math.floor(i / perRow)
      const x = margin + col * (cardW + gap)
      const cy = y + row * (cardH + gap)
      doc.setDrawColor(225, 225, 225)
      doc.setFillColor(248, 248, 248)
      doc.roundedRect(x, cy, cardW, cardH, 2, 2, 'FD')
      doc.setFontSize(7.5)
      doc.setTextColor(120, 120, 120)
      doc.text(doc.splitTextToSize(k.label, cardW - 6), x + 3, cy + 6)
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 20, 20)
      doc.text(String(k.value), x + 3, cy + 14)
      if (k.delta) {
        doc.setFontSize(7)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(k.tone === 'down' ? 200 : 90, k.tone === 'down' ? 70 : 160, 90)
        doc.text(String(k.delta), x + 3, cy + 19)
      }
      doc.setTextColor(20, 20, 20)
      doc.setFont('helvetica', 'normal')
    })
    const rows = Math.ceil(report.kpis.length / perRow)
    y += rows * (cardH + gap) + 4
  }

  // Tablas
  for (const t of report.tables) {
    if (y > pageHeight - 40) { doc.addPage(); y = 20 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(t.title, margin, y)
    y += 3
    autoTable(doc, {
      startY: y + 2,
      head: [t.headers],
      body: t.rows.map((r) => r.map(String)),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
      margin: { left: margin, right: margin },
    })
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = (doc.lastAutoTable?.finalY ?? y) + 8
  }

  // Gráficos (barras horizontales simples)
  for (const ch of report.charts) {
    if (y > pageHeight - 50) { doc.addPage(); y = 20 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 20, 20)
    doc.text(ch.title, margin, y)
    y += 6
    const max = Math.max(1, ...ch.data.map((d) => Math.abs(d.value)))
    const barMaxW = pageWidth - margin * 2 - 60
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    for (const d of ch.data.slice(0, 12)) {
      if (y > pageHeight - 20) { doc.addPage(); y = 20 }
      doc.setTextColor(80, 80, 80)
      doc.text(doc.splitTextToSize(d.label, 38)[0] ?? d.label, margin, y + 3)
      const w = (Math.abs(d.value) / max) * barMaxW
      doc.setFillColor(60, 60, 60)
      doc.roundedRect(margin + 40, y, Math.max(1, w), 4.5, 1, 1, 'F')
      doc.setTextColor(40, 40, 40)
      doc.text(d.value.toLocaleString('es-AR'), margin + 42 + w, y + 3.6)
      y += 7
    }
    y += 4
  }

  // Síntesis (narrativa)
  if (report.narrative) {
    if (y > pageHeight - 40) { doc.addPage(); y = 20 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 20, 20)
    doc.text('Síntesis', margin, y)
    y += 6
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const clean = report.narrative.replace(/[#*_`>]/g, '')
    const lines = doc.splitTextToSize(clean, pageWidth - margin * 2)
    for (const line of lines) {
      if (y > pageHeight - 18) { doc.addPage(); y = 20 }
      doc.text(line, margin, y)
      y += 5
    }
  }

  // Footer
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(
      `${orgName} · Generado por el Asistente IA · ${new Date().toLocaleDateString('es-AR')} · Pág. ${i}/${pageCount}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    )
  }

  const safe = report.title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase().slice(0, 50)
  doc.save(`informe-${safe || 'asistente'}.pdf`)
}

'use client'

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

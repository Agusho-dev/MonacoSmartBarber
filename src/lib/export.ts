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

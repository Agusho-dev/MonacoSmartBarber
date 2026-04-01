import fs from 'fs'
import path from 'path'
import Link from 'next/link'

export default function DocsIndexPage() {
  const docsDir = path.join(process.cwd(), 'docs')
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'))

  const docs = files.map((file) => {
    const content = fs.readFileSync(path.join(docsDir, file), 'utf-8')
    const firstLine = content.split('\n').find((l) => l.startsWith('# '))
    const title = firstLine ? firstLine.replace(/^# /, '') : file.replace('.md', '')
    return { file: file.replace('.md', ''), title }
  })

  return (
    <div className="min-h-screen bg-background text-foreground p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Documentación interna</h1>
      <p className="text-muted-foreground mb-8">Monaco Smart Barber</p>
      <ul className="space-y-3">
        {docs.map(({ file, title }) => (
          <li key={file}>
            <Link
              href={`/docs/${file}`}
              className="block p-4 rounded-lg border border-border hover:bg-muted transition-colors"
            >
              <span className="font-medium">{title}</span>
              <span className="ml-2 text-xs text-muted-foreground">{file}.md</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

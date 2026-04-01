import fs from 'fs'
import path from 'path'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import DocRenderer from './doc-renderer'

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  const docsDir = path.join(process.cwd(), 'docs')
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'))
  return files.map((f) => ({ slug: f.replace('.md', '') }))
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params
  const filePath = path.join(process.cwd(), 'docs', `${slug}.md`)

  if (!fs.existsSync(filePath)) {
    notFound()
  }

  const content = fs.readFileSync(filePath, 'utf-8')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link
            href="/docs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Volver al índice
          </Link>
        </div>
        <DocRenderer content={content} />
      </div>
    </div>
  )
}

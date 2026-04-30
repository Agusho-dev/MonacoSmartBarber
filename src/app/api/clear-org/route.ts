import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

async function clear(request: NextRequest) {
  const cookieStore = await cookies()
  cookieStore.delete('active_organization')
  cookieStore.delete('public_organization')

  const url = new URL('/', request.url)
  return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
  return clear(request)
}

export async function GET(request: NextRequest) {
  return clear(request)
}

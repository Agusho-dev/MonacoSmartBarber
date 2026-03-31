import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  cookieStore.delete('active_organization')

  const url = new URL('/', request.url)
  return NextResponse.redirect(url, 303)
}

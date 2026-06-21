import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const workspaces = await prisma.workspace.findMany({
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json({ data: workspaces, error: null })
  } catch (err) {
    return NextResponse.json({ data: [], error: (err as Error).message })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, layoutJson, isDefault } = await request.json() as { name: string; layoutJson: unknown; isDefault?: boolean }

    if (!name || !layoutJson) {
      return NextResponse.json({ data: null, error: 'name and layoutJson required' }, { status: 400 })
    }

    const workspace = await prisma.workspace.create({
      data: { name, layoutJson, isDefault: isDefault || false },
    })

    return NextResponse.json({ data: workspace, error: null }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { isHosted } from '@/lib/environment'
import { getBaseModelProviders } from '@/providers/ai/utils'

export async function GET() {
  try {
    const allModels = Object.keys(getBaseModelProviders())
    const models = isHosted ? allModels : allModels.filter((model) => !model.startsWith('hosted/'))
    return NextResponse.json({ models })
  } catch (error) {
    return NextResponse.json({ models: [], error: 'Failed to fetch models' }, { status: 500 })
  }
}

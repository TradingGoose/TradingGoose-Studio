import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

const GITHUB_REPO = 'TradingGoose/TradingGoose-Studio'

function formatStarCount(num: number): string {
  if (num < 1000) return String(num)
  const formatted = (Math.round(num / 100) / 10).toFixed(1)
  return formatted.endsWith('.0') ? `${formatted.slice(0, -2)}k` : `${formatted}k`
}

export async function GET() {
  try {
    const token = env.GITHUB_TOKEN
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TradingGoose-Studio/1.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 3600 },
      cache: 'force-cache',
    })

    if (!response.ok) {
      if (!(response.status === 404 && !token)) {
        console.warn('GitHub API request failed:', {
          status: response.status,
          repo: GITHUB_REPO,
          hasToken: Boolean(token),
        })
      }
      return NextResponse.json({ stars: formatStarCount(0) })
    }

    const data = await response.json()
    return NextResponse.json({ stars: formatStarCount(Number(data?.stargazers_count ?? 0)) })
  } catch (error) {
    console.warn('Error fetching GitHub stars:', error)
    return NextResponse.json({ stars: formatStarCount(0) })
  }
}

/**
 * @vitest-environment node
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mockResolveGitHubBlogSourceConfig = vi.fn()

vi.mock('@/lib/system-services/runtime', () => ({
  resolveGitHubBlogSourceConfig: (...args: unknown[]) =>
    mockResolveGitHubBlogSourceConfig(...args),
}))

describe('blog post loader', () => {
  let rootDir = ''
  let cwdSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-blog-'))
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(rootDir)
    mockResolveGitHubBlogSourceConfig.mockResolvedValue({
      blogRepository: null,
      blogBranch: 'main',
    })

    const contentDir = path.join(rootDir, 'app/(landing)/blog/content')
    fs.mkdirSync(path.join(contentDir, 'en/post-one'), { recursive: true })
    fs.mkdirSync(path.join(contentDir, 'es/post-one'), { recursive: true })

    fs.writeFileSync(
      path.join(contentDir, 'en/post-one/index.mdx'),
      `---
title: English post
date: 2026-04-01
description: English description
---

# English body
`
    )
    fs.writeFileSync(
      path.join(contentDir, 'es/post-one/index.mdx'),
      `---
title: Publicación en español
date: 2026-04-02
description: Descripción en español
---

# Cuerpo español
`
    )

    vi.resetModules()
  })

  afterEach(() => {
    cwdSpy.mockRestore()
    fs.rmSync(rootDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('prefers locale-specific content and falls back to English when translation is missing', async () => {
    const { getAllPosts, getPostBySlug } = await import('./posts')

    const spanishPosts = await getAllPosts('es')
    expect(spanishPosts).toHaveLength(1)
    expect(spanishPosts[0]?.title).toBe('Publicación en español')

    const fallbackPosts = await getAllPosts('zh-CN')
    expect(fallbackPosts).toHaveLength(1)
    expect(fallbackPosts[0]?.title).toBe('English post')

    const fallbackPost = await getPostBySlug('post-one', 'zh-CN')
    expect(fallbackPost?.title).toBe('English post')
  })
})

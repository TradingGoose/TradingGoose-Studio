/** @vitest-environment node */
import { afterEach, expect, it, vi } from 'vitest'
import { JiraBlock } from '@/blocks/blocks/jira'
import { jiraBulkRetrieveTool } from './bulk_read'

vi.mock('@/components/icons/icons', () => ({ JiraIcon: () => null }))
afterEach(() => vi.unstubAllGlobals())

const params = { accessToken: 'test', domain: 'example.atlassian.net', projectId: 'PROJ' }
const fields = { summary: 'Issue', created: 'created', updated: 'updated' }

it.each([
  [undefined, 0, 'PROJ'],
  [undefined, 1, '10001'],
  ['cloud', 0, '10001'],
  ['cloud', 1, 'PROJ'],
] as const)(
  'returns canonical issues with cloudId %s, count %d and project %s',
  async (cloudId, count, projectId) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ isLast: true, issues: Array(count).fill({ fields }) }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await jiraBulkRetrieveTool.transformResponse!(
      Response.json([
        { id: 'wrong-cloud', url: 'https://other.atlassian.net' },
        { id: 'cloud', url: 'https://EXAMPLE.atlassian.net' },
      ]),
      { ...params, projectId, cloudId }
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      issues: Array(count).fill({ ...fields, ts: expect.any(String), description: '' }),
    })
    expect(Object.keys(result.output)).toEqual(Object.keys(jiraBulkRetrieveTool.outputs!))
    expect(JiraBlock.outputs?.issues).toMatchObject({ type: 'array' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/ex/jira/cloud/rest/api/3/search/jql')
    expect(url.searchParams.get('jql')).toBe(`project = "${projectId}" ORDER BY updated DESC`)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test')
  }
)

it.each([205, 1001])(
  'paginates %d issues using cursors up to the 1000-result cap',
  async (total) => {
    let offset = 0
    const fetchMock = vi.fn(async (url: string) => {
      const query = new URL(url).searchParams
      expect(query.has('startAt')).toBe(false)
      expect(query.get('maxResults')).toBe('100')
      expect(query.get('nextPageToken')).toBe(offset ? `page-${offset}` : null)
      const issues = Array.from({ length: Math.min(100, total - offset) }, () => ({
        fields: { ...fields, summary: `Issue ${offset++}` },
      }))
      return Response.json({ issues, isLast: offset >= total, nextPageToken: `page-${offset}` })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await jiraBulkRetrieveTool.transformResponse!(Response.json([]), {
      ...params,
      cloudId: 'cloud',
    })
    expect(result.output.issues.map((issue) => issue.summary)).toEqual(
      Array.from({ length: Math.min(total, 1000) }, (_, index) => `Issue ${index}`)
    )
    expect(fetchMock).toHaveBeenCalledTimes(Math.ceil(Math.min(total, 1000) / 100))
  }
)

it('rejects an unmatched tenant instead of using the first resource', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  await expect(
    jiraBulkRetrieveTool.transformResponse!(
      Response.json([{ id: 'other', url: 'https://other.atlassian.net' }]),
      params
    )
  ).rejects.toThrow(`No Jira resource found for ${params.domain}`)
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each([400, 401, 429, 500])(
  'rejects HTTP %d instead of returning empty success',
  async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status })))
    await expect(
      jiraBulkRetrieveTool.transformResponse!(Response.json([]), {
        ...params,
        cloudId: 'cloud',
      })
    ).rejects.toThrow(`Failed to fetch Jira issues (${status})`)
  }
)

it.each([
  [' PROJ ', '', 'jira_bulk_read', { projectId: 'PROJ' }],
  ['', ' PROJ-1 ', 'jira_retrieve', { issueKey: 'PROJ-1' }],
  [' PROJ ', ' PROJ-1 ', 'jira_retrieve', { projectId: 'PROJ', issueKey: 'PROJ-1' }],
])(
  'resolves the canonical read contract for project %s and issue %s',
  (projectId, issueKey, tool, expected) => {
    const input = { ...params, operation: 'read', projectId, issueKey, credential: 'credential' }
    expect(JiraBlock.tools.config!.tool(input)).toBe(tool)
    expect(JiraBlock.tools.config!.params!(input)).toEqual({
      domain: params.domain,
      credential: 'credential',
      ...expected,
    })
  }
)

it('rejects reads with neither a project nor an issue', () => {
  expect(() =>
    JiraBlock.tools.config!.params!({ operation: 'read', projectId: ' ', issueKey: ' ' })
  ).toThrow('Select a project to read issues, or provide an issue key to read a single issue.')
})

it.each(['read-bulk', 'unknown', undefined])('rejects unsupported operation %s', (operation) => {
  const input = { ...params, operation }
  expect(() => JiraBlock.tools.config!.tool(input)).toThrow('Unsupported Jira operation')
  expect(() => JiraBlock.tools.config!.params!(input)).toThrow('Unsupported Jira operation')
})

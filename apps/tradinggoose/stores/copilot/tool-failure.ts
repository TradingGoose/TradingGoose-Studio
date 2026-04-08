export async function reportClientManagedToolFailure(params: {
  id: string
  name?: string
  message: string
  instance?: { markToolComplete?: (status: number, message?: any, data?: any) => Promise<boolean> }
  fetchImpl?: typeof fetch
}): Promise<void> {
  const { id, name, message, instance } = params
  const fetchImpl = params.fetchImpl ?? fetch

  try {
    if (typeof instance?.markToolComplete === 'function') {
      await instance.markToolComplete(500, message)
      return
    }

    await fetchImpl('/api/copilot/tools/mark-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name: name || 'unknown_tool',
        status: 500,
        message,
      }),
    })
  } catch {}
}

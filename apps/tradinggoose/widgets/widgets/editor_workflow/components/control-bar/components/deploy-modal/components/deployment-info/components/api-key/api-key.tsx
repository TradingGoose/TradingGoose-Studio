'use client'

import { Label } from '@/components/ui/label'
import { useWorkflowApiKeyCopy } from '@/widgets/widgets/editor_workflow/copy'

interface ApiKeyProps {
  apiKey: string | null
}

export function ApiKey({ apiKey }: ApiKeyProps) {
  const copy = useWorkflowApiKeyCopy()
  // Extract key name and type from the API response format "Name (type)"
  const match = apiKey?.match(/^(.*?)\s+\(([^)]+)\)$/)
  const name = match ? match[1].trim() : (apiKey ?? copy.selectAnApiKey)
  const type = match?.[2]
  const typeLabel =
    type === 'workspace' ? copy.workspaceLabel : type === 'personal' ? copy.personalLabel : type

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center gap-1.5'>
        <Label className='font-medium text-sm'>{copy.apiKey}</Label>
      </div>
      <div className='rounded-md border bg-background'>
        <div className='flex items-center justify-between p-3'>
          <pre className='flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs'>{name}</pre>
          {type && (
            <div className='ml-2 flex-shrink-0'>
              <span className='inline-flex items-center rounded-md bg-muted px-2 py-1 font-medium text-muted-foreground text-xs capitalize'>
                {typeLabel}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { CopyButton } from '@/components/ui/copy-button'
import { Label } from '@/components/ui/label'
import { useDeploymentCopy } from '@/widgets/widgets/editor_workflow/copy'

interface ExampleCommandProps {
  endpoint: string
  getInputFormatExample: () => string
}

export function ExampleCommand({ endpoint, getInputFormatExample }: ExampleCommandProps) {
  const copy = useDeploymentCopy()
  const command = `curl -X POST \\\n  -H "X-API-Key: $TRADINGGOOSE_API_KEY" \\\n  -H "Content-Type: application/json"${getInputFormatExample()} \\\n  ${endpoint}`
  const clipboardCommand = command.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim()

  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <div className='flex items-center justify-between'>
          <Label className='font-medium text-sm'>{copy.example}</Label>
        </div>

        <div className='group relative overflow-x-auto rounded-md border bg-background transition-colors hover:bg-card/50'>
          <pre className='whitespace-pre p-3 font-mono text-xs'>{command}</pre>
          <CopyButton text={clipboardCommand} />
        </div>
      </div>
    </div>
  )
}

'use client'

import { CopyButton } from '@/components/ui/copy-button'
import { Label } from '@/components/ui/label'

interface ExampleCommandProps {
  command: string
  apiKey: string
  endpoint: string
  showLabel?: boolean
  getInputFormatExample?: () => string
}

export function ExampleCommand({
  command,
  apiKey,
  endpoint,
  showLabel = true,
  getInputFormatExample,
}: ExampleCommandProps) {
  const formatCurlCommand = (command: string, apiKey: string) => {
    if (!command.includes('curl')) return command

    const sanitizedCommand = command.replace(apiKey, '$TRADINGGOOSE_API_KEY')

    return sanitizedCommand
      .replace(' -H ', '\n  -H ')
      .replace(' -d ', '\n  -d ')
      .replace(' http', '\n  http')
  }

  const getActualCommand = () => {
    const displayCommand = getDisplayCommand()
    return displayCommand
      .replace(/\\\n\s*/g, ' ') // Remove backslash + newline + whitespace
      .replace(/\n\s*/g, ' ') // Remove any remaining newlines + whitespace
      .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
      .trim()
  }

  const getDisplayCommand = () => {
    const baseEndpoint = endpoint.replace(apiKey, '$TRADINGGOOSE_API_KEY')
    if (getInputFormatExample) {
      return `curl -X POST \\\n  -H "X-API-Key: $TRADINGGOOSE_API_KEY" \\\n  -H "Content-Type: application/json"${getInputFormatExample()} \\\n  ${baseEndpoint}`
    }

    return formatCurlCommand(command, apiKey)
  }

  return (
    <div className='space-y-4'>
      {/* Example Command */}
      <div className='space-y-1.5'>
        <div className='flex items-center justify-between'>
          {showLabel && <Label className='font-medium text-sm'>Example</Label>}
        </div>

        <div className='group relative overflow-x-auto rounded-md border bg-background transition-colors hover:bg-card/50'>
          <pre className='whitespace-pre p-3 font-mono text-xs'>{getDisplayCommand()}</pre>
          <CopyButton text={getActualCommand()} />
        </div>
      </div>
    </div>
  )
}

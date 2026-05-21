import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  JsonDisplay,
  type JsonDisplayMode,
  stringifyJsonDisplay,
} from '@/components/json-display/json-display'
import { CopyButton } from '@/components/ui/copy-button'
import type { TraceSpan } from '@/stores/logs/filters/types'

interface CollapsibleInputOutputProps {
  span: TraceSpan
  depth: number
  displayMode: JsonDisplayMode
  wrapText: boolean
}

export function CollapsibleInputOutput({
  span,
  depth,
  displayMode,
  wrapText,
}: CollapsibleInputOutputProps) {
  const [inputExpanded, setInputExpanded] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)

  const leftMargin = depth * 16 + 8 + 24
  const inputCopyText = useMemo(() => stringifyJsonDisplay(span.input), [span.input])
  const outputCopyText = useMemo(() => stringifyJsonDisplay(span.output), [span.output])
  const dataContainerClassName = 'group relative rounded'

  return (
    <div className='mt-2 mr-4 mb-4 space-y-3' style={{ marginLeft: `${leftMargin}px` }}>
      {span.input && (
        <div>
          <button
            onClick={() => setInputExpanded(!inputExpanded)}
            className='mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground'
          >
            {inputExpanded ? (
              <ChevronDown className='h-3 w-3' />
            ) : (
              <ChevronRight className='h-3 w-3' />
            )}
            Input
          </button>
          {inputExpanded && (
            <div className='mb-2 rounded-md bg-secondary/30 p-3'>
              <div className={dataContainerClassName}>
                <CopyButton text={inputCopyText} />
                <JsonDisplay
                  data={span.input}
                  mode={displayMode}
                  wrapText={wrapText}
                  className='max-h-60 text-xs'
                />
              </div>
            </div>
          )}
        </div>
      )}

      {span.output && (
        <div>
          <button
            onClick={() => setOutputExpanded(!outputExpanded)}
            className='mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground'
          >
            {outputExpanded ? (
              <ChevronDown className='h-3 w-3' />
            ) : (
              <ChevronRight className='h-3 w-3' />
            )}
            {span.status === 'error' ? 'Error' : 'Output'}
          </button>
          {outputExpanded && (
            <div className='mb-2 rounded-md bg-secondary/30 p-3'>
              <div className={dataContainerClassName}>
                <CopyButton text={outputCopyText} />
                <JsonDisplay
                  data={span.output}
                  mode={displayMode}
                  wrapText={wrapText}
                  className='max-h-60 text-xs'
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

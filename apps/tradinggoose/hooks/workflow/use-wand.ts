import { useCallback, useEffect, useRef, useState } from 'react'
import type { CompletionEvent, CompletionFailureResponse } from '@/lib/copilot/native/contract'
import { readNativeEvents } from '@/lib/copilot/native/stream'
import { createLogger } from '@/lib/logs/console/logger'
import type { WandConfig } from '@/blocks/types'

const logger = createLogger('useWand')

/**
 * Builds rich context information based on current content and generation type
 */
function buildContextInfo(currentValue?: string, generationType?: string): string {
  if (!currentValue || currentValue.trim() === '') {
    return 'no current content'
  }

  const contentLength = currentValue.length
  const lineCount = currentValue.split('\n').length

  let contextInfo = `Current content (${contentLength} characters, ${lineCount} lines):\n${currentValue}`

  // Add type-specific context analysis
  if (generationType) {
    switch (generationType) {
      case 'javascript-function-body':
      case 'typescript-function-body': {
        // Analyze code structure
        const hasFunction = /function\s+\w+/.test(currentValue)
        const hasArrowFunction = /=>\s*{/.test(currentValue)
        const hasReturn = /return\s+/.test(currentValue)
        contextInfo += `\n\nCode analysis: ${hasFunction ? 'Contains function declaration. ' : ''}${hasArrowFunction ? 'Contains arrow function. ' : ''}${hasReturn ? 'Has return statement.' : 'No return statement.'}`
        break
      }

      case 'json-schema':
      case 'json-object':
        // Analyze JSON structure
        try {
          const parsed = JSON.parse(currentValue)
          const keys = Object.keys(parsed)
          contextInfo += `\n\nJSON analysis: Valid JSON with ${keys.length} top-level keys: ${keys.join(', ')}`
        } catch {
          contextInfo += `\n\nJSON analysis: Invalid JSON - needs fixing`
        }
        break
    }
  }

  return contextInfo
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface UseWandProps {
  wandConfig: WandConfig
  currentValue?: string
  onGeneratedContent: (content: string) => undefined | boolean
  /** Current document identity and direct source read protect late commits from concurrent edits. */
  generationKey?: unknown
  getCurrentValue?: () => string
  onGenerationEnd?: () => void
  onStreamChunk?: (chunk: string) => void
  onStreamStart?: () => void
  onGenerationComplete?: (prompt: string, generatedContent: string) => void
}

export function useWand(props: UseWandProps) {
  const current = useRef(props)
  current.current = props
  const [isLoading, setIsLoading] = useState(false)
  const [isPromptVisible, setIsPromptVisible] = useState(false)
  const [promptInputValue, setPromptInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([])
  const historyRef = useRef<ChatMessage[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
      abortControllerRef.current?.abort()
    },
    []
  )
  const showPromptInline = useCallback(() => {
    setIsPromptVisible(true)
    setError(null)
  }, [])
  const hidePromptInline = useCallback(() => {
    setIsPromptVisible(false)
    setPromptInputValue('')
    setError(null)
  }, [])
  const updatePromptValue = useCallback((value: string) => setPromptInputValue(value), [])
  const cancelGeneration = useCallback(() => {
    generation.current++
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    current.current.onGenerationEnd?.()
    setIsStreaming(false)
    setIsLoading(false)
    setError(null)
  }, [])
  const openPrompt = useCallback(() => {
    setIsPromptVisible(true)
    setPromptInputValue('')
  }, [])
  const closePrompt = useCallback(() => {
    if (!isLoading) {
      setIsPromptVisible(false)
      setPromptInputValue('')
    }
  }, [isLoading])

  const generateStream = useCallback(async ({ prompt }: { prompt: string }) => {
    if (!prompt) {
      setError('Prompt cannot be empty.')
      return
    }
    const start = current.current
    if (!start.wandConfig.enabled) {
      setError('Wand is not enabled.')
      return
    }
    abortControllerRef.current?.abort()
    const id = ++generation.current
    const abort = new AbortController()
    abortControllerRef.current = abort
    const baseValue = start.currentValue
    const baseDocumentValue = start.getCurrentValue?.()
    const key = start.generationKey
    setIsLoading(true)
    setIsStreaming(true)
    setError(null)
    start.onStreamStart?.()
    try {
      const contextInfo = buildContextInfo(baseValue, start.wandConfig.generationType)
      const systemPrompt = start.wandConfig.prompt.replace('{context}', contextInfo)
      const response = await fetch('/api/wand-copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-transform' },
        body: JSON.stringify({
          prompt,
          systemPrompt,
          history: start.wandConfig.maintainHistory ? historyRef.current : [],
          generationType: start.wandConfig.generationType,
        }),
        signal: abort.signal,
        cache: 'no-store',
      })
      if (id !== generation.current || abort.signal.aborted) return
      if (!response.ok) {
        const data: CompletionFailureResponse | { error: string } = await response.json()
        throw new Error(typeof data.error === 'string' ? data.error : data.error.message)
      }
      if (!response.body) throw new Error('Completion stream body is missing')
      let complete = false
      for await (const event of readNativeEvents<CompletionEvent>(response.body, {
        signal: abort.signal,
      })) {
        if (id !== generation.current || abort.signal.aborted) return
        if ('chunk' in event) {
          current.current.onStreamChunk?.(event.chunk)
          continue
        }
        if ('error' in event) throw new Error(event.error)
        if ('cancelled' in event) throw new Error('Generation cancelled')
        const latest = current.current
        if (
          !latest.wandConfig.enabled ||
          latest.generationKey !== key ||
          latest.currentValue !== baseValue ||
          latest.getCurrentValue?.() !== baseDocumentValue
        )
          throw new Error('Document changed during generation; generated preview was discarded')
        if (latest.onGeneratedContent(event.result.text) === false)
          throw new Error('Document changed during generation; generated preview was discarded')
        if (start.wandConfig.maintainHistory) {
          const nextHistory: ChatMessage[] = [
            ...historyRef.current,
            { role: 'user', content: prompt },
            { role: 'assistant', content: event.result.text },
          ]
          historyRef.current = nextHistory
          setConversationHistory(nextHistory)
        }
        latest.onGenerationComplete?.(prompt, event.result.text)
        setPromptInputValue('')
        complete = true
        break
      }
      if (!complete) throw new Error('Native completion ended without a terminal outcome')
    } catch (failure) {
      if (id === generation.current && !abort.signal.aborted) {
        const message = failure instanceof Error ? failure.message : 'Generation failed'
        logger.error('Wand generation failed', { error: message })
        setError(message)
      }
    } finally {
      if (id === generation.current) {
        current.current.onGenerationEnd?.()
        setIsLoading(false)
        setIsStreaming(false)
        abortControllerRef.current = null
      }
    }
  }, [])
  useEffect(() => {
    cancelGeneration()
    historyRef.current = []
    setConversationHistory([])
  }, [props.generationKey, cancelGeneration])
  return {
    isLoading,
    isStreaming,
    isPromptVisible,
    promptInputValue,
    error,
    conversationHistory,
    generateStream,
    showPromptInline,
    hidePromptInline,
    openPrompt,
    closePrompt,
    updatePromptValue,
    cancelGeneration,
  }
}

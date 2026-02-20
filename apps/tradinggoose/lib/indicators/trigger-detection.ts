const TRIGGER_USAGE_PATTERN = /\btrigger\s*\(/

export const stripPineCommentsAndStrings = (source: string): string => {
  let result = ''
  let index = 0
  let mode:
    | 'normal'
    | 'line-comment'
    | 'block-comment'
    | 'single-quote'
    | 'double-quote'
    | 'template-string' = 'normal'

  while (index < source.length) {
    const char = source[index] ?? ''
    const nextChar = source[index + 1] ?? ''

    if (mode === 'line-comment') {
      if (char === '\n') {
        mode = 'normal'
        result += '\n'
      } else {
        result += ' '
      }
      index += 1
      continue
    }

    if (mode === 'block-comment') {
      if (char === '*' && nextChar === '/') {
        mode = 'normal'
        result += '  '
        index += 2
      } else {
        result += char === '\n' ? '\n' : ' '
        index += 1
      }
      continue
    }

    if (mode === 'single-quote' || mode === 'double-quote' || mode === 'template-string') {
      const quoteChar = mode === 'single-quote' ? "'" : mode === 'double-quote' ? '"' : '`'

      if (char === '\\') {
        result += ' '
        if (nextChar.length > 0) {
          result += nextChar === '\n' ? '\n' : ' '
          index += 2
        } else {
          index += 1
        }
        continue
      }

      if (char === quoteChar) {
        mode = 'normal'
        result += ' '
        index += 1
        continue
      }

      result += char === '\n' ? '\n' : ' '
      index += 1
      continue
    }

    if (char === '/' && nextChar === '/') {
      mode = 'line-comment'
      result += '  '
      index += 2
      continue
    }

    if (char === '/' && nextChar === '*') {
      mode = 'block-comment'
      result += '  '
      index += 2
      continue
    }

    if (char === "'") {
      mode = 'single-quote'
      result += ' '
      index += 1
      continue
    }

    if (char === '"') {
      mode = 'double-quote'
      result += ' '
      index += 1
      continue
    }

    if (char === '`') {
      mode = 'template-string'
      result += ' '
      index += 1
      continue
    }

    result += char
    index += 1
  }

  return result
}

export const detectTriggerUsage = (pineCode: string): boolean => {
  const normalized = stripPineCommentsAndStrings(pineCode)
  return TRIGGER_USAGE_PATTERN.test(normalized)
}

export const isIndicatorTriggerCapable = (pineCode: string): boolean => detectTriggerUsage(pineCode)

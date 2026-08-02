export interface EnhancedError {
  message: string
  line?: number
  column?: number
  stack?: string
  name: string
  originalError: any
  lineContent?: string
}

export const extractEnhancedError = (
  error: any,
  userCodeStartLine: number,
  userCode?: string
): EnhancedError => {
  const enhanced: EnhancedError = {
    message: error.message || 'Unknown error',
    name: error.name || 'Error',
    originalError: error,
  }

  if (error.stack) {
    enhanced.stack = error.stack
    const stackLines: string[] = error.stack.split('\n')

    for (const line of stackLines) {
      let match = line.match(/user-function\.js:(\d+)(?::(\d+))?/)

      if (!match) {
        match = line.match(/at\s+user-function\.js:(\d+):(\d+)/)
      }

      if (!match) {
        match = line.match(/user-function\.js:(\d+)(?::(\d+))?/)
      }

      if (match) {
        const stackLine = Number.parseInt(match[1], 10)
        const stackColumn = match[2] ? Number.parseInt(match[2], 10) : undefined
        const adjustedLine = stackLine - userCodeStartLine + 1

        const isWrapperSyntaxError =
          stackLine > userCodeStartLine &&
          error.name === 'SyntaxError' &&
          (error.message.includes('Unexpected token') ||
            error.message.includes('Unexpected end of input'))

        if (isWrapperSyntaxError && userCode) {
          const codeLines = userCode.split('\n')
          const lastUserLine = codeLines.length
          enhanced.line = lastUserLine
          enhanced.column = codeLines[lastUserLine - 1]?.length || 0
          enhanced.lineContent = codeLines[lastUserLine - 1]?.trim()
          break
        }

        if (adjustedLine > 0) {
          enhanced.line = adjustedLine
          enhanced.column = stackColumn

          if (userCode) {
            const codeLines = userCode.split('\n')
            if (adjustedLine <= codeLines.length) {
              enhanced.lineContent = codeLines[adjustedLine - 1]?.trim()
            }
          }
          break
        }

        if (stackLine <= userCodeStartLine) {
          enhanced.line = stackLine
          enhanced.column = stackColumn
          break
        }
      }
    }

    const cleanedStackLines: string[] = stackLines
      .filter(
        (line: string) =>
          line.includes('user-function.js') ||
          (!line.includes('vm.js') && !line.includes('internal/'))
      )
      .map((line: string) => line.replace(/\s+at\s+/, '    at '))

    if (cleanedStackLines.length > 0) {
      enhanced.stack = cleanedStackLines.join('\n')
    }
  }

  return enhanced
}

export const formatE2BError = (
  sandboxFailureText: string,
  userCode: string,
  prologueLineCount: number,
  wrapperLineCount = 3
): { formattedError: string; cleanedOutput: string } => {
  const totalOffset = prologueLineCount + wrapperLineCount

  let userLine: number | undefined
  let cleanErrorType = ''
  let cleanErrorMsg = ''

  const firstLineEnd = sandboxFailureText.indexOf('\n')
  const firstLine =
    firstLineEnd > 0 ? sandboxFailureText.substring(0, firstLineEnd) : sandboxFailureText

  const jsErrorMatch = firstLine.match(/^(\w+Error):\s*[^:]+:\s*([^(]+)\.\s*\((\d+):(\d+)\)/)
  if (jsErrorMatch) {
    cleanErrorType = jsErrorMatch[1]
    cleanErrorMsg = jsErrorMatch[2].trim()
    const originalLine = Number.parseInt(jsErrorMatch[3], 10)
    userLine = originalLine - totalOffset
  } else {
    const arrowMatch = sandboxFailureText.match(/^>\s*(\d+)\s*\|/m)
    if (arrowMatch) {
      const originalLine = Number.parseInt(arrowMatch[1], 10)
      userLine = originalLine - totalOffset
    }

    const errorMatch = firstLine.match(/^(\w+Error):\s*(.+)/)
    if (errorMatch) {
      cleanErrorType = errorMatch[1]
      cleanErrorMsg = errorMatch[2]
        .replace(/^[^:]+:\s*/, '')
        .replace(/\s*\(\d+:\d+\)\s*$/, '')
        .trim()
    } else {
      cleanErrorMsg = firstLine
    }
  }

  const finalErrorMsg =
    cleanErrorType && cleanErrorMsg
      ? `${cleanErrorType}: ${cleanErrorMsg}`
      : cleanErrorMsg || sandboxFailureText

  let formattedError = finalErrorMsg
  if (userLine && userLine > 0) {
    const codeLines = userCode.split('\n')
    const actualUserLine = Math.min(userLine, codeLines.length)
    if (actualUserLine > 0 && actualUserLine <= codeLines.length) {
      const lineContent = codeLines[actualUserLine - 1]?.trim()
      if (lineContent) {
        formattedError = `Line ${actualUserLine}: \`${lineContent}\` - ${finalErrorMsg}`
      } else {
        formattedError = `Line ${actualUserLine} - ${finalErrorMsg}`
      }
    }
  }

  return { formattedError, cleanedOutput: finalErrorMsg }
}

export const createUserFriendlyErrorMessage = (
  enhanced: EnhancedError,
  userCode?: string
): string => {
  let userFacingFailureText = enhanced.message

  if (enhanced.line !== undefined) {
    let lineInfo = `Line ${enhanced.line}${enhanced.column !== undefined ? `:${enhanced.column}` : ''}`

    if (enhanced.lineContent) {
      lineInfo += `: \`${enhanced.lineContent}\``
    }

    userFacingFailureText = `${lineInfo} - ${userFacingFailureText}`
  } else if (enhanced.stack) {
    const stackMatch = enhanced.stack.match(/user-function\.js:(\d+)(?::(\d+))?/)
    if (stackMatch) {
      const line = Number.parseInt(stackMatch[1], 10)
      const column = stackMatch[2] ? Number.parseInt(stackMatch[2], 10) : undefined
      let lineInfo = `Line ${line}${column ? `:${column}` : ''}`

      if (userCode) {
        const codeLines = userCode.split('\n')
        if (line <= codeLines.length) {
          const lineContent = codeLines[line - 1]?.trim()
          if (lineContent) {
            lineInfo += `: \`${lineContent}\``
          }
        }
      }

      userFacingFailureText = `${lineInfo} - ${userFacingFailureText}`
    }
  }

  if (enhanced.name !== 'Error') {
    const errorTypePrefix =
      enhanced.name === 'SyntaxError'
        ? 'Syntax Error'
        : enhanced.name === 'TypeError'
          ? 'Type Error'
          : enhanced.name === 'ReferenceError'
            ? 'Reference Error'
            : enhanced.name

    if (!userFacingFailureText.toLowerCase().includes(errorTypePrefix.toLowerCase())) {
      userFacingFailureText = `${errorTypePrefix}: ${userFacingFailureText}`
    }
  }

  if (enhanced.name === 'SyntaxError') {
    if (userFacingFailureText.includes('Invalid or unexpected token')) {
      userFacingFailureText += ' (Check for missing quotes, brackets, or semicolons)'
    } else if (userFacingFailureText.includes('Unexpected end of input')) {
      userFacingFailureText += ' (Check for missing closing brackets or braces)'
    } else if (userFacingFailureText.includes('Unexpected token')) {
      if (
        enhanced.lineContent &&
        ((enhanced.lineContent.includes('(') && !enhanced.lineContent.includes(')')) ||
          (enhanced.lineContent.includes('[') && !enhanced.lineContent.includes(']')) ||
          (enhanced.lineContent.includes('{') && !enhanced.lineContent.includes('}')))
      ) {
        userFacingFailureText += ' (Check for missing closing parentheses, brackets, or braces)'
      } else {
        userFacingFailureText += ' (Check your syntax)'
      }
    }
  }

  return userFacingFailureText
}

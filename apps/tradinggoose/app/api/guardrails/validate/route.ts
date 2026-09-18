import { type NextRequest, NextResponse } from 'next/server'
import {
  type HallucinationValidationResult,
  validateHallucination,
} from '@/lib/guardrails/validate_hallucination'
import { validateJson } from '@/lib/guardrails/validate_json'
import { type PIIValidationResult, validatePII } from '@/lib/guardrails/validate_pii'
import { validateRegex } from '@/lib/guardrails/validate_regex'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('GuardrailsValidateAPI')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Guardrails validation request received`)

  try {
    const body = await request.json()
    const {
      validationType,
      input,
      regex,
      knowledgeBaseId,
      threshold,
      topK,
      model,
      apiKey,
      workflowId,
      piiEntityTypes,
      piiMode,
      piiLanguage,
    } = body

    let error: string | undefined
    if (!validationType) error = 'Missing required field: validationType'
    else if (input === undefined || input === null) error = 'Input is missing or undefined'
    else if (!['json', 'regex', 'hallucination', 'pii'].includes(validationType)) {
      error = 'Invalid validationType. Must be "json", "regex", "hallucination", or "pii"'
    } else if (validationType === 'regex' && !regex) {
      error = 'Regex pattern is required for regex validation'
    } else if (validationType === 'hallucination' && !model) {
      error = 'Model is required for hallucination validation'
    }
    if (error) {
      return NextResponse.json({
        success: true,
        output: {
          passed: false,
          validationType: validationType || 'unknown',
          input: input || '',
          error,
        },
      })
    }

    const inputStr = typeof input === 'object' ? JSON.stringify(input) : String(input)

    logger.info(`[${requestId}] Executing validation locally`, {
      validationType,
      inputType: typeof input,
    })

    let validationResult: HallucinationValidationResult | PIIValidationResult
    switch (validationType) {
      case 'json':
        validationResult = validateJson(inputStr)
        break
      case 'regex':
        validationResult = validateRegex(inputStr, regex)
        break
      case 'hallucination':
        validationResult = knowledgeBaseId
          ? await validateHallucination({
              userInput: inputStr,
              knowledgeBaseId,
              threshold: threshold != null ? Number.parseFloat(threshold) : 3,
              topK: topK ? Number.parseInt(topK) : 10,
              model,
              apiKey,
              workflowId,
              requestId,
              authHeaders: request.headers,
            })
          : { passed: false, error: 'Knowledge base ID is required for hallucination check' }
        break
      default:
        validationResult = await validatePII({
          text: inputStr,
          entityTypes: piiEntityTypes || [],
          mode: piiMode || 'block',
          language: piiLanguage || 'en',
          requestId,
        })
    }

    logger.info(`[${requestId}] Validation completed`, {
      passed: validationResult.passed,
      hasError: !!validationResult.error,
    })

    return NextResponse.json({
      success: true,
      output: {
        ...validationResult,
        validationType,
        input,
      },
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Guardrails validation failed`, { error })
    return NextResponse.json({
      success: true,
      output: {
        passed: false,
        validationType: 'unknown',
        input: '',
        error: error.message || 'Validation failed due to unexpected error',
      },
    })
  }
}

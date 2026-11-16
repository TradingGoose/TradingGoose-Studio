import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import {
  type HallucinationValidationResult,
  validateHallucination,
} from '@/lib/guardrails/validate_hallucination'
import { validateJson } from '@/lib/guardrails/validate_json'
import { type PIIValidationResult, validatePII } from '@/lib/guardrails/validate_pii'
import { validateRegex } from '@/lib/guardrails/validate_regex'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'

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
      case 'hallucination': {
        const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
        if (!auth.success || !auth.userId) {
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }
        const access = knowledgeBaseId
          ? await checkKnowledgeBaseAccess(knowledgeBaseId, auth.userId)
          : undefined
        if (access && !access.hasAccess) {
          return NextResponse.json(
            { success: false, error: 'Knowledge base not found or access denied' },
            { status: 404 }
          )
        }
        let executionId: string | undefined
        if (workflowId !== undefined) {
          if (typeof workflowId !== 'string' || !workflowId.trim())
            return NextResponse.json(
              { success: false, error: 'Invalid workflowId' },
              { status: 400 }
            )
          const owner = await authorizeWorkflowScope(auth, workflowId, 'read')
          if (!owner.ok)
            return NextResponse.json(
              { success: false, error: owner.error },
              { status: owner.status }
            )
          if (access?.hasAccess && access.knowledgeBase.workspaceId !== owner.workspaceId)
            return NextResponse.json(
              { success: false, error: 'Workspace scope differs from the workflow' },
              { status: 403 }
            )
          executionId = owner.executionId
        }
        validationResult = knowledgeBaseId
          ? await validateHallucination({
              userInput: inputStr,
              knowledgeBaseId,
              threshold: threshold != null ? Number.parseFloat(threshold) : 3,
              topK: topK ? Number.parseInt(topK) : 10,
              model,
              apiKey,
              workflowId,
              executionId,
              requestId,
              authHeaders: request.headers,
              signal: request.signal,
              userId: auth.userId,
              workspaceId: access?.hasAccess ? access.knowledgeBase.workspaceId : auth.workspaceId,
            })
          : { passed: false, error: 'Knowledge base ID is required for hallucination check' }
        break
      }
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

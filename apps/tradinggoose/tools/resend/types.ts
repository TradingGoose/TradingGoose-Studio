import type { ToolResponse } from '@/tools/types'

export interface MailSendParams {
  resendApiKey: string
  fromAddress: string
  to: string
  subject: string
  body: string
  contentType?: string
}

export interface MailSendResult extends ToolResponse {
  output: {
    success: boolean
    to: string
    subject: string
    body: string
  }
}

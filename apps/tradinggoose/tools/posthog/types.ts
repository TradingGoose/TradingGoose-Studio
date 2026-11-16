// Common types for PostHog tools
import type { ToolResponse } from '@/tools/types'

// Common data types
export interface PostHogPerson {
  id: string
  name: string
  distinct_ids: string[]
  properties: Record<string, any>
  created_at: string
  uuid: string
}

export interface PostHogSurvey {
  id: string
  name: string
  description: string
  type: 'popover' | 'api'
  questions: any[]
  appearance?: Record<string, any>
  conditions?: Record<string, any>
  start_date?: string
  end_date?: string
  archived: boolean
  created_at: string
  created_by: any
}

export interface PostHogSessionRecording {
  id: string
  distinct_id: string
  viewed: boolean
  recording_duration: number
  start_time: string
  end_time: string
  click_count: number
  keypress_count: number
  console_error_count: number
  console_warn_count: number
  console_log_count: number
  person?: PostHogPerson
}

export interface PostHogProject {
  id: number
  uuid: string
  organization: string
  api_token: string
  app_urls: string[]
  name: string
  slack_incoming_webhook?: string
  created_at: string
  updated_at: string
  anonymize_ips: boolean
  completed_snippet_onboarding: boolean
  ingested_event: boolean
  test_account_filters: any[]
  is_demo: boolean
}

export interface PostHogOrganization {
  id: string
  name: string
  created_at: string
  updated_at: string
  membership_level?: number
  personalization?: Record<string, any>
  setup?: Record<string, any>
  available_features: string[]
  is_member_join_email_enabled: boolean
}

// Union type for all PostHog responses
export type PostHogResponse = ToolResponse

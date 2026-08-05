import { db } from '@tradinggoose/db'
import { pendingExecution, webhook } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getOAuthAccessTokenForStoredCredential } from '@/lib/credentials/oauth'
import { createLogger } from '@/lib/logs/console/logger'
import { isMonitorProvider } from '@/lib/monitors/sources'
import { getWebhookRevision, WebhookRevisionConflictError } from '@/lib/webhooks/webhook-helpers'

const logger = createLogger('WebhookUtils')

/**
 * Handle WhatsApp verification requests
 */
export async function handleWhatsAppVerification(
  requestId: string,
  path: string,
  mode: string | null,
  token: string | null,
  challenge: string | null
): Promise<NextResponse | null> {
  if (mode && token && challenge) {
    // This is a WhatsApp verification request
    logger.info(`[${requestId}] WhatsApp verification request received for path: ${path}`)

    if (mode !== 'subscribe') {
      logger.warn(`[${requestId}] Invalid WhatsApp verification mode: ${mode}`)
      return new NextResponse('Invalid mode', { status: 400 })
    }

    // Find all active WhatsApp webhooks
    const webhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.provider, 'whatsapp'), eq(webhook.isActive, true)))

    // Check if any webhook has a matching verification token
    for (const wh of webhooks) {
      const providerConfig = (wh.providerConfig as Record<string, any>) || {}
      const verificationToken = providerConfig.verificationToken

      if (!verificationToken) {
        logger.debug(`[${requestId}] Webhook ${wh.id} has no verification token, skipping`)
        continue
      }

      if (token === verificationToken) {
        logger.info(`[${requestId}] WhatsApp verification successful for webhook ${wh.id}`)
        // Return ONLY the challenge as plain text (exactly as WhatsApp expects)
        return new NextResponse(challenge, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      }
    }

    logger.warn(`[${requestId}] No matching WhatsApp verification token found`)
    return new NextResponse('Verification failed', { status: 403 })
  }

  return null
}

/**
 * Handle Slack verification challenges
 */
export function handleSlackChallenge(body: any): NextResponse | null {
  if (body.type === 'url_verification' && body.challenge) {
    return NextResponse.json({ challenge: body.challenge })
  }

  return null
}

/**
 * Format Microsoft Teams Graph change notification
 */
async function formatTeamsGraphNotification(
  body: any,
  foundWebhook: any,
  foundWorkflow: any,
  request: NextRequest
): Promise<any> {
  const notification = body.value[0]
  const changeType = notification.changeType || 'created'
  const resource = notification.resource || ''
  const subscriptionId = notification.subscriptionId || ''

  // Extract chatId and messageId from resource path
  let chatId: string | null = null
  let messageId: string | null = null

  const fullMatch = resource.match(/chats\/([^/]+)\/messages\/([^/]+)/)
  if (fullMatch) {
    chatId = fullMatch[1]
    messageId = fullMatch[2]
  }

  if (!chatId || !messageId) {
    const quotedMatch = resource.match(/chats\('([^']+)'\)\/messages\('([^']+)'\)/)
    if (quotedMatch) {
      chatId = quotedMatch[1]
      messageId = quotedMatch[2]
    }
  }

  if (!chatId || !messageId) {
    const collectionMatch = resource.match(/chats\/([^/]+)\/messages$/)
    const rdId = body?.value?.[0]?.resourceData?.id
    if (collectionMatch && rdId) {
      chatId = collectionMatch[1]
      messageId = rdId
    }
  }

  if ((!chatId || !messageId) && body?.value?.[0]?.resourceData?.['@odata.id']) {
    const odataId = String(body.value[0].resourceData['@odata.id'])
    const odataMatch = odataId.match(/chats\('([^']+)'\)\/messages\('([^']+)'\)/)
    if (odataMatch) {
      chatId = odataMatch[1]
      messageId = odataMatch[2]
    }
  }

  if (!chatId || !messageId) {
    logger.warn('Could not resolve chatId/messageId from Teams notification', {
      resource,
      hasResourceDataId: Boolean(body?.value?.[0]?.resourceData?.id),
      valueLength: Array.isArray(body?.value) ? body.value.length : 0,
      keys: Object.keys(body || {}),
    })
    return {
      input: 'Teams notification received',
      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook?.path || '',
          providerConfig: foundWebhook?.providerConfig || {},
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }
  const resolvedChatId = chatId as string
  const resolvedMessageId = messageId as string
  const providerConfig = (foundWebhook?.providerConfig as Record<string, any>) || {}
  const credentialId = providerConfig.credentialId
  const includeAttachments = providerConfig.includeAttachments !== false

  let message: any = null
  const rawAttachments: Array<{
    name: string
    data: Buffer
    contentType: string
    size: number
  }> = []
  let accessToken: string | null = null

  // Teams chat subscriptions require credentials
  if (!credentialId) {
    logger.error('Missing credentialId for Teams chat subscription', {
      chatId: resolvedChatId,
      messageId: resolvedMessageId,
      webhookId: foundWebhook?.id,
      blockId: foundWebhook?.blockId,
      providerConfig,
    })
  } else {
    try {
      accessToken = await getOAuthAccessTokenForStoredCredential({
        credentialId,
        workspaceId: foundWorkflow.workspaceId,
        requestId: 'teams-graph-notification',
      })

      if (accessToken) {
        const msgUrl = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(resolvedChatId)}/messages/${encodeURIComponent(resolvedMessageId)}`
        const res = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (res.ok) {
          message = await res.json()

          if (includeAttachments && message?.attachments?.length > 0) {
            const attachments = Array.isArray(message?.attachments) ? message.attachments : []
            for (const att of attachments) {
              try {
                const contentUrl =
                  typeof att?.contentUrl === 'string' ? (att.contentUrl as string) : undefined
                const contentTypeHint =
                  typeof att?.contentType === 'string' ? (att.contentType as string) : undefined
                let attachmentName = (att?.name as string) || 'teams-attachment'

                if (!contentUrl) continue

                let buffer: Buffer | null = null
                let mimeType = 'application/octet-stream'

                if (contentUrl.includes('sharepoint.com') || contentUrl.includes('onedrive')) {
                  try {
                    const directRes = await fetch(contentUrl, {
                      headers: { Authorization: `Bearer ${accessToken}` },
                      redirect: 'follow',
                    })

                    if (directRes.ok) {
                      const arrayBuffer = await directRes.arrayBuffer()
                      buffer = Buffer.from(arrayBuffer)
                      mimeType =
                        directRes.headers.get('content-type') ||
                        contentTypeHint ||
                        'application/octet-stream'
                    } else {
                      const encodedUrl = Buffer.from(contentUrl)
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')

                      const graphUrl = `https://graph.microsoft.com/v1.0/shares/u!${encodedUrl}/driveItem/content`
                      const graphRes = await fetch(graphUrl, {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        redirect: 'follow',
                      })

                      if (graphRes.ok) {
                        const arrayBuffer = await graphRes.arrayBuffer()
                        buffer = Buffer.from(arrayBuffer)
                        mimeType =
                          graphRes.headers.get('content-type') ||
                          contentTypeHint ||
                          'application/octet-stream'
                      } else {
                        continue
                      }
                    }
                  } catch {
                    continue
                  }
                } else if (
                  contentUrl.includes('1drv.ms') ||
                  contentUrl.includes('onedrive.live.com') ||
                  contentUrl.includes('onedrive.com') ||
                  contentUrl.includes('my.microsoftpersonalcontent.com')
                ) {
                  try {
                    let shareToken: string | null = null

                    if (contentUrl.includes('1drv.ms')) {
                      const urlParts = contentUrl.split('/').pop()
                      if (urlParts) shareToken = urlParts
                    } else if (contentUrl.includes('resid=')) {
                      const urlParams = new URL(contentUrl).searchParams
                      const resId = urlParams.get('resid')
                      if (resId) shareToken = resId
                    }

                    if (!shareToken) {
                      const base64Url = Buffer.from(contentUrl, 'utf-8')
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')
                      shareToken = `u!${base64Url}`
                    } else if (!shareToken.startsWith('u!')) {
                      const base64Url = Buffer.from(shareToken, 'utf-8')
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')
                      shareToken = `u!${base64Url}`
                    }

                    const metadataUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem`
                    const metadataRes = await fetch(metadataUrl, {
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: 'application/json',
                      },
                    })

                    if (!metadataRes.ok) {
                      const directUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem/content`
                      const directRes = await fetch(directUrl, {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        redirect: 'follow',
                      })

                      if (directRes.ok) {
                        const arrayBuffer = await directRes.arrayBuffer()
                        buffer = Buffer.from(arrayBuffer)
                        mimeType =
                          directRes.headers.get('content-type') ||
                          contentTypeHint ||
                          'application/octet-stream'
                      } else {
                        continue
                      }
                    } else {
                      const metadata = await metadataRes.json()
                      const downloadUrl = metadata['@microsoft.graph.downloadUrl']

                      if (downloadUrl) {
                        const downloadRes = await fetch(downloadUrl)

                        if (downloadRes.ok) {
                          const arrayBuffer = await downloadRes.arrayBuffer()
                          buffer = Buffer.from(arrayBuffer)
                          mimeType =
                            downloadRes.headers.get('content-type') ||
                            metadata.file?.mimeType ||
                            contentTypeHint ||
                            'application/octet-stream'

                          if (metadata.name && metadata.name !== attachmentName) {
                            attachmentName = metadata.name
                          }
                        } else {
                          continue
                        }
                      } else {
                        continue
                      }
                    }
                  } catch {
                    continue
                  }
                } else {
                  try {
                    const ares = await fetch(contentUrl, {
                      headers: { Authorization: `Bearer ${accessToken}` },
                    })
                    if (ares.ok) {
                      const arrayBuffer = await ares.arrayBuffer()
                      buffer = Buffer.from(arrayBuffer)
                      mimeType =
                        ares.headers.get('content-type') ||
                        contentTypeHint ||
                        'application/octet-stream'
                    }
                  } catch {
                    continue
                  }
                }

                if (!buffer) continue

                const size = buffer.length

                // Store raw attachment (will be uploaded to execution storage later)
                rawAttachments.push({
                  name: attachmentName,
                  data: buffer,
                  contentType: mimeType,
                  size,
                })
              } catch {}
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to fetch Teams message', {
        error,
        chatId: resolvedChatId,
        messageId: resolvedMessageId,
      })
    }
  }

  // If no message was fetched, return minimal data
  if (!message) {
    logger.warn('No message data available for Teams notification', {
      chatId: resolvedChatId,
      messageId: resolvedMessageId,
      hasCredential: !!credentialId,
    })
    return {
      input: '',
      message_id: messageId,
      chat_id: chatId,
      from_name: 'Unknown',
      text: '',
      created_at: notification.resourceData?.createdDateTime || '',
      change_type: changeType,
      subscription_id: subscriptionId,
      attachments: [],
      microsoftteams: {
        message: { id: messageId, text: '', timestamp: '', chatId, raw: null },
        from: { id: '', name: 'Unknown', aadObjectId: '' },
        notification: { changeType, subscriptionId, resource },
      },
      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook?.path || '',
          providerConfig: foundWebhook?.providerConfig || {},
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  // Extract data from message - we know it exists now
  // body.content is the HTML/text content, summary is a plain text preview (max 280 chars)
  const messageText = message.body?.content || ''
  const from = message.from?.user || {}
  const createdAt = message.createdDateTime || ''

  return {
    input: messageText,
    message_id: messageId,
    chat_id: chatId,
    from_name: from.displayName || 'Unknown',
    text: messageText,
    created_at: createdAt,
    change_type: changeType,
    subscription_id: subscriptionId,
    attachments: rawAttachments,
    microsoftteams: {
      message: {
        id: messageId,
        text: messageText,
        timestamp: createdAt,
        chatId,
        raw: message,
      },
      from: {
        id: from.id,
        name: from.displayName,
        aadObjectId: from.aadObjectId,
      },
      notification: {
        changeType,
        subscriptionId,
        resource,
      },
    },
    webhook: {
      data: {
        provider: 'microsoftteams',
        path: foundWebhook?.path || '',
        providerConfig: foundWebhook?.providerConfig || {},
        payload: body,
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
      },
    },
    workflowId: foundWorkflow.id,
  }
}

/**
 * Format webhook input based on provider
 */
export async function formatWebhookInput(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest,
  requestId: string,
  pendingExecutionId: string
): Promise<any> {
  if (isMonitorProvider(foundWebhook.provider)) {
    return body
  }

  if (foundWebhook.provider === 'airtable') {
    return formatAirtableWebhookInput(foundWebhook, foundWorkflow, requestId, pendingExecutionId)
  }

  if (foundWebhook.provider === 'whatsapp') {
    const data = body?.entry?.[0]?.changes?.[0]?.value
    const messages = data?.messages || []

    if (messages.length > 0) {
      const message = messages[0]
      const phoneNumberId = data.metadata?.phone_number_id
      const from = message.from
      const messageId = message.id
      const timestamp = message.timestamp
      const text = message.text?.body

      return {
        whatsapp: {
          data: {
            messageId,
            from,
            phoneNumberId,
            text,
            timestamp,
            raw: message,
          },
        },
        webhook: {
          data: {
            provider: 'whatsapp',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }
    return null
  }

  if (foundWebhook.provider === 'telegram') {
    const message =
      body?.message || body?.edited_message || body?.channel_post || body?.edited_channel_post

    if (message) {
      let input = ''

      if (message.text) {
        input = message.text
      } else if (message.caption) {
        input = message.caption
      } else if (message.photo) {
        input = 'Photo message'
      } else if (message.document) {
        input = `Document: ${message.document.file_name || 'file'}`
      } else if (message.audio) {
        input = `Audio: ${message.audio.title || 'audio file'}`
      } else if (message.video) {
        input = 'Video message'
      } else if (message.voice) {
        input = 'Voice message'
      } else if (message.sticker) {
        input = `Sticker: ${message.sticker.emoji || '🎭'}`
      } else if (message.location) {
        input = 'Location shared'
      } else if (message.contact) {
        input = `Contact: ${message.contact.first_name || 'contact'}`
      } else if (message.poll) {
        input = `Poll: ${message.poll.question}`
      } else {
        input = 'Message received'
      }

      const messageObj = {
        id: message.message_id,
        text: message.text,
        caption: message.caption,
        date: message.date,
        messageType: message.photo
          ? 'photo'
          : message.document
            ? 'document'
            : message.audio
              ? 'audio'
              : message.video
                ? 'video'
                : message.voice
                  ? 'voice'
                  : message.sticker
                    ? 'sticker'
                    : message.location
                      ? 'location'
                      : message.contact
                        ? 'contact'
                        : message.poll
                          ? 'poll'
                          : 'text',
        raw: message,
      }

      const senderObj = message.from
        ? {
            id: message.from.id,
            firstName: message.from.first_name,
            lastName: message.from.last_name,
            username: message.from.username,
            languageCode: message.from.language_code,
            isBot: message.from.is_bot,
          }
        : null

      const chatObj = message.chat
        ? {
            id: message.chat.id,
            type: message.chat.type,
            title: message.chat.title,
            username: message.chat.username,
            firstName: message.chat.first_name,
            lastName: message.chat.last_name,
          }
        : null

      return {
        input,

        // Top-level properties for backward compatibility with <blockName.message> syntax
        message: messageObj,
        sender: senderObj,
        chat: chatObj,
        updateId: body.update_id,
        updateType: body.message
          ? 'message'
          : body.edited_message
            ? 'edited_message'
            : body.channel_post
              ? 'channel_post'
              : body.edited_channel_post
                ? 'edited_channel_post'
                : 'unknown',

        // Keep the nested structure for the new telegram.message.text syntax
        telegram: {
          message: messageObj,
          sender: senderObj,
          chat: chatObj,
          updateId: body.update_id,
          updateType: body.message
            ? 'message'
            : body.edited_message
              ? 'edited_message'
              : body.channel_post
                ? 'channel_post'
                : body.edited_channel_post
                  ? 'edited_channel_post'
                  : 'unknown',
        },
        webhook: {
          data: {
            provider: 'telegram',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }

    // Fallback for unknown Telegram update types
    logger.warn('Unknown Telegram update type', {
      updateId: body.update_id,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      input: 'Telegram update received',
      telegram: {
        updateId: body.update_id,
        updateType: 'unknown',
        raw: body,
      },
      webhook: {
        data: {
          provider: 'telegram',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'gmail') {
    if (body && typeof body === 'object' && 'email' in body) {
      return body // { email: {...}, timestamp: ... }
    }
    return body
  }

  if (foundWebhook.provider === 'outlook') {
    if (body && typeof body === 'object' && 'email' in body) {
      return body // { email: {...}, timestamp: ... }
    }
    return body
  }

  if (foundWebhook.provider === 'microsoftteams') {
    // Check if this is a Microsoft Graph change notification
    if (body?.value && Array.isArray(body.value) && body.value.length > 0) {
      return await formatTeamsGraphNotification(body, foundWebhook, foundWorkflow, request)
    }

    // Microsoft Teams outgoing webhook - Teams sending data to us
    const messageText = body?.text || ''
    const messageId = body?.id || ''
    const timestamp = body?.timestamp || body?.localTimestamp || ''
    const from = body?.from || {}
    const conversation = body?.conversation || {}

    // Construct the message object
    const messageObj = {
      raw: {
        attachments: body?.attachments || [],
        channelData: body?.channelData || {},
        conversation: body?.conversation || {},
        text: messageText,
        messageType: body?.type || 'message',
        channelId: body?.channelId || '',
        timestamp,
      },
    }

    // Construct the from object
    const fromObj = {
      id: from.id || '',
      name: from.name || '',
      aadObjectId: from.aadObjectId || '',
    }

    // Construct the conversation object
    const conversationObj = {
      id: conversation.id || '',
      name: conversation.name || '',
      isGroup: conversation.isGroup || false,
      tenantId: conversation.tenantId || '',
      aadObjectId: conversation.aadObjectId || '',
      conversationType: conversation.conversationType || '',
    }

    // Construct the activity object
    const activityObj = body || {}

    return {
      input: messageText, // Primary workflow input - the message text

      // Top-level properties for direct access with <microsoftteams.from.name> syntax
      from: fromObj,
      message: messageObj,
      activity: activityObj,
      conversation: conversationObj,

      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'slack') {
    // Slack input formatting logic - check for valid event
    const event = body?.event

    if (event && body?.type === 'event_callback') {
      // Extract event text with fallbacks for different event types
      let input = ''

      if (event.text) {
        input = event.text
      } else if (event.type === 'app_mention') {
        input = 'App mention received'
      } else {
        input = 'Slack event received'
      }

      // Create the event object for easier access
      const eventObj = {
        event_type: event.type || '',
        channel: event.channel || '',
        channel_name: '', // Could be resolved via additional API calls if needed
        user: event.user || '',
        user_name: '', // Could be resolved via additional API calls if needed
        text: event.text || '',
        timestamp: event.ts || event.event_ts || '',
        team_id: body.team_id || event.team || '',
        event_id: body.event_id || '',
      }

      return {
        input, // Primary workflow input - the event content

        // // // Top-level properties for backward compatibility with <blockName.event> syntax
        event: eventObj,

        // Keep the nested structure for the new slack.event.text syntax
        slack: {
          event: eventObj,
        },
        webhook: {
          data: {
            provider: 'slack',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }

    // Fallback for unknown Slack event types
    logger.warn('Unknown Slack event type', {
      type: body?.type,
      hasEvent: !!body?.event,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      input: 'Slack webhook received',
      slack: {
        event: {
          event_type: body?.event?.type || body?.type || 'unknown',
          channel: body?.event?.channel || '',
          user: body?.event?.user || '',
          text: body?.event?.text || '',
          timestamp: body?.event?.ts || '',
          team_id: body?.team_id || '',
          event_id: body?.event_id || '',
        },
      },
      webhook: {
        data: {
          provider: 'slack',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'webflow') {
    const triggerType = body?.triggerType || 'unknown'
    const siteId = body?.siteId || ''
    const workspaceId = body?.workspaceId || ''
    const collectionId = body?.collectionId || ''
    const payload = body?.payload || {}
    const formId = body?.formId || ''
    const formName = body?.name || ''
    const formSubmissionId = body?.id || ''
    const submittedAt = body?.submittedAt || ''
    const formData = body?.data || {}
    const schema = body?.schema || {}

    return {
      siteId,
      workspaceId,
      collectionId,
      payload,
      triggerType,

      formId,
      name: formName,
      id: formSubmissionId,
      submittedAt,
      data: formData,
      schema,
      formElementId: body?.formElementId || '',

      webflow: {
        siteId,
        workspaceId,
        collectionId,
        payload,
        triggerType,
        raw: body,
      },

      webhook: {
        data: {
          provider: 'webflow',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'generic') {
    return body
  }

  if (foundWebhook.provider === 'google_forms') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    // Normalize answers: if value is an array with single element, collapse to scalar; keep multi-select arrays
    const normalizeAnswers = (src: unknown): Record<string, unknown> => {
      if (!src || typeof src !== 'object') return {}
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          out[k] = v.length === 1 ? v[0] : v
        } else {
          out[k] = v as unknown
        }
      }
      return out
    }

    const responseId = body?.responseId || body?.id || ''
    const createTime = body?.createTime || body?.timestamp || new Date().toISOString()
    const lastSubmittedTime = body?.lastSubmittedTime || createTime
    const formId = body?.formId || providerConfig.formId || ''
    const includeRaw = providerConfig.includeRawPayload !== false

    const normalizedAnswers = normalizeAnswers(body?.answers)

    const summaryCount = Object.keys(normalizedAnswers).length
    const input = `Google Form response${responseId ? ` ${responseId}` : ''} (${summaryCount} answers)`

    return {
      input,
      responseId,
      createTime,
      lastSubmittedTime,
      formId,
      answers: normalizedAnswers,
      ...(includeRaw ? { raw: body?.raw ?? body } : {}),
      google_forms: {
        responseId,
        createTime,
        lastSubmittedTime,
        formId,
        answers: normalizedAnswers,
        ...(includeRaw ? { raw: body?.raw ?? body } : {}),
      },
      webhook: {
        data: {
          provider: 'google_forms',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: includeRaw ? body : undefined,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'github') {
    // GitHub webhook input formatting logic
    const eventType = request.headers.get('x-github-event') || 'unknown'
    const delivery = request.headers.get('x-github-delivery') || ''

    // Extract common GitHub properties
    const repository = body?.repository || {}
    const sender = body?.sender || {}
    const action = body?.action || ''

    // Build GitHub-specific variables based on the trigger config outputs
    const githubData = {
      // Event metadata
      event_type: eventType,
      action: action,
      delivery_id: delivery,

      // Repository information (avoid 'repository' to prevent conflict with the object)
      repository_full_name: repository.full_name || '',
      repository_name: repository.name || '',
      repository_owner: repository.owner?.login || '',
      repository_id: repository.id || '',
      repository_url: repository.html_url || '',

      // Sender information (avoid 'sender' to prevent conflict with the object)
      sender_login: sender.login || '',
      sender_id: sender.id || '',
      sender_type: sender.type || '',
      sender_url: sender.html_url || '',

      // Event-specific data
      ...(body?.ref && {
        ref: body.ref,
        branch: body.ref?.replace('refs/heads/', '') || '',
      }),
      ...(body?.before && { before: body.before }),
      ...(body?.after && { after: body.after }),
      ...(body?.commits && {
        commits: JSON.stringify(body.commits),
        commit_count: body.commits.length || 0,
      }),
      ...(body?.head_commit && {
        commit_message: body.head_commit.message || '',
        commit_author: body.head_commit.author?.name || '',
        commit_sha: body.head_commit.id || '',
        commit_url: body.head_commit.url || '',
      }),
      ...(body?.pull_request && {
        pull_request: JSON.stringify(body.pull_request),
        pr_number: body.pull_request.number || '',
        pr_title: body.pull_request.title || '',
        pr_state: body.pull_request.state || '',
        pr_url: body.pull_request.html_url || '',
      }),
      ...(body?.issue && {
        issue: JSON.stringify(body.issue),
        issue_number: body.issue.number || '',
        issue_title: body.issue.title || '',
        issue_state: body.issue.state || '',
        issue_url: body.issue.html_url || '',
      }),
      ...(body?.comment && {
        comment: JSON.stringify(body.comment),
        comment_body: body.comment.body || '',
        comment_url: body.comment.html_url || '',
      }),
    }

    // Set input based on event type for workflow processing
    let input = ''
    switch (eventType) {
      case 'push':
        input = `Push to ${githubData.branch || githubData.ref}: ${githubData.commit_message || 'No commit message'}`
        break
      case 'pull_request':
        input = `${action} pull request: ${githubData.pr_title || 'No title'}`
        break
      case 'issues':
        input = `${action} issue: ${githubData.issue_title || 'No title'}`
        break
      case 'issue_comment':
      case 'pull_request_review_comment':
        input = `Comment ${action}: ${githubData.comment_body?.slice(0, 100) || 'No comment body'}${(githubData.comment_body?.length || 0) > 100 ? '...' : ''}`
        break
      default:
        input = `GitHub ${eventType} event${action ? ` (${action})` : ''}`
    }

    return {
      // Expose raw GitHub payload at the root
      ...body,
      // Include webhook metadata alongside
      webhook: {
        data: {
          provider: 'github',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  // Generic format for other providers
  return {
    webhook: {
      data: {
        path: foundWebhook.path,
        provider: foundWebhook.provider,
        providerConfig: foundWebhook.providerConfig,
        payload: body,
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
      },
    },
    workflowId: foundWorkflow.id,
  }
}

/**
 * Validates a Microsoft Teams outgoing webhook request signature using HMAC SHA-256
 * @param hmacSecret - Microsoft Teams HMAC secret (base64 encoded)
 * @param signature - Authorization header value (should start with 'HMAC ')
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateMicrosoftTeamsSignature(
  hmacSecret: string,
  signature: string,
  body: string
): boolean {
  try {
    // Basic validation first
    if (!hmacSecret || !signature || !body) {
      return false
    }

    // Check if signature has correct format
    if (!signature.startsWith('HMAC ')) {
      return false
    }

    const providedSignature = signature.substring(5) // Remove 'HMAC ' prefix

    // Compute HMAC SHA256 signature using Node.js crypto
    const crypto = require('crypto')
    const secretBytes = Buffer.from(hmacSecret, 'base64')
    const bodyBytes = Buffer.from(body, 'utf8')
    const computedHash = crypto.createHmac('sha256', secretBytes).update(bodyBytes).digest('base64')

    // Constant-time comparison to prevent timing attacks
    if (computedHash.length !== providedSignature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash.charCodeAt(i) ^ providedSignature.charCodeAt(i)
    }

    return result === 0
  } catch (error) {
    logger.error('Error validating Microsoft Teams signature:', error)
    return false
  }
}

/**
 * Process webhook provider-specific verification
 */
export function verifyProviderWebhook(
  foundWebhook: any,
  request: NextRequest,
  requestId: string
): NextResponse | null {
  const authHeader = request.headers.get('authorization')
  const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
  switch (foundWebhook.provider) {
    case 'github':
      break
    case 'stripe':
      break
    case 'gmail':
      if (providerConfig.secret) {
        const secretHeader = request.headers.get('X-Webhook-Secret')
        if (!secretHeader || secretHeader.length !== providerConfig.secret.length) {
          logger.warn(`[${requestId}] Invalid Gmail webhook secret`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
        let result = 0
        for (let i = 0; i < secretHeader.length; i++) {
          result |= secretHeader.charCodeAt(i) ^ providerConfig.secret.charCodeAt(i)
        }
        if (result !== 0) {
          logger.warn(`[${requestId}] Invalid Gmail webhook secret`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
      }
      break
    case 'telegram': {
      // Check User-Agent to ensure it's not blocked by middleware
      const userAgent = request.headers.get('user-agent') || ''
      logger.debug(`[${requestId}] Telegram webhook request received with User-Agent: ${userAgent}`)

      if (!userAgent) {
        logger.warn(
          `[${requestId}] Telegram webhook request has empty User-Agent header. This may be blocked by middleware.`
        )
      }

      // Telegram uses IP addresses in specific ranges
      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'

      logger.debug(`[${requestId}] Telegram webhook request from IP: ${clientIp}`)

      break
    }
    case 'microsoftteams':
      break
    case 'generic':
      if (providerConfig.requireAuth) {
        let isAuthenticated = false
        if (providerConfig.token) {
          const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
          if (providedToken === providerConfig.token) {
            isAuthenticated = true
          }
          if (!isAuthenticated && providerConfig.secretHeaderName) {
            const customHeaderValue = request.headers.get(providerConfig.secretHeaderName)
            if (customHeaderValue === providerConfig.token) {
              isAuthenticated = true
            }
          }
          if (!isAuthenticated) {
            logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
            return new NextResponse('Unauthorized', { status: 401 })
          }
        }
      }
      if (
        providerConfig.allowedIps &&
        Array.isArray(providerConfig.allowedIps) &&
        providerConfig.allowedIps.length > 0
      ) {
        const clientIp =
          request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
          request.headers.get('x-real-ip') ||
          'unknown'

        if (clientIp === 'unknown' || !providerConfig.allowedIps.includes(clientIp)) {
          logger.warn(
            `[${requestId}] Forbidden webhook access attempt - IP not allowed: ${clientIp}`
          )
          return new NextResponse('Forbidden - IP not allowed', {
            status: 403,
          })
        }
      }
      break
    default:
      if (providerConfig.token) {
        const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
        if (!providedToken || providedToken !== providerConfig.token) {
          logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
      }
  }

  return null
}

const AIRTABLE_POLL_STAGE_KEY = 'airtablePollStage'
const AIRTABLE_POLL_PAGE_LIMIT = 10
const AIRTABLE_POLL_RETRY_DELAYS_MS = [1_000, 30_000] as const

type AirtablePollStage = {
  externalId: string
  apiCallCount: number
  payloads: unknown[]
  cursor: number | null
  mightHaveMore: boolean
}

export type AirtablePollResult = {
  input: Record<string, unknown> | undefined
  continuation: { externalId: string; cursor: number } | null
}

export class AirtableStageIntegrityError extends Error {}

async function retryAirtablePoll<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= AIRTABLE_POLL_RETRY_DELAYS_MS.length) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, AIRTABLE_POLL_RETRY_DELAYS_MS[attempt]))
    }
  }
}

export const getAirtableContinuationExecutionId = (
  webhookId: string,
  continuation: NonNullable<AirtablePollResult['continuation']>
) => `webhook_execution:${webhookId}:airtable:${continuation.externalId}:${continuation.cursor}`

const toJsonRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}

function parseAirtablePollStage(value: unknown): AirtablePollStage | null {
  const stage = toJsonRecord(value)
  if (!Object.keys(stage).length) return null
  if (
    typeof stage.externalId !== 'string' ||
    !stage.externalId ||
    !Number.isInteger(stage.apiCallCount) ||
    stage.apiCallCount < 0 ||
    stage.apiCallCount > AIRTABLE_POLL_PAGE_LIMIT ||
    !Array.isArray(stage.payloads) ||
    (stage.cursor !== null && !Number.isInteger(stage.cursor)) ||
    typeof stage.mightHaveMore !== 'boolean'
  ) {
    throw new AirtableStageIntegrityError('Invalid durable Airtable poll stage')
  }
  return stage as AirtablePollStage
}

function getAirtablePollStage(payload: unknown) {
  return parseAirtablePollStage(toJsonRecord(payload)[AIRTABLE_POLL_STAGE_KEY])
}

function getStageContinuation(stage: AirtablePollStage | null): AirtablePollResult['continuation'] {
  return stage?.mightHaveMore && Number.isInteger(stage.cursor)
    ? { externalId: stage.externalId, cursor: stage.cursor as number }
    : null
}

export function getAirtablePollContinuation(executionPayload: unknown) {
  return getStageContinuation(getAirtablePollStage(executionPayload))
}

function assertAirtablePendingExecution(payload: unknown, webhookId: string, externalId: string) {
  const executionPayload = toJsonRecord(payload)
  if (executionPayload.webhookId !== webhookId || executionPayload.provider !== 'airtable') {
    throw new AirtableStageIntegrityError('Airtable poll does not own this pending execution')
  }
  const stage = getAirtablePollStage(executionPayload)
  if (stage && stage.externalId !== externalId) {
    throw new AirtableStageIntegrityError('Airtable poll stage belongs to a different subscription')
  }
  return { executionPayload, stage }
}

async function readAirtablePollStage(
  pendingExecutionId: string,
  webhookId: string,
  externalId: string
) {
  const [row] = await db
    .select({ payload: pendingExecution.payload })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, pendingExecutionId),
        eq(pendingExecution.executionType, 'webhook'),
        eq(pendingExecution.status, 'processing')
      )
    )
    .limit(1)
  if (!row) throw new AirtableStageIntegrityError('Airtable pending execution is not processing')
  return assertAirtablePendingExecution(row.payload, webhookId, externalId).stage
}

async function commitAirtablePollPage(params: {
  pendingExecutionId: string
  webhookId: string
  externalId: string
  currentCursor: number | null
  nextCursor: number
  receivedPayloads: unknown[]
  mightHaveMore: boolean
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ payload: pendingExecution.payload })
      .from(pendingExecution)
      .where(
        and(
          eq(pendingExecution.id, params.pendingExecutionId),
          eq(pendingExecution.executionType, 'webhook'),
          eq(pendingExecution.status, 'processing')
        )
      )
      .for('update')
      .limit(1)
    if (!row)
      throw new AirtableStageIntegrityError('Airtable pending execution lost processing ownership')

    const { executionPayload, stage: durableStage } = assertAirtablePendingExecution(
      row.payload,
      params.webhookId,
      params.externalId
    )
    const stage =
      durableStage ??
      ({
        externalId: params.externalId,
        apiCallCount: 0,
        payloads: [],
        cursor: params.currentCursor,
        mightHaveMore: true,
      } satisfies AirtablePollStage)

    if (stage.apiCallCount >= AIRTABLE_POLL_PAGE_LIMIT) {
      return { stage, committed: false }
    }

    const [updatedWebhook] = await tx
      .update(webhook)
      .set({
        providerConfig: sql`jsonb_set(coalesce(${webhook.providerConfig}::jsonb, '{}'::jsonb), '{externalWebhookCursor}', to_jsonb(${params.nextCursor}::integer))::json`,
        updatedAt: sql`date_trunc('milliseconds', greatest(clock_timestamp(), ${webhook.updatedAt} + interval '1 millisecond'))`,
      })
      .where(
        and(
          eq(webhook.id, params.webhookId),
          eq(webhook.provider, 'airtable'),
          eq(webhook.isActive, true),
          sql`${webhook.providerConfig}->>'externalId' = ${params.externalId}`,
          sql`${webhook.providerConfig}->>'externalWebhookCursor' IS NOT DISTINCT FROM ${params.currentCursor === null ? null : params.currentCursor.toString()}`
        )
      )
      .returning({ id: webhook.id })
    if (!updatedWebhook) return { stage, committed: false }

    const nextStage: AirtablePollStage = {
      externalId: params.externalId,
      apiCallCount: stage.apiCallCount + 1,
      payloads: [...stage.payloads, ...params.receivedPayloads],
      cursor: params.nextCursor,
      mightHaveMore: params.mightHaveMore,
    }
    const [updatedExecution] = await tx
      .update(pendingExecution)
      .set({
        payload: { ...executionPayload, [AIRTABLE_POLL_STAGE_KEY]: nextStage },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pendingExecution.id, params.pendingExecutionId),
          eq(pendingExecution.executionType, 'webhook'),
          eq(pendingExecution.status, 'processing')
        )
      )
      .returning({ id: pendingExecution.id })
    if (!updatedExecution)
      throw new AirtableStageIntegrityError('Failed to persist Airtable poll stage')
    return { stage: nextStage, committed: true }
  })
}

function buildAirtablePollInput(
  stage: AirtablePollStage,
  providerConfig: unknown
): Record<string, unknown> | undefined {
  const consolidatedChanges = new Map<string, AirtableChange>()
  for (const rawPayload of stage.payloads) {
    const payload = toJsonRecord(rawPayload)
    for (const [tableId, rawTableChanges] of Object.entries(
      toJsonRecord(payload.changedTablesById)
    )) {
      const tableChanges = toJsonRecord(rawTableChanges)
      for (const [recordId, rawRecordData] of Object.entries(
        toJsonRecord(tableChanges.createdRecordsById)
      )) {
        const recordData = toJsonRecord(rawRecordData)
        const existing = consolidatedChanges.get(recordId)
        if (existing) {
          existing.changedFields = {
            ...existing.changedFields,
            ...toJsonRecord(recordData.cellValuesByFieldId),
          }
        } else {
          consolidatedChanges.set(recordId, {
            tableId,
            recordId,
            changeType: 'created',
            changedFields: toJsonRecord(recordData.cellValuesByFieldId),
          })
        }
      }
      for (const [recordId, rawRecordData] of Object.entries(
        toJsonRecord(tableChanges.changedRecordsById)
      )) {
        const recordData = toJsonRecord(rawRecordData)
        const currentFields = toJsonRecord(toJsonRecord(recordData.current).cellValuesByFieldId)
        const existing = consolidatedChanges.get(recordId)
        if (existing) {
          existing.changedFields = { ...existing.changedFields, ...currentFields }
          existing.changeType = 'updated'
        } else {
          const previousFields = toJsonRecord(toJsonRecord(recordData.previous).cellValuesByFieldId)
          consolidatedChanges.set(recordId, {
            tableId,
            recordId,
            changeType: 'updated',
            changedFields: currentFields,
            ...(Object.keys(previousFields).length ? { previousFields } : {}),
          })
        }
      }
    }
  }

  const airtableChanges = Array.from(consolidatedChanges.values())
  if (!stage.payloads.length && !airtableChanges.length) return
  const latestPayload = stage.payloads.at(-1) ?? null
  return {
    payloads: stage.payloads,
    latestPayload,
    airtableChanges,
    webhook: {
      data: {
        provider: 'airtable',
        providerConfig,
        payload: latestPayload,
      },
    },
  }
}

async function formatAirtableWebhookInput(
  webhookData: any,
  workflowData: any,
  requestId: string,
  pendingExecutionId: string
): Promise<AirtablePollResult> {
  if (
    webhookData.provider !== 'airtable' ||
    webhookData.isActive !== true ||
    !(webhookData.updatedAt instanceof Date)
  ) {
    throw new Error('Airtable webhook is not active')
  }

  const providerConfig = toJsonRecord(webhookData.providerConfig)
  const baseId = providerConfig.baseId
  const externalId = providerConfig.externalId
  const credentialId = providerConfig.credentialId
  if (
    typeof baseId !== 'string' ||
    !baseId ||
    typeof externalId !== 'string' ||
    !externalId ||
    typeof credentialId !== 'string' ||
    !credentialId
  ) {
    throw new Error('Airtable webhook configuration is incomplete')
  }

  let stage = await readAirtablePollStage(pendingExecutionId, webhookData.id, externalId)
  const storedCursor = providerConfig.externalWebhookCursor
  let currentCursor = Number.isInteger(storedCursor) ? storedCursor : null

  let accessToken: string | null | undefined

  while ((stage?.mightHaveMore ?? true) && (stage?.apiCallCount ?? 0) < AIRTABLE_POLL_PAGE_LIMIT) {
    try {
      accessToken ??= await getOAuthAccessTokenForStoredCredential({
        credentialId,
        workspaceId: workflowData.workspaceId,
        requestId,
      })
      if (!accessToken) throw new Error('Airtable account connection required')

      const queryParams = new URLSearchParams()
      if (currentCursor !== null) queryParams.set('cursor', currentCursor.toString())
      const { response, responseText } = await retryAirtablePoll(async () => {
        const response = await fetch(
          `https://api.airtable.com/v0/bases/${baseId}/webhooks/${externalId}/payloads?${queryParams.toString()}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        )
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`Airtable API error ${response.status}`)
        }
        return { response, responseText: await response.text() }
      })
      let responseBody: Record<string, any>
      try {
        responseBody = toJsonRecord(JSON.parse(responseText))
      } catch (error) {
        throw new Error('Airtable payload response is malformed', { cause: error })
      }
      if (!response.ok || responseBody.error) {
        const detail =
          toJsonRecord(responseBody.error).message ||
          responseBody.error ||
          `Airtable API error Status ${response.status}`
        throw new Error(String(detail))
      }
      if (!Array.isArray(responseBody.payloads) || !Number.isInteger(responseBody.cursor)) {
        throw new Error('Airtable payload response is malformed')
      }
      const nextCursor = responseBody.cursor
      if (nextCursor === currentCursor) {
        if (responseBody.payloads.length) {
          throw new Error('Airtable payload cursor did not advance')
        }
        break
      }

      const committed = await commitAirtablePollPage({
        pendingExecutionId,
        webhookId: webhookData.id,
        externalId,
        currentCursor,
        nextCursor,
        receivedPayloads: responseBody.payloads,
        mightHaveMore: responseBody.mightHaveMore === true,
      })
      stage = committed.stage
      if (!committed.committed) break
      currentCursor = nextCursor
    } catch (error) {
      if (error instanceof AirtableStageIntegrityError) throw error
      if (!stage?.payloads.length) throw error
      logger.warn(`[${requestId}] Airtable polling stopped; executing durable payloads`, error)
      break
    }
  }

  const durableStage =
    stage ??
    ({
      externalId,
      apiCallCount: 0,
      payloads: [],
      cursor: currentCursor,
      mightHaveMore: false,
    } satisfies AirtablePollStage)
  return {
    input: buildAirtablePollInput(durableStage, webhookData.providerConfig),
    continuation: getStageContinuation(durableStage),
  }
}

interface AirtableChange {
  tableId: string
  recordId: string
  changeType: 'created' | 'updated'
  changedFields: Record<string, any> // { fieldId: newValue }
  previousFields?: Record<string, any> // { fieldId: previousValue } (optional)
}

/**
 * Configure Gmail polling for a webhook
 */
export async function configureGmailPolling(
  webhookData: any,
  requestId: string,
  workspaceId: string
): Promise<typeof webhook.$inferSelect | null> {
  const logger = createLogger('GmailWebhookSetup')
  logger.info(`[${requestId}] Setting up Gmail polling for webhook ${webhookData.id}`)

  try {
    const { userId: _gmailUserId, ...providerConfig } =
      (webhookData.providerConfig as Record<string, any>) || {}
    const credentialId: string | undefined = providerConfig.credentialId

    if (!credentialId) {
      logger.error(`[${requestId}] Missing credentialId for Gmail webhook ${webhookData.id}`)
      return null
    }

    const accessToken = await getOAuthAccessTokenForStoredCredential({
      credentialId,
      workspaceId,
      requestId,
    })
    if (!accessToken) {
      logger.error(
        `[${requestId}] Failed to refresh/access Gmail token for credential ${credentialId}`
      )
      return null
    }

    const maxEmailsPerPoll =
      typeof providerConfig.maxEmailsPerPoll === 'string'
        ? Number.parseInt(providerConfig.maxEmailsPerPoll, 10) || 25
        : providerConfig.maxEmailsPerPoll || 25

    const pollingInterval =
      typeof providerConfig.pollingInterval === 'string'
        ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
        : providerConfig.pollingInterval || 5

    const revision = getWebhookRevision(
      webhookData,
      eq(webhook.provider, 'gmail'),
      eq(webhook.isActive, true)
    )
    const [updated] = await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          credentialId,
          maxEmailsPerPoll,
          pollingInterval,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          labelIds: providerConfig.labelIds || ['INBOX'],
          labelFilterBehavior: providerConfig.labelFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: revision.updatedAt.toISOString(),
          setupCompleted: true,
        },
        updatedAt: revision.updatedAt,
      })
      .where(revision.where)
      .returning()
    if (!updated) throw new WebhookRevisionConflictError()

    logger.info(
      `[${requestId}] Successfully configured Gmail polling for webhook ${webhookData.id}`
    )
    return updated
  } catch (error: any) {
    if (error instanceof WebhookRevisionConflictError) throw error
    logger.error(`[${requestId}] Failed to configure Gmail polling`, {
      webhookId: webhookData.id,
      error: error.message,
      stack: error.stack,
    })
    return null
  }
}

/**
 * Configure Outlook polling for a webhook
 */
export async function configureOutlookPolling(
  webhookData: any,
  requestId: string,
  workspaceId: string
): Promise<typeof webhook.$inferSelect | null> {
  const logger = createLogger('OutlookWebhookSetup')
  logger.info(`[${requestId}] Setting up Outlook polling for webhook ${webhookData.id}`)

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const credentialId: string | undefined = providerConfig.credentialId

    if (!credentialId) {
      logger.error(`[${requestId}] Missing credentialId for Outlook webhook ${webhookData.id}`)
      return null
    }

    const accessToken = await getOAuthAccessTokenForStoredCredential({
      credentialId,
      workspaceId,
      requestId,
    })
    if (!accessToken) {
      logger.error(
        `[${requestId}] Failed to refresh/access Outlook token for credential ${credentialId}`
      )
      return null
    }

    const { userId: _outlookUserId, ...providerCfg } =
      (webhookData.providerConfig as Record<string, any>) || {}

    const revision = getWebhookRevision(
      webhookData,
      eq(webhook.provider, 'outlook'),
      eq(webhook.isActive, true)
    )
    const [updated] = await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerCfg,
          credentialId,
          maxEmailsPerPoll:
            typeof providerCfg.maxEmailsPerPoll === 'string'
              ? Number.parseInt(providerCfg.maxEmailsPerPoll, 10) || 25
              : providerCfg.maxEmailsPerPoll || 25,
          pollingInterval:
            typeof providerCfg.pollingInterval === 'string'
              ? Number.parseInt(providerCfg.pollingInterval, 10) || 5
              : providerCfg.pollingInterval || 5,
          markAsRead: providerCfg.markAsRead || false,
          includeRawEmail: providerCfg.includeRawEmail || false,
          folderIds: providerCfg.folderIds || ['inbox'],
          folderFilterBehavior: providerCfg.folderFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: revision.updatedAt.toISOString(),
          setupCompleted: true,
        },
        updatedAt: revision.updatedAt,
      })
      .where(revision.where)
      .returning()
    if (!updated) throw new WebhookRevisionConflictError()

    logger.info(
      `[${requestId}] Successfully configured Outlook polling for webhook ${webhookData.id}`
    )
    return updated
  } catch (error: any) {
    if (error instanceof WebhookRevisionConflictError) throw error
    logger.error(`[${requestId}] Failed to configure Outlook polling`, {
      webhookId: webhookData.id,
      error: error.message,
      stack: error.stack,
    })
    return null
  }
}

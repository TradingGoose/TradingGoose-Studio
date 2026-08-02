'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  ImageUpload,
  Input,
  Label,
  Textarea,
} from '@/components/ui'
import {
  CHAT_TRIGGER_SUBBLOCK_IDS,
  type ChatAuthType,
  type ChatDeploymentDraftConfig,
  DEFAULT_CHAT_WELCOME_MESSAGE,
  hasAnyChatDeploymentDraftValue,
} from '@/lib/chat/deployment-config'
import { createLogger } from '@/lib/logs/console/logger'
import { AuthSelector } from '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components/chat-deploy/components/auth-selector'
import { IdentifierInput } from '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components/chat-deploy/components/identifier-input'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useDeploymentCopy } from '@/widgets/widgets/editor_workflow/copy'
import { OutputSelect } from '@/widgets/widgets/workflow_chat/components/output-select/output-select'

const logger = createLogger('ChatDeploy')

interface ExistingChat {
  identifier: string
  title: string
  description: string
  authType: ChatAuthType
  allowedEmails: string[]
  outputConfigs: Array<{ blockId: string; path: string }>
  customizations?: {
    welcomeMessage?: string
    imageUrl?: string
  }
  hasPassword?: boolean
  chatUrl?: string
}

interface ChatDeployProps {
  workflowId: string
  blockId: string
  publishedChat: ExistingChat | null
  onBusyChange?: (busy: boolean) => void
}

const normalizeStringValue = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback
}

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

const buildDraftConfig = (params: {
  identifier: unknown
  title: unknown
  description: unknown
  authType: unknown
  encryptedPassword: unknown
  allowedEmails: unknown
  welcomeMessage: unknown
  selectedOutputBlocks: unknown
  imageUrl: unknown
}): ChatDeploymentDraftConfig => {
  return {
    identifier: normalizeStringValue(params.identifier).trim(),
    title: normalizeStringValue(params.title).trim(),
    description: normalizeStringValue(params.description).trim(),
    authType:
      params.authType === 'password' || params.authType === 'email' || params.authType === 'sso'
        ? params.authType
        : 'public',
    encryptedPassword: normalizeStringValue(params.encryptedPassword).trim() || null,
    allowedEmails: normalizeStringArray(params.allowedEmails).map((value) => value.trim()),
    welcomeMessage:
      normalizeStringValue(params.welcomeMessage).trim() || DEFAULT_CHAT_WELCOME_MESSAGE,
    selectedOutputBlocks: normalizeStringArray(params.selectedOutputBlocks),
    imageUrl: normalizeStringValue(params.imageUrl).trim() || null,
  }
}

export function ChatDeploy({ workflowId, blockId, publishedChat, onBusyChange }: ChatDeployProps) {
  const deploymentCopy = useDeploymentCopy()
  const copy = deploymentCopy.chat
  const [identifierValue, setIdentifierValue] = useSubBlockValue<string>(
    blockId,
    CHAT_TRIGGER_SUBBLOCK_IDS.identifier
  )
  const [titleValue, setTitleValue] = useSubBlockValue<string>(
    blockId,
    CHAT_TRIGGER_SUBBLOCK_IDS.title
  )
  const [descriptionValue, setDescriptionValue] = useSubBlockValue<string>(
    blockId,
    CHAT_TRIGGER_SUBBLOCK_IDS.description
  )
  const [authTypeValue, setAuthTypeValue] = useSubBlockValue<ChatAuthType>(
    blockId,
    CHAT_TRIGGER_SUBBLOCK_IDS.authType
  )
  const [encryptedPasswordValue, setEncryptedPasswordValue] = useSubBlockValue<string>(
    blockId,
    CHAT_TRIGGER_SUBBLOCK_IDS.password
  )
  const [allowedEmailsValue, setAllowedEmailsValue] = useSubBlockValue<string[]>(
    blockId,
    CHAT_TRIGGER_SUBBLOCK_IDS.allowedEmails
  )
  const [welcomeMessageValue, setWelcomeMessageValue] = useSubBlockValue<string>(
    blockId,
    CHAT_TRIGGER_SUBBLOCK_IDS.welcomeMessage
  )
  const [selectedOutputBlocksValue, setSelectedOutputBlocksValue] = useSubBlockValue<string[]>(
    blockId,
    CHAT_TRIGGER_SUBBLOCK_IDS.selectedOutputBlocks
  )
  const [imageUrlValue, setImageUrlValue] = useSubBlockValue<string>(
    blockId,
    CHAT_TRIGGER_SUBBLOCK_IDS.imageUrl
  )

  const [passwordInput, setPasswordInput] = useState('')
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [passwordSaveError, setPasswordSaveError] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const initialEncryptedPasswordRef = useRef<string | null | undefined>(undefined)
  const didHydrateFromPublishedRef = useRef(false)

  const draftConfig = useMemo(
    () =>
      buildDraftConfig({
        identifier: identifierValue,
        title: titleValue,
        description: descriptionValue,
        authType: authTypeValue,
        encryptedPassword: encryptedPasswordValue,
        allowedEmails: allowedEmailsValue,
        welcomeMessage: welcomeMessageValue,
        selectedOutputBlocks: selectedOutputBlocksValue,
        imageUrl: imageUrlValue,
      }),
    [
      allowedEmailsValue,
      authTypeValue,
      descriptionValue,
      encryptedPasswordValue,
      identifierValue,
      imageUrlValue,
      selectedOutputBlocksValue,
      titleValue,
      welcomeMessageValue,
    ]
  )

  useEffect(() => {
    if (initialEncryptedPasswordRef.current === undefined) {
      initialEncryptedPasswordRef.current = draftConfig.encryptedPassword
    }
  }, [draftConfig.encryptedPassword])

  useEffect(() => {
    onBusyChange?.(isSavingPassword || isImageUploading)
  }, [isImageUploading, isSavingPassword, onBusyChange])

  useEffect(() => {
    return () => {
      onBusyChange?.(false)
    }
  }, [onBusyChange])

  useEffect(() => {
    if (!publishedChat || didHydrateFromPublishedRef.current) {
      return
    }

    if (hasAnyChatDeploymentDraftValue(draftConfig)) {
      didHydrateFromPublishedRef.current = true
      return
    }

    setIdentifierValue(publishedChat.identifier || '')
    setTitleValue(publishedChat.title || '')
    setDescriptionValue(publishedChat.description || '')
    setAuthTypeValue(publishedChat.authType || 'public')
    setAllowedEmailsValue(
      Array.isArray(publishedChat.allowedEmails) ? [...publishedChat.allowedEmails] : []
    )
    setWelcomeMessageValue(
      publishedChat.customizations?.welcomeMessage || DEFAULT_CHAT_WELCOME_MESSAGE
    )
    setSelectedOutputBlocksValue(
      Array.isArray(publishedChat.outputConfigs)
        ? publishedChat.outputConfigs.map((config) => `${config.blockId}_${config.path}`)
        : []
    )
    setImageUrlValue(publishedChat.customizations?.imageUrl || '')
    didHydrateFromPublishedRef.current = true
  }, [
    draftConfig,
    publishedChat,
    setAllowedEmailsValue,
    setAuthTypeValue,
    setDescriptionValue,
    setIdentifierValue,
    setImageUrlValue,
    setSelectedOutputBlocksValue,
    setTitleValue,
    setWelcomeMessageValue,
  ])

  useEffect(() => {
    if (draftConfig.authType !== 'password') {
      setIsSavingPassword(false)
      return
    }

    const trimmedPassword = passwordInput.trim()
    if (!trimmedPassword) {
      return
    }

    setIsSavingPassword(true)
    setGeneralError(null)
    setPasswordSaveError(false)

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/workflows/${workflowId}/chat/password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ password: trimmedPassword }),
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || copy.failedToSavePassword)
        }

        setEncryptedPasswordValue(data.encryptedPassword)
      } catch (error: any) {
        logger.error('Failed to encrypt chat password:', error)
        setPasswordSaveError(true)
      } finally {
        setIsSavingPassword(false)
      }
    }, 350)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [draftConfig.authType, passwordInput, setEncryptedPasswordValue, workflowId])

  const handlePasswordChange = (nextPassword: string) => {
    setPasswordInput(nextPassword)
    setGeneralError(null)
    setPasswordSaveError(false)

    if (nextPassword.trim()) {
      return
    }

    const initialEncryptedPassword = initialEncryptedPasswordRef.current
    setEncryptedPasswordValue(initialEncryptedPassword || '')
  }

  const handleAuthTypeChange = (nextAuthType: ChatAuthType) => {
    setAuthTypeValue(nextAuthType)
    setGeneralError(null)
    setPasswordSaveError(false)

    if (nextAuthType !== 'password') {
      setPasswordInput('')
      setEncryptedPasswordValue('')
    }

    if (nextAuthType !== 'email' && nextAuthType !== 'sso') {
      setAllowedEmailsValue([])
    }
  }

  const publishedUrl = publishedChat?.chatUrl
  const hasSavedPassword = Boolean(draftConfig.encryptedPassword || publishedChat?.hasPassword)
  const isPasswordConfigured = draftConfig.authType !== 'password' || hasSavedPassword
  const alertMessage = generalError ?? (passwordSaveError ? copy.failedToSavePassword : null)

  return (
    <div className='space-y-4'>
      {publishedUrl ? (
        <div className='rounded-md border bg-muted/20 p-3 text-sm'>
          <div className='font-medium'>{copy.publishedChatTitle}</div>
          <a
            href={publishedUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='mt-1 block break-all text-foreground underline-offset-4 hover:underline'
          >
            {publishedUrl}
          </a>
          <div className='mt-1 text-muted-foreground'>{copy.draftUntilRedeployNotice}</div>
        </div>
      ) : (
        <div className='rounded-md border bg-muted/20 p-3 text-muted-foreground text-sm'>
          {deploymentCopy.chatDeploymentDescription}
        </div>
      )}

      {alertMessage && (
        <Alert variant='destructive'>
          <AlertTriangle className='h-4 w-4' />
          <AlertDescription>{alertMessage}</AlertDescription>
        </Alert>
      )}

      <div className='space-y-4'>
        <IdentifierInput
          value={draftConfig.identifier}
          onChange={setIdentifierValue}
          originalIdentifier={publishedChat?.identifier}
          isEditingExisting={Boolean(publishedChat)}
        />

        <div className='space-y-2'>
          <Label htmlFor='chat-title' className='font-medium text-sm'>
            {copy.chatTitle}
          </Label>
          <Input
            id='chat-title'
            placeholder={copy.chatTitlePlaceholder}
            value={draftConfig.title}
            onChange={(event) => setTitleValue(event.target.value)}
            className='h-10 rounded-sm'
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='chat-description' className='font-medium text-sm'>
            {copy.description}
          </Label>
          <Textarea
            id='chat-description'
            placeholder={copy.descriptionPlaceholder}
            value={draftConfig.description}
            onChange={(event) => setDescriptionValue(event.target.value)}
            rows={3}
            className='min-h-[80px] resize-none rounded-sm'
          />
        </div>

        <div className='space-y-2'>
          <Label className='font-medium text-sm'>{copy.chatOutput}</Label>
          <Card className='rounded-sm border-input shadow-none'>
            <CardContent className='p-1'>
              <OutputSelect
                workflowId={workflowId}
                selectedOutputs={draftConfig.selectedOutputBlocks}
                onOutputSelect={setSelectedOutputBlocksValue}
                placeholder={copy.outputPlaceholder}
              />
            </CardContent>
          </Card>
          <p className='text-muted-foreground text-xs'>{copy.outputDescription}</p>
        </div>

        <AuthSelector
          authType={draftConfig.authType}
          password={passwordInput}
          emails={draftConfig.allowedEmails}
          onAuthTypeChange={handleAuthTypeChange}
          onPasswordChange={handlePasswordChange}
          onEmailsChange={setAllowedEmailsValue}
          isExistingChat={hasSavedPassword}
          error={!isPasswordConfigured ? copy.passwordRequired : undefined}
        />

        {draftConfig.authType === 'password' && (
          <div className='rounded-md border bg-muted/20 px-3 py-2 text-muted-foreground text-xs'>
            <div className='flex items-center gap-2'>
              {isSavingPassword && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
              <span>
                {isSavingPassword
                  ? copy.savingPassword
                  : hasSavedPassword
                    ? copy.savedPasswordExists
                    : copy.setPasswordToPublish}
              </span>
            </div>
          </div>
        )}

        <div className='space-y-2'>
          <Label htmlFor='chat-welcome-message' className='font-medium text-sm'>
            {copy.welcomeMessage}
          </Label>
          <Textarea
            id='chat-welcome-message'
            placeholder={copy.welcomeMessagePlaceholder}
            value={draftConfig.welcomeMessage}
            onChange={(event) => setWelcomeMessageValue(event.target.value)}
            rows={3}
            className='min-h-[80px] resize-none rounded-sm'
          />
          <p className='text-muted-foreground text-xs'>{copy.welcomeMessageDescription}</p>
        </div>

        <div className='space-y-2'>
          <Label
            id='chat-logo-upload-label'
            htmlFor='chat-logo-upload-control'
            className='font-medium text-sm'
          >
            {copy.chatLogo}
          </Label>
          <ImageUpload
            id='chat-logo-upload-control'
            labelledBy='chat-logo-upload-label'
            describedBy={
              !draftConfig.imageUrl && !isImageUploading ? 'chat-logo-upload-hint' : undefined
            }
            labels={{
              select: copy.chatLogoSelect,
              drop: copy.chatLogoDrop,
              uploading: copy.chatLogoUploading,
              wait: copy.chatLogoWait,
              replace: copy.chatLogoReplace,
              delete: copy.chatLogoDelete,
              removeFile: copy.chatLogoRemoveFile,
              previewAlt: copy.chatLogo,
            }}
            value={draftConfig.imageUrl}
            onUpload={(url) => {
              setImageUrlValue(url || '')
              setGeneralError(null)
              setPasswordSaveError(false)
            }}
            onError={setGeneralError}
            onUploadStart={setIsImageUploading}
            uploadToServer={true}
            height='h-32'
          />
          {!draftConfig.imageUrl && !isImageUploading && (
            <p id='chat-logo-upload-hint' className='text-muted-foreground text-xs'>
              {copy.chatLogoHint}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

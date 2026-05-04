'use client'

import { useEffect, useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocale } from 'next-intl'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Form, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import {
  type ApiKey,
  ApiKeySelector,
} from '@/widgets/widgets/editor_workflow/components/control-bar/components/api-key-selector/api-key-selector'

type DeployFormValues = {
  apiKey: string
  newKeyName?: string
}

interface DeployFormProps {
  apiKeys: ApiKey[]
  selectedApiKeyId: string
  onApiKeyChange: (keyId: string) => void
  onSubmit: (data: DeployFormValues) => void
  onApiKeyCreated?: () => void
  formId?: string
  isDeployed?: boolean
  deployedApiKeyDisplay?: string
}

export function DeployForm({
  apiKeys,
  selectedApiKeyId,
  onApiKeyChange,
  onSubmit,
  onApiKeyCreated,
  formId,
  isDeployed = false,
  deployedApiKeyDisplay,
}: DeployFormProps) {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.widgets.apiKey
  const deployFormSchema = useMemo(
    () =>
      z.object({
        apiKey: z.string().min(1, copy.selectAnApiKey),
        newKeyName: z.string().optional(),
      }),
    [copy.selectAnApiKey]
  )
  const form = useForm<DeployFormValues>({
    resolver: zodResolver(deployFormSchema),
    defaultValues: {
      apiKey: selectedApiKeyId || (apiKeys.length > 0 ? apiKeys[0].id : ''),
      newKeyName: '',
    },
  })

  useEffect(() => {
    if (selectedApiKeyId) {
      form.setValue('apiKey', selectedApiKeyId)
    }
  }, [selectedApiKeyId, form])

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(form.getValues())
        }}
        className='space-y-6'
      >
        <FormField
          control={form.control}
          name='apiKey'
          render={({ field }) => (
            <FormItem className='space-y-1.5'>
              <ApiKeySelector
                value={field.value}
                onChange={(keyId) => {
                  field.onChange(keyId)
                  onApiKeyChange(keyId)
                }}
                apiKeys={apiKeys}
                onApiKeyCreated={onApiKeyCreated}
                showLabel={true}
                label={copy.selectApiKey}
                isDeployed={isDeployed}
                deployedApiKeyDisplay={deployedApiKeyDisplay}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}

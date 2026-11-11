'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useMessages } from 'next-intl'
import {
  Button,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import {
  COPILOT_PROVIDERS,
  type CopilotProvider,
  type CopilotSettings,
  CopilotSettingsSchema,
  getCopilotModelId,
} from '@/lib/copilot/settings'
import { Link } from '@/i18n/navigation'
import { formatTemplate } from '@/i18n/utils'

export function CopilotSettingsFields({
  value,
  onChange,
}: {
  value: CopilotSettings
  onChange: (value: CopilotSettings) => void
}) {
  const copy = useMessages().admin.systemSettings.copilot
  const defaultIndex = value.models.findIndex(
    (row) => getCopilotModelId(row) === value.defaultModel
  )
  const isValid = CopilotSettingsSchema.safeParse(value).success

  function updateRow(index: number, update: Partial<CopilotSettings['models'][number]>) {
    const models = value.models.map((row, position) =>
      position === index ? { ...row, ...update } : row
    )
    onChange({
      models,
      defaultModel: index === defaultIndex ? getCopilotModelId(models[index]) : value.defaultModel,
    })
  }

  function removeRow(index: number) {
    const models = value.models.filter((_, position) => position !== index)
    onChange({
      models,
      defaultModel:
        index === defaultIndex
          ? models[0]
            ? getCopilotModelId(models[0])
            : null
          : value.defaultModel,
    })
  }

  return (
    <section className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
      <div className='space-y-1'>
        <h3 className='font-medium text-sm'>{copy.title}</h3>
        <p className='text-muted-foreground text-xs leading-relaxed'>{copy.description}</p>
        <Link href='/admin/services' className='inline-block text-sm underline underline-offset-4'>
          {copy.manageKeys}
        </Link>
      </div>

      {value.models.length ? (
        <RadioGroup
          aria-label={copy.defaultModel}
          value={defaultIndex < 0 ? '' : String(defaultIndex)}
          onValueChange={(index) => {
            const row = value.models[Number(index)]
            if (row) onChange({ ...value, defaultModel: getCopilotModelId(row) })
          }}
          className='gap-3'
        >
          {value.models.map((row, index) => (
            <div
              key={index}
              className='grid gap-3 rounded-md border border-border/60 bg-muted/10 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]'
            >
              <div className='min-w-0 space-y-2'>
                <Label htmlFor={`copilot-provider-${index}`}>{copy.provider}</Label>
                <Select
                  value={row.provider}
                  onValueChange={(provider) => {
                    if (provider) updateRow(index, { provider: provider as CopilotProvider })
                  }}
                >
                  <SelectTrigger id={`copilot-provider-${index}`}>
                    <SelectValue>{COPILOT_PROVIDERS[row.provider].name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(COPILOT_PROVIDERS).map(([provider, configuration]) => (
                      <SelectItem key={provider} value={provider}>
                        {configuration.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='min-w-0 space-y-2'>
                <Label htmlFor={`copilot-model-${index}`}>{copy.model}</Label>
                <Input
                  id={`copilot-model-${index}`}
                  value={row.model}
                  placeholder={copy.modelPlaceholder}
                  autoComplete='off'
                  spellCheck={false}
                  aria-describedby={!isValid ? 'copilot-models-validation' : undefined}
                  onChange={(event) => updateRow(index, { model: event.target.value })}
                />
              </div>
              <div className='flex items-center justify-between gap-3 sm:justify-end sm:pt-7'>
                <Label
                  htmlFor={`copilot-default-${index}`}
                  className='flex cursor-pointer items-center gap-2'
                >
                  <RadioGroupItem id={`copilot-default-${index}`} value={String(index)} />
                  {copy.defaultModel}
                </Label>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  onClick={() => removeRow(index)}
                  aria-label={formatTemplate(copy.removeModel, { number: String(index + 1) })}
                >
                  <Trash2 aria-hidden='true' className='size-4' />
                </Button>
              </div>
            </div>
          ))}
        </RadioGroup>
      ) : (
        <p className='rounded-md border border-dashed px-3 py-4 text-muted-foreground text-sm'>
          {copy.empty}
        </p>
      )}

      {!isValid ? (
        <p id='copilot-models-validation' role='alert' className='text-destructive text-sm'>
          {copy.invalidModels}
        </p>
      ) : null}

      <div className='flex flex-wrap items-center gap-3'>
        <Button
          type='button'
          variant='outline'
          onClick={() => {
            const row = { provider: 'openai' as const, model: '' }
            onChange({
              models: [...value.models, row],
              defaultModel: value.defaultModel ?? getCopilotModelId(row),
            })
          }}
        >
          <Plus aria-hidden='true' className='mr-2 size-4' />
          {copy.addModel}
        </Button>
        <p className='text-muted-foreground text-xs'>{copy.defaultHint}</p>
      </div>
    </section>
  )
}

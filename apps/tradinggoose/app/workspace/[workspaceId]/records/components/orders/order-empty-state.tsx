import { useTranslations } from 'next-intl'

export function OrderEmptyState() {
  const t = useTranslations('workspace.records.orders')
  return <div className='text-muted-foreground text-sm'>{t('emptyState')}</div>
}

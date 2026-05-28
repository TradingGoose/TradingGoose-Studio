import IntlProvider from '@/app/intl-provider'
import NotFoundContent from './not-found-content'

export default function NotFound() {
  return (
    <IntlProvider namespaces={['nav', 'notFound'] as const}>
      <NotFoundContent />
    </IntlProvider>
  )
}

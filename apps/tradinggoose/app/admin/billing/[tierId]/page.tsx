import { AdminBillingTierDetail } from '../tier-detail'

export default async function AdminBillingTierDetailPage({
  params,
}: {
  params: Promise<{ tierId: string }>
}) {
  const { tierId } = await params

  return <AdminBillingTierDetail tierId={tierId} />
}

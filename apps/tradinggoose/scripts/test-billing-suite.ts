import { spawnSync } from 'node:child_process'

const testFiles = [
  'lib/admin/billing/tier-mutations.test.ts',
  'lib/admin/billing/access-code.test.ts',
  'lib/admin/billing/snapshot.test.ts',
  'app/api/admin/billing/tiers/route.test.ts',
  'app/api/admin/billing/tiers/[id]/route.test.ts',
  'hooks/queries/admin-billing.test.tsx',
  'app/admin/billing/billing-admin.test.tsx',
  'app/admin/billing/tier-detail.test.tsx',
  'app/admin/billing/tier-editor.test.tsx',
  'app/api/billing/private-tier-access/route.test.ts',
  'hooks/queries/private-tier-access.test.tsx',
  'lib/billing/tier-availability-policy.test.ts',
  'lib/billing/tiers.test.ts',
  'lib/billing/subscription-tier-display.test.ts',
  'lib/billing/catalog.test.ts',
  'global-navbar/settings-modal/components/subscription/subscription-permissions.test.ts',
  'global-navbar/settings-modal/components/subscription/subscription.test.tsx',
  'app/api/billing/public-catalog/route.test.ts',
  'lib/billing/plans.test.ts',
  'app/api/auth/[...all]/route.test.ts',
  'app/api/organizations/[id]/seats/route.test.ts',
  'app/api/billing/payg/activate/route.test.ts',
  'lib/billing/webhooks/invoices.test.ts',
  'lib/billing/webhooks/subscription.test.ts',
  'app/api/billing/route.test.ts',
  'lib/billing/core/subscription.test.ts',
  'lib/billing/core/usage.test.ts',
  'app/api/webhooks/test/route.test.ts',
] as const

const result = spawnSync('bun', ['run', 'test', '--', ...testFiles], {
  cwd: process.cwd(),
  stdio: 'inherit',
})

process.exit(result.status ?? 1)

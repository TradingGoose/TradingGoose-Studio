import { getSystemAdminAccess } from '@/lib/admin/access'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import type { RegistrationMode } from '@/lib/registration/shared'
import Nav from './nav'

interface PublicNavProps {
  registrationMode?: RegistrationMode
}

export default async function PublicNav({ registrationMode }: PublicNavProps = {}) {
  const [access, resolvedRegistrationMode] = await Promise.all([
    getSystemAdminAccess(),
    registrationMode ? Promise.resolve(registrationMode) : getRegistrationModeForRender(),
  ])

  return (
    <Nav
      registrationMode={resolvedRegistrationMode}
      authenticatedUser={access.user}
      canAccessSystemAdmin={access.isSystemAdmin}
    />
  )
}

import { getRegistrationModeForRender } from '@/lib/registration/service'
import type { RegistrationMode } from '@/lib/registration/shared'
import Nav from './nav'

interface PublicNavProps {
  registrationMode?: RegistrationMode
}

export default async function PublicNav({ registrationMode }: PublicNavProps = {}) {
  const resolvedRegistrationMode = registrationMode ?? (await getRegistrationModeForRender())

  return <Nav registrationMode={resolvedRegistrationMode} />
}

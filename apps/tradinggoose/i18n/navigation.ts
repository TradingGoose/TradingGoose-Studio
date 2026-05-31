import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

// These navigation helpers localize canonical internal paths like `/verify`.
// Do not pre-localize hrefs before passing them to this router.
export const { Link, usePathname, useRouter, redirect, getPathname } = createNavigation(routing)

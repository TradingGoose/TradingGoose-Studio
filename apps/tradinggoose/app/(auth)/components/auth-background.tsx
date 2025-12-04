import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import { cn } from '@/lib/utils'

type AuthBackgroundProps = {
  className?: string
  children?: React.ReactNode
}

export default function AuthBackground({ className, children }: AuthBackgroundProps) {
  return (
    <div className={cn('relative min-h-screen w-full overflow-hidden', className)}>
      <BackgroundRippleEffect cellSize={90} rows={15} />
      <div className='relative z-20 mx-auto w-full'>{children}</div>
    </div>
  )
}

import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import { cn } from '@/lib/utils'


type BackgroundProps = {
  className?: string
  children?: React.ReactNode
}

export default function Background({ className, children }: BackgroundProps) {
  return (
    <div className={cn('flex-1 ', className)}>
      <BackgroundRippleEffect cellSize={90} rows={15} />
      <div className='relative z-10 mx-auto w-full'>{children}</div>
    </div>
  )
}

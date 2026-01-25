'use client'

type WidgetStateMessageProps = {
  message: string
}

export function WidgetStateMessage({ message }: WidgetStateMessageProps) {
  return (
    <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
      {message}
    </div>
  )
}

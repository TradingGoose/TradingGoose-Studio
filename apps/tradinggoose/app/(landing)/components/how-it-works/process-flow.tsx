'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Card, CardContent } from '@/components/ui/card'
import { useCardGlow } from '@/app/(landing)/components/use-card-glow'

export type Process = {
  id: string
  icon: JSX.Element
  title: string
  description: string
}

const ProcessFlow = ({ initialProcess }: { initialProcess: Process[] }) => {
  const [processStage, setProcessStage] = useState<Process[]>(initialProcess)

  useCardGlow()

  useEffect(() => {
    const interval = setInterval(() => {
      setProcessStage((prevCards) => {
        const newArray = [...prevCards]
        newArray.push(newArray.shift()!)
        return newArray
      })
    }, 2500)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className='relative mx-auto mt-2 flex h-80 w-full sm:h-72'>
      {processStage.map((item, index) => (
        <motion.div
          key={item.id}
          className='absolute inset-x-0 h-72 sm:h-56'
          style={{
            transformOrigin: 'top center',
          }}
          animate={{
            bottom: index * 16,
            scale: 1 - index * 0.1,
            zIndex: processStage.length - index,
          }}
          transition={{
            duration: 0.4,
            ease: 'easeInOut',
            delay: index * 0.05,
          }}
        >
          <div
            suppressHydrationWarning
            className='card group relative h-full overflow-hidden rounded-lg bg-foreground/10 p-px transition-all duration-300 ease-in-out'
          >
            <div
              suppressHydrationWarning
              className='blob absolute top-0 left-0 h-[120px] w-[120px] rounded-full opacity-0 blur-xl transition-all duration-300 ease-in-out'
              style={{ backgroundColor: 'hsl(var(--primary) / 0.7)' }}
            />
            <div
              className='fake-blob absolute top-0 left-0 h-40 w-40 rounded-full'
              style={{ visibility: 'hidden' }}
            />
            <Card className='relative h-full overflow-hidden rounded-lg border shadow-none'>
              <div
                className='pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100'
                style={{
                  background:
                    'radial-gradient(circle at var(--shine-x, 50%) var(--shine-y, 50%), hsl(var(--primary) / 0.06), transparent 40%)',
                }}
              />
              <CardContent className='relative z-10 space-y-6 p-6'>
                <div className='text-primary [&>svg]:size-8 [&>svg]:stroke-1 sm:[&>svg]:size-10'>
                  {item.icon}
                </div>
                <div className='space-y-3'>
                  <h3 className='font-medium text-3xl'>{item.title}</h3>
                  <p className='text-lg text-muted-foreground'>{item.description}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

export default ProcessFlow

'use client'

import * as React from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<HTMLDivElement, TabsPrimitive.List.Props>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-md bg-muted p-1 text-muted-foreground',
        className
      )}
      {...props}
    />
  )
)
TabsList.displayName = 'TabsList'

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsPrimitive.Tab.Props>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Tab
      data-slot='tabs-trigger'
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 font-medium text-sm ring-offset-background transition-all hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm',
        className
      )}
      {...props}
    />
  )
)
TabsTrigger.displayName = 'TabsTrigger'

export { Tabs, TabsList, TabsTrigger }

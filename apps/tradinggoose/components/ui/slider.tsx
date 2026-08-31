'use client'

import * as React from 'react'
import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { cn } from '@/lib/utils'

const Slider = React.forwardRef<HTMLDivElement, SliderPrimitive.Root.Props<readonly number[]>>(
  (
    { 'aria-label': ariaLabel, className, defaultValue, value, min = 0, max = 100, ...props },
    ref
  ) => {
    const values = value ?? defaultValue ?? [min]

    return (
      <SliderPrimitive.Root
        data-slot='slider'
        ref={ref}
        defaultValue={defaultValue}
        value={value}
        min={min}
        max={max}
        className={cn('relative w-full', className)}
        {...props}
      >
        <SliderPrimitive.Control className='relative flex w-full touch-none select-none items-center'>
          <SliderPrimitive.Track
            data-slot='slider-track'
            className='relative h-2 w-full grow overflow-hidden rounded-full bg-secondary'
          >
            <SliderPrimitive.Indicator
              data-slot='slider-range'
              className='absolute h-full bg-primary'
            />
          </SliderPrimitive.Track>
          {values.map((_, index) => (
            <SliderPrimitive.Thumb
              data-slot='slider-thumb'
              index={index}
              key={index}
              getAriaLabel={
                ariaLabel
                  ? () => (values.length > 1 ? `${ariaLabel} ${index + 1}` : ariaLabel)
                  : undefined
              }
              className='block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:border-white dark:bg-black'
            />
          ))}
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>
    )
  }
)
Slider.displayName = 'Slider'

export { Slider }

// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  for (const name of ['clientHeight', 'scrollHeight', 'clientWidth', 'scrollWidth'])
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: name === 'scrollHeight' ? 200 : 100,
    })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  for (const name of ['clientHeight', 'scrollHeight', 'clientWidth', 'scrollWidth'])
    Reflect.deleteProperty(HTMLElement.prototype, name)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})
it('applies viewportClassName to the Base UI viewport', async () => {
  await act(async () => {
    root.render(
      <ScrollArea className='root-class' viewportClassName='viewport-class'>
        <div>content</div>
      </ScrollArea>
    )
  })
  const rootElement = container.firstElementChild
  const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')
  const scrollbar = container.querySelector('[data-slot="scroll-area-scrollbar"]')
  expect(rootElement?.className).toContain('root-class')
  expect(viewport?.className).toContain('viewport-class')
  expect(scrollbar?.getAttribute('data-orientation')).toBe('vertical')
  expect(scrollbar?.className).toContain('data-[orientation=vertical]:w-2.5')
})

it('styles the focusable Base UI selection roots directly', async () => {
  await act(async () => {
    root.render(
      <div>
        <Switch aria-label='Enabled' />
        <RadioGroup aria-label='Choice' defaultValue='one'>
          <RadioGroupItem value='one' aria-label='One' />
        </RadioGroup>
      </div>
    )
  })
  const controls = container.querySelectorAll<HTMLElement>('[role="switch"], [role="radio"]')
  expect(controls).toHaveLength(2)
  for (const control of controls) {
    control.focus()
    expect(document.activeElement).toBe(control)
    expect(control.className).toContain('focus-visible:ring-2')
    expect(control.className).not.toContain('has-[:focus-visible]')
  }
})

it('uses a native switch root so disabled fieldsets own interaction', async () => {
  const onCheckedChange = vi.fn()
  const unsafeProps = { nativeButton: false, render: <span /> } as unknown as ComponentProps<
    typeof Switch
  >
  await act(async () => {
    root.render(
      <fieldset disabled>
        <Switch {...unsafeProps} aria-label='Pending setting' onCheckedChange={onCheckedChange} />
      </fieldset>
    )
  })
  const control = container.querySelector('[role="switch"]') as HTMLButtonElement
  expect(control.tagName).toBe('BUTTON')
  expect(control.type).toBe('button')
  expect(control).toBeDisabled()
  expect(control.matches(':disabled')).toBe(true)
  expect(control.className).toContain('disabled:opacity-50')
  await act(async () => control.click())
  expect(onCheckedChange).not.toHaveBeenCalled()
  expect(control).toHaveAttribute('aria-checked', 'false')
})

it('keeps focusable disabled buttons focusable but visibly non-interactive', async () => {
  const onClick = vi.fn()
  await act(async () => root.render(<Button onClick={onClick}>Retry</Button>))
  const control = container.querySelector('button') as HTMLButtonElement
  control.focus()
  await act(async () => {
    root.render(
      <Button disabled focusableWhenDisabled onClick={onClick}>
        Retry
      </Button>
    )
  })
  expect(document.activeElement).toBe(control)
  expect(control).not.toHaveAttribute('disabled')
  expect(control).toHaveAttribute('aria-disabled', 'true')
  expect(control).toHaveAttribute('data-disabled')
  expect(control.className).toContain('data-[disabled]:opacity-50')
  expect(control.className).toContain('data-[disabled]:pointer-events-none')
  await act(async () => control.click())
  expect(onClick).not.toHaveBeenCalled()

  for (const variant of [
    'default',
    'destructive',
    'outline',
    'secondary',
    'ghost',
    'link',
  ] as const) {
    const classes = buttonVariants({ variant })
    expect(classes).toContain('[&:not([data-disabled])]:hover:')
    expect(classes.split(' ').some((className) => className.startsWith('hover:'))).toBe(false)
  }
})

it('preserves cancellable backdrop dismissal and focus restoration', async () => {
  let cancelClose = true
  const onOpenChange = vi.fn<NonNullable<ComponentProps<typeof AlertDialog>['onOpenChange']>>(
    (open, eventDetails) => {
      if (!open && cancelClose) eventDetails.cancel()
    }
  )
  await act(async () => {
    root.render(
      <AlertDialog onOpenChange={onOpenChange}>
        <AlertDialogTrigger>Open</AlertDialogTrigger>
        <AlertDialogContent hideCloseButton>
          <AlertDialogTitle>Confirm</AlertDialogTitle>
          <button id='inside-alert' type='button'>
            Inside
          </button>
        </AlertDialogContent>
      </AlertDialog>
    )
  })
  const trigger = container.querySelector('button') as HTMLButtonElement
  await act(async () => {
    trigger.focus()
    trigger.click()
  })
  const backdrop = document.querySelector('[data-slot="alert-dialog-backdrop"]') as HTMLDivElement
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  onOpenChange.mockClear()
  expect(backdrop.getAttribute('role')).toBe('presentation')
  expect(backdrop.hasAttribute('tabindex')).toBe(false)
  await act(async () => document.getElementById('inside-alert')?.click())
  expect(onOpenChange).not.toHaveBeenCalled()
  await act(async () => backdrop.click())
  expect(onOpenChange.mock.calls[0]?.[0]).toBe(false)
  expect(backdrop.isConnected).toBe(true)
  cancelClose = false
  onOpenChange.mockClear()
  await act(async () => backdrop.click())
  await act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
  )
  expect(onOpenChange.mock.calls[0]?.[0]).toBe(false)
  expect(onOpenChange.mock.calls[0]?.[1].reason).toBe('outside-press')
  expect(document.activeElement).toBe(trigger)
})

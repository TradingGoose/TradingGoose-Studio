'use client'

import * as React from 'react'

type HeaderSlotContent = React.ReactNode | React.ReactNode[]

export type GlobalNavbarHeaderSlots = {
  left?: HeaderSlotContent
  center?: HeaderSlotContent
  right?: HeaderSlotContent
}

interface GlobalNavbarHeaderContextValue {
  slots: GlobalNavbarHeaderSlots | null
  setSlots: (slots: GlobalNavbarHeaderSlots | null) => void
}

const GlobalNavbarHeaderContext = React.createContext<GlobalNavbarHeaderContextValue | null>(null)

export function useGlobalNavbarHeaderContext() {
  const context = React.useContext(GlobalNavbarHeaderContext)
  if (!context) {
    throw new Error('useGlobalNavbarHeaderContext must be used within GlobalNavbarHeaderProvider')
  }
  return context
}

export function GlobalNavbarHeaderProvider({ children }: { children: React.ReactNode }) {
  const [slots, setSlots] = React.useState<GlobalNavbarHeaderSlots | null>(null)

  const contextValue = React.useMemo(
    () => ({
      slots,
      setSlots,
    }),
    [slots]
  )

  return (
    <GlobalNavbarHeaderContext.Provider value={contextValue}>
      {children}
    </GlobalNavbarHeaderContext.Provider>
  )
}

export function GlobalNavbarHeader(props: GlobalNavbarHeaderSlots) {
  const { setSlots } = useGlobalNavbarHeaderContext()

  const slots = React.useMemo(
    () => ({
      left: props.left,
      center: props.center,
      right: props.right,
    }),
    [props.left, props.center, props.right]
  )

  React.useEffect(() => {
    setSlots(slots)
    return () => setSlots(null)
  }, [slots, setSlots])

  return null
}

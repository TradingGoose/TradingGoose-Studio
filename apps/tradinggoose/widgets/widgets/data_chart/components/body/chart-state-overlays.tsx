'use client'

type ChartStateOverlaysProps = {
  missingMessage: string | null
  chartError: string | null
  chartWarnings: string[]
}

export const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

export const ChartStateOverlays = ({
  missingMessage,
  chartError,
  chartWarnings,
}: ChartStateOverlaysProps) => (
  <>
    {missingMessage ? (
      <div className='absolute inset-0 z-20 flex items-center justify-center bg-background/80'>
        <WidgetStateMessage message={missingMessage} />
      </div>
    ) : chartError ? (
      <div className='absolute inset-x-0 top-2 z-20 flex justify-center px-4'>
        <div className='rounded-md border border-destructive bg-background/40 px-3 py-2 font-semibold text-destructive text-xs shadow-sm backdrop-blur'>
          {chartError}
        </div>
      </div>
    ) : null}
    {chartWarnings.length > 0 ? (
      <div className='absolute inset-x-0 bottom-10 z-20 flex justify-center px-4'>
        <div className='rounded-sm border border-border bg-background/40 px-3 py-2 font-semibold text-muted-foreground text-xs shadow-sm backdrop-blur'>
          {chartWarnings[0]}
        </div>
      </div>
    ) : null}
  </>
)

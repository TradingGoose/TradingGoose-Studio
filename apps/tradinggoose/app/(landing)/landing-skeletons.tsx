import { Skeleton } from '@/components/ui/skeleton'

function PreviewFrame({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border border-border/60 bg-card/40 p-4 ${className ?? ''}`}>
      {children}
    </div>
  )
}

function IntroSkeleton({ centered = false }: { centered?: boolean }) {
  return (
    <div className={centered ? 'mx-auto max-w-3xl text-center' : 'space-y-4'}>
      <Skeleton className={centered ? 'mx-auto h-3 w-24' : 'h-3 w-24'} />
      <Skeleton className={centered ? 'mx-auto mt-5 h-10 w-80 max-w-full' : 'h-10 w-80 max-w-full'} />
      <div className={centered ? 'mx-auto mt-4 max-w-2xl space-y-3' : 'space-y-3'}>
        <Skeleton className='h-5 w-full' />
        <Skeleton className='h-5 w-11/12' />
      </div>
    </div>
  )
}

function BulletSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className='space-y-3.5'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className='flex items-center gap-3'>
          <Skeleton className='h-px w-4 shrink-0 rounded-none' />
          <Skeleton className='h-4 w-full max-w-md' />
        </div>
      ))}
    </div>
  )
}

export function HowItWorksSkeleton() {
  return (
    <section className='mt-24 py-8 sm:mt-32 sm:py-16 lg:mt-60 lg:py-24'>
      <div className='mx-auto px-4 sm:px-6 lg:px-24'>
        <div className='grid grid-cols-1 gap-12 lg:grid-cols-2 xl:gap-16'>
          <IntroSkeleton />

          <PreviewFrame className='h-96 sm:h-80'>
            <div className='space-y-3'>
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className='flex items-center gap-4 rounded-lg border border-border/50 bg-background/60 p-4'
                >
                  <Skeleton className='size-10 rounded-lg' />
                  <div className='min-w-0 flex-1 space-y-2'>
                    <Skeleton className='h-4 w-32' />
                    <Skeleton className='h-4 w-full' />
                  </div>
                </div>
              ))}
            </div>
          </PreviewFrame>
        </div>
      </div>
    </section>
  )
}

export function MonitorSectionSkeleton() {
  return (
    <section className='py-8 sm:py-16 lg:py-24'>
      <div className='mx-auto px-4 sm:px-6 lg:px-24'>
        <div className='grid grid-cols-1 gap-12 lg:grid-cols-2 xl:gap-16'>
          <div className='order-2 flex items-center lg:order-1'>
            <PreviewFrame className='min-h-[420px] w-full'>
              <div className='space-y-3'>
                <div className='grid grid-cols-[1.3fr,0.7fr,0.9fr] gap-3'>
                  <Skeleton className='h-5 w-full' />
                  <Skeleton className='h-5 w-full' />
                  <Skeleton className='h-5 w-full' />
                </div>
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className='grid grid-cols-[1.3fr,0.7fr,0.9fr] gap-3'>
                    <Skeleton className='h-14 w-full' />
                    <Skeleton className='h-14 w-full' />
                    <Skeleton className='h-14 w-full' />
                  </div>
                ))}
              </div>
            </PreviewFrame>
          </div>

          <div className='order-1 space-y-4 lg:order-2'>
            <IntroSkeleton />
            <BulletSkeletons />
          </div>
        </div>
      </div>
    </section>
  )
}

function FeatureRowSkeleton({ previewLeft }: { previewLeft: boolean }) {
  const contentOrder = previewLeft ? 'order-1 lg:order-2' : 'order-1 lg:order-1'
  const previewOrder = previewLeft ? 'order-2 lg:order-1' : 'order-2 lg:order-2'

  return (
    <div className='grid items-start gap-4 lg:h-[70vh] lg:min-h-[50vh] lg:grid-cols-5 lg:gap-6 xl:gap-10'>
      <div className={`${contentOrder} m-1 lg:col-span-2`}>
        <PreviewFrame className='flex h-full min-h-[320px] flex-col justify-between p-6'>
          <div className='space-y-4'>
            <div className='flex items-center gap-3'>
              <Skeleton className='size-11 rounded-lg' />
              <Skeleton className='h-3 w-24' />
            </div>
            <Skeleton className='h-8 w-56 max-w-full' />
            <div className='space-y-3'>
              <Skeleton className='h-5 w-full' />
              <Skeleton className='h-5 w-11/12' />
            </div>
          </div>
          <BulletSkeletons />
        </PreviewFrame>
      </div>

      <div className={`${previewOrder} flex h-[60vh] min-h-[560px] w-full lg:col-span-3`}>
        <PreviewFrame className='h-full w-full'>
          <div className='grid h-full grid-cols-2 gap-4'>
            <Skeleton className='h-full w-full rounded-md' />
            <div className='grid gap-4'>
              <Skeleton className='h-full w-full rounded-md' />
              <Skeleton className='h-full w-full rounded-md' />
            </div>
          </div>
        </PreviewFrame>
      </div>
    </div>
  )
}

export function FeatureSkeleton() {
  return (
    <section id='feature' className='relative isolate w-full overflow-hidden py-20 sm:py-28' aria-label='Feature'>
      <div className='px-4 sm:px-6 lg:px-20 xl:px-24'>
        <IntroSkeleton centered />

        <div className='mt-24 space-y-24 lg:mt-32 lg:space-y-56'>
          <FeatureRowSkeleton previewLeft />
          <FeatureRowSkeleton previewLeft={false} />
          <FeatureRowSkeleton previewLeft />
        </div>
      </div>
    </section>
  )
}

export function IntegrationsSkeleton() {
  return (
    <section id='integrations' className='py-8 sm:py-16 lg:py-24'>
      <div className='mx-auto px-4 sm:px-6 lg:px-48'>
        <div className='flex items-start justify-between gap-12 max-md:flex-col sm:gap-16 lg:gap-24'>
          <PreviewFrame className='w-full max-w-xl p-6'>
            <div className='space-y-4'>
              <Skeleton className='h-3 w-24' />
              <Skeleton className='h-10 w-72 max-w-full' />
              <div className='space-y-3 pt-10'>
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-11/12' />
                <Skeleton className='h-4 w-10/12' />
              </div>
            </div>
          </PreviewFrame>

          <div className='grid shrink-0 grid-cols-4 gap-4'>
            {Array.from({ length: 24 }, (_, index) => (
              <Skeleton key={index} className='size-20 rounded-full' />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export function LandingPricingSkeleton() {
  return (
    <section id='pricing' className='relative isolate w-full py-20 sm:py-28' aria-label='Pricing'>
      <div className='mx-auto w-full px-4 sm:px-6 lg:px-16 xl:px-20'>
        <IntroSkeleton centered />

        <div className='mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:mt-20 xl:grid-cols-4'>
          {Array.from({ length: 4 }, (_, index) => (
            <PreviewFrame key={index} className='flex h-full flex-col gap-6 p-6'>
              <div className='space-y-4'>
                <Skeleton className='h-8 w-28' />
                <Skeleton className='h-14 w-36' />
                <div className='space-y-3'>
                  <Skeleton className='h-4 w-full' />
                  <Skeleton className='h-4 w-10/12' />
                </div>
              </div>
              <Skeleton className='h-11 w-full' />
              <div className='space-y-3'>
                {Array.from({ length: 5 }, (_, featureIndex) => (
                  <div key={featureIndex} className='flex items-center gap-2'>
                    <Skeleton className='size-3 rounded-full' />
                    <Skeleton className='h-4 w-full' />
                  </div>
                ))}
              </div>
            </PreviewFrame>
          ))}
        </div>
      </div>
    </section>
  )
}

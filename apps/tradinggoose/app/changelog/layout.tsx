import PublicNav from '@/app/(landing)/components/nav/public-nav'

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex min-h-dvh flex-col bg-background font-geist-sans text-foreground'>
      <PublicNav />
      <div className='flex-1'>{children}</div>
    </div>
  )
}

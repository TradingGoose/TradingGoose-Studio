import Nav from '@/app/(landing)/components/nav/nav'

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex min-h-dvh flex-col bg-background font-geist-sans text-foreground'>
      <Nav />
      <div className='flex-1'>{children}</div>
    </div>
  )
}

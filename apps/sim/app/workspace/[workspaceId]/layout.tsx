import Providers from '@/app/workspace/[workspaceId]/providers/providers'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className='flex h-full w-full bg-background'>
        <div className='flex min-h-0 min-w-0 flex-1 flex-col '>{children}</div>
      </div>
    </Providers>
  )
}

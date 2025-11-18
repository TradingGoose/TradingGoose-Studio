import Providers from '@/app/workspace/[workspaceId]/providers/providers'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className='flex h-full w-full  bg-background'>
        <div className='flex flex-1 min-h-0 min-w-0 flex-col '>{children}</div>
      </div>
    </Providers>
  )
}

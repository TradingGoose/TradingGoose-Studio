export default function FilterSection({
  title,
  content,
  emptyMessage,
}: {
  title: string
  content?: React.ReactNode
  emptyMessage?: string
}) {
  return (
    <div className='space-y-1'>
      <div className='font-medium text-muted-foreground text-xs'>{title}</div>
      <div>
        {content || (
          <div className='text-muted-foreground text-sm'>
            {emptyMessage || `Filter options for ${title} will go here`}
          </div>
        )}
      </div>
    </div>
  )
}

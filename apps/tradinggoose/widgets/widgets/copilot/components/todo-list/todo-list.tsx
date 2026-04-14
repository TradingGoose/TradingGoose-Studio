'use client'

import { memo, useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ListTodo, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TodoItem {
  id: string
  content: string
  completed?: boolean
  executing?: boolean
}

interface TodoListProps {
  todos: TodoItem[]
  onClose?: () => void
  collapsed?: boolean
  className?: string
}

export const TodoList = memo(function TodoList({
  todos,
  onClose,
  collapsed = false,
  className,
}: TodoListProps) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed)

  // Sync collapsed prop with internal state
  useEffect(() => {
    setIsCollapsed(collapsed)
  }, [collapsed])

  if (!todos || todos.length === 0) {
    return null
  }

  const completedCount = todos.filter((todo) => todo.completed).length
  const totalCount = todos.length
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  return (
    <div
      className={cn('border-neutral-200 rounded-md border-t dark:border-neutral-700 dark:bg-neutral-900', className)}
    >
      {/* Header */}
      <div className='flex rounded-md items-center justify-between border-neutral-100 border-b px-3 py-2 dark:border-neutral-800'>
        <div className='flex items-center gap-1'>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className='rounded p-0.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            {isCollapsed ? (
              <ChevronRight className='h-4 w-4 text-neutral-500' />
            ) : (
              <ChevronDown className='h-4 w-4 text-neutral-500' />
            )}
          </button>
          <ListTodo className='h-4 w-4 text-neutral-500' />
          <span className='font-medium text-neutral-700 text-xs dark:text-neutral-300'>Todo List</span>
          <span className='text-neutral-500 text-xs dark:text-neutral-400'>
            {completedCount}/{totalCount}
          </span>
        </div>

        <div className='flex items-center gap-1'>
          {/* Progress bar */}
          <div className='h-1.5 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700'>
            <div
              className='h-full bg-primary transition-all duration-300 ease-out'
              style={{ width: `${progress}%` }}
            />
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className='rounded p-1 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800'
              aria-label='Close todo list'
            >
              <X className='h-3.5 w-3.5 text-neutral-400' />
            </button>
          )}
        </div>
      </div>

      {/* Todo items */}
      {!isCollapsed && (
        <div className='max-h-48 overflow-y-auto rounded-b-md'>
          {todos.map((todo, index) => (
            <div
              key={todo.id}
              className={cn(
                'flex items-start gap-2 px-3 py-1.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                index !== todos.length - 1 && 'border-neutral-50 border-b dark:border-neutral-800'
              )}
            >
              {todo.executing ? (
                <div className='mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                  <Loader2 className='h-3 w-3 animate-spin text-primary' />
                </div>
              ) : (
                <div
                  className={cn(
                    'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-all',
                    todo.completed
                      ? 'border-primary bg-primary text-black'
                      : 'border-neutral-300 dark:border-neutral-600'
                  )}
                >
                  {todo.completed ? <Check className='h-3 w-3 text-black' strokeWidth={3} /> : null}
                </div>
              )}

              <span
                className={cn(
                  'flex-1 text-xs leading-relaxed',
                  todo.completed ? 'text-neutral-400 line-through' : 'text-neutral-700 dark:text-neutral-300'
                )}
              >
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

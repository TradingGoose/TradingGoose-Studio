import '@trigger.dev/sdk'

declare module '@trigger.dev/sdk' {
  export function defineConfig(config: {
    project: string
    runtime: 'node'
    logLevel?: string
    retries?: unknown
    dirs?: string[]
    build?: unknown
  }): unknown

  export const timeout: {
    None: number
  }
}

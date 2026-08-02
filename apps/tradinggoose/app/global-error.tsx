'use client'

export default function GlobalError({ unstable_retry }: { unstable_retry: () => void }) {
  return (
    <html lang='en'>
      <body style={{ margin: 0 }}>
        <main
          role='alert'
          style={{
            alignItems: 'center',
            display: 'flex',
            minHeight: '100vh',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div style={{ maxWidth: '480px', textAlign: 'center' }}>
            <h1>Something went wrong</h1>
            <p>We could not load this page. Please try again.</p>
            <button type='button' onClick={unstable_retry}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}

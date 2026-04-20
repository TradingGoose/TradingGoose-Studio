import { type NextRequest, NextResponse } from 'next/server'
import { getBaseUrl } from '@/lib/urls/utils'

export const dynamic = 'force-dynamic'

const INLINE_SCRIPT_ESCAPE_PATTERN = /[<>&\u2028\u2029]/g

const INLINE_SCRIPT_ESCAPES: Record<string, string> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

function getSafeCallbackURL(request: NextRequest) {
  const fallback = new URL('/', getBaseUrl())
  const rawCallbackURL = request.nextUrl.searchParams.get('callbackURL')

  if (!rawCallbackURL) {
    return fallback
  }

  try {
    const callbackURL = new URL(rawCallbackURL, fallback.origin)
    return callbackURL.origin === fallback.origin ? callbackURL : fallback
  } catch {
    return fallback
  }
}

function serializeForInlineScript(value: string) {
  return JSON.stringify(value).replace(
    INLINE_SCRIPT_ESCAPE_PATTERN,
    (character) => INLINE_SCRIPT_ESCAPES[character] ?? character
  )
}

function renderTrelloCallbackPage({ callbackURL, state }: { callbackURL: URL; state: string }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connecting Trello...</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
    </style>
  </head>
  <body>
    <p id="status">Connecting Trello...</p>
    <script>
      const callbackURL = new URL(${serializeForInlineScript(callbackURL.toString())});
      const state = ${serializeForInlineScript(state)};
      const statusEl = document.getElementById('status');

      function redirect(params) {
        const redirectURL = new URL(callbackURL.toString());
        for (const [key, value] of Object.entries(params)) {
          redirectURL.searchParams.set(key, value);
        }
        window.location.replace(redirectURL.toString());
      }

      (async function connectTrello() {
        const fragment = window.location.hash.startsWith('#')
          ? window.location.hash.slice(1)
          : window.location.hash;
        const hashParams = new URLSearchParams(fragment);
        const token = hashParams.get('token')?.trim();
        const error = hashParams.get('error')?.trim();

        window.history.replaceState(null, '', window.location.pathname + window.location.search);

        if (error || !token || !state) {
          redirect({ error: error || 'trello_authorization_failed' });
          return;
        }

        statusEl.textContent = 'Saving your connection...';

        try {
          const response = await fetch('/api/auth/trello/store', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ token, state }),
          });

          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error || 'Unable to connect Trello');
          }

          redirect({ trello_connected: '1' });
        } catch (saveError) {
          const message = saveError instanceof Error ? saveError.message : 'Unable to connect Trello';
          redirect({
            error: 'trello_connection_failed',
            error_description: message,
          });
        }
      })();
    </script>
  </body>
</html>`
}

export async function GET(request: NextRequest) {
  const callbackURL = getSafeCallbackURL(request)
  const state = request.nextUrl.searchParams.get('state')?.trim() || ''

  return new NextResponse(renderTrelloCallbackPage({ callbackURL, state }), {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

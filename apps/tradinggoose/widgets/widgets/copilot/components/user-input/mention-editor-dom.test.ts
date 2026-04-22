/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'
import { buildMentionEditorSegments } from './mention-editor-dom'

describe('mention-editor-dom', () => {
  it('builds inline editor segments that replace mention ranges with chip segments', () => {
    expect(
      buildMentionEditorSegments('hello @default-agent world', [
        {
          start: 6,
          end: 20,
          label: 'default-agent',
        },
      ])
    ).toEqual([
      { type: 'text', key: 'text-0-0-6', text: 'hello ' },
      {
        type: 'mention',
        key: 'mention-0-6-20',
        text: '@default-agent',
      },
      { type: 'text', key: 'tail-20', text: ' world' },
    ])
  })
})

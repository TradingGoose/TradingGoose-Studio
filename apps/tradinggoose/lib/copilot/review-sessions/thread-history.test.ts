import { describe, expect, it } from 'vitest'
import {
  buildAppendReviewTurn,
  deriveReviewTurnsAndItems,
  MESSAGE_ROLES,
} from '@/lib/copilot/review-sessions/thread-history'

describe('thread-history', () => {
  it('derives turn boundaries from user-led flat message history', () => {
    const history = deriveReviewTurnsAndItems('review-session-1', [
      {
        id: 'message-1',
        role: MESSAGE_ROLES.USER,
        content: 'First prompt',
        timestamp: '2026-03-30T12:00:00.000Z',
      },
      {
        id: 'message-2',
        role: MESSAGE_ROLES.ASSISTANT,
        content: 'First answer',
        timestamp: '2026-03-30T12:00:01.000Z',
      },
      {
        id: 'message-3',
        role: MESSAGE_ROLES.USER,
        content: 'Second prompt',
        timestamp: '2026-03-30T12:00:02.000Z',
      },
    ])

    expect(history.turns).toHaveLength(2)
    expect(history.turns[0]).toMatchObject({
      sessionId: 'review-session-1',
      sequence: 0,
      userMessageItemId: 'message-1',
    })
    expect(history.turns[1]).toMatchObject({
      sessionId: 'review-session-1',
      sequence: 1,
      userMessageItemId: 'message-3',
    })
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'message-1',
          sequence: 0,
          messageRole: 'user',
        }),
        expect.objectContaining({
          itemId: 'message-2',
          sequence: 1,
          messageRole: 'assistant',
        }),
        expect.objectContaining({
          itemId: 'message-3',
          sequence: 2,
          messageRole: 'user',
        }),
      ])
    )
  })

  it('appends a new turn after the existing message history', () => {
    const nextTurn = buildAppendReviewTurn({
      reviewSessionId: 'review-session-1',
      existingMessages: [
        {
          id: 'message-1',
          role: MESSAGE_ROLES.USER,
          content: 'First prompt',
          timestamp: '2026-03-30T12:00:00.000Z',
        },
        {
          id: 'message-2',
          role: MESSAGE_ROLES.ASSISTANT,
          content: 'First answer',
          timestamp: '2026-03-30T12:00:01.000Z',
        },
      ],
      userMessage: {
        id: 'message-3',
        role: MESSAGE_ROLES.USER,
        content: 'Second prompt',
        timestamp: '2026-03-30T12:00:02.000Z',
      },
      assistantMessage: {
        id: 'message-4',
        role: MESSAGE_ROLES.ASSISTANT,
        content: 'Second answer',
        timestamp: '2026-03-30T12:00:03.000Z',
      },
    })

    expect(nextTurn.turn).toMatchObject({
      sessionId: 'review-session-1',
      sequence: 1,
      userMessageItemId: 'message-3',
    })
    expect(nextTurn.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'message-3',
          sequence: 2,
          messageRole: 'user',
        }),
        expect.objectContaining({
          itemId: 'message-4',
          sequence: 3,
          messageRole: 'assistant',
        }),
      ])
    )
  })
})

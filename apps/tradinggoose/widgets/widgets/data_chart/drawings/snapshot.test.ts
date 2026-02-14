import { describe, expect, it } from 'vitest'
import {
  decodeManualOwnerSnapshot,
  encodeManualOwnerSnapshot,
  mergeManualOwnerSnapshots,
} from '@/widgets/widgets/data_chart/drawings/snapshot'

describe('manual-line-tools-snapshot', () => {
  it('encodes only minimal editable options', () => {
    const encoded = encodeManualOwnerSnapshot([
      {
        id: 'text-1',
        toolType: 'Text',
        points: [{ timestamp: 1770750300, price: 419.08112764035917 }],
        options: {
          visible: true,
          editable: true,
          line: { color: '#ff0000' },
          input: { border: { width: 10 } },
          text: {
            value: 'Text',
            font: { size: 14 },
          },
        },
      } as any,
      {
        id: 'line-1',
        toolType: 'TrendLine',
        points: [
          { timestamp: 1770750300, price: 419.08 },
          { timestamp: 1770750360, price: 420.01 },
        ],
        options: {
          visible: false,
          line: { color: '#00ff00' },
        },
      } as any,
    ])

    expect(encoded).not.toBeNull()
    if (!encoded) {
      throw new Error('Expected encoded snapshot')
    }

    expect(encoded).toEqual({
      tools: [
        {
          id: 'text-1',
          toolType: 'Text',
          points: [{ timestamp: 1770750300, price: 419.08112764035917 }],
          options: {
            text: {
              value: 'Text',
            },
          },
        },
        {
          id: 'line-1',
          toolType: 'TrendLine',
          points: [
            { timestamp: 1770750300, price: 419.08 },
            { timestamp: 1770750360, price: 420.01 },
          ],
          options: {
            visible: false,
          },
        },
      ],
    })
  })

  it('rejects raw array snapshots', () => {
    const rawSnapshot = [
      {
        id: 'callout-1',
        toolType: 'Callout',
        points: [
          { timestamp: 1770750300, price: 419.08 },
          { timestamp: 1770750360, price: 420.01 },
        ],
        options: {
          visible: false,
          text: { value: 'Note' },
        },
      },
    ]

    expect(decodeManualOwnerSnapshot(rawSnapshot)).toEqual([])
  })

  it('decodes snapshots and drops invalid entries', () => {
    const snapshot = {
      tools: [
        {
          id: 'trend-1',
          toolType: 'TrendLine',
          points: [
            { timestamp: 1770750300, price: 419.08 },
            { timestamp: 1770750360, price: 420.01 },
          ],
          options: {
            text: {
              value: 'Center note',
            },
            input: {
              alignment: { vertical: 'middle', horizontal: 'center' },
            },
            line: {
              color: '#112233',
            },
          },
        },
        {
          id: 'invalid-1',
          toolType: 'Text',
          points: [],
          options: {
            text: { value: 'skip me' },
          },
        },
      ],
    }

    expect(decodeManualOwnerSnapshot(snapshot)).toEqual([
      {
        id: 'trend-1',
        toolType: 'TrendLine',
        points: [
          { timestamp: 1770750300, price: 419.08 },
          { timestamp: 1770750360, price: 420.01 },
        ],
        options: {
          text: {
            value: 'Center note',
          },
        },
      },
    ])
  })

  it('ignores input payloads', () => {
    const snapshot = {
      tools: [
        {
          id: 'text-1',
          toolType: 'Text',
          points: [{ timestamp: 1770750300, price: 419.08 }],
          options: {
            input: {
              alignment: { vertical: 'middle', horizontal: 'center' },
            },
            text: {
              value: 'Note',
              input: {
                border: { width: 99 },
              },
            },
          },
        },
      ],
    }

    expect(decodeManualOwnerSnapshot(snapshot)).toEqual([
      {
        id: 'text-1',
        toolType: 'Text',
        points: [{ timestamp: 1770750300, price: 419.08 }],
        options: {
          text: {
            value: 'Note',
          },
        },
      },
    ])
  })

  it('returns empty data for malformed snapshot strings', () => {
    expect(decodeManualOwnerSnapshot('not-json')).toEqual([])
  })

  it('normalizes millisecond timestamps to seconds', () => {
    const snapshot = {
      tools: [
        {
          id: 'trend-ms',
          toolType: 'TrendLine',
          points: [
            { timestamp: 1770750300000, price: 419.08 },
            { timestamp: 1770750360000, price: 420.01 },
          ],
        },
      ],
    }

    expect(decodeManualOwnerSnapshot(snapshot)).toEqual([
      {
        id: 'trend-ms',
        toolType: 'TrendLine',
        points: [
          { timestamp: 1770750300, price: 419.08 },
          { timestamp: 1770750360, price: 420.01 },
        ],
        options: {},
      },
    ])
  })

  it('merges snapshots by tool id while preserving existing tools', () => {
    const pending = {
      tools: [
        {
          id: 'old-tool',
          toolType: 'Rectangle',
          points: [
            { timestamp: 1770750300, price: 419.08 },
            { timestamp: 1770750360, price: 420.01 },
          ],
        },
      ],
    }
    const exported = {
      tools: [
        {
          id: 'new-tool',
          toolType: 'TrendLine',
          points: [
            { timestamp: 1770750400, price: 430.08 },
            { timestamp: 1770750460, price: 431.01 },
          ],
        },
      ],
    }

    expect(mergeManualOwnerSnapshots(pending, exported)).toEqual({
      tools: [
        {
          id: 'old-tool',
          toolType: 'Rectangle',
          points: [
            { timestamp: 1770750300, price: 419.08 },
            { timestamp: 1770750360, price: 420.01 },
          ],
        },
        {
          id: 'new-tool',
          toolType: 'TrendLine',
          points: [
            { timestamp: 1770750400, price: 430.08 },
            { timestamp: 1770750460, price: 431.01 },
          ],
        },
      ],
    })
  })
})

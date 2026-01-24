import { registerOverlay } from 'klinecharts'

let registered = false

export const ensureSignalOverlayRegistered = () => {
  if (registered) return
  registered = true

  registerOverlay({
    name: 'signalTag',
    totalStep: 1,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (!coordinates[0]) return []

      const x = coordinates[0].x
      const signalY = coordinates[0].y
      const anchorY = coordinates[1] ? coordinates[1].y : signalY

      const extendData = (overlay.extendData ?? {}) as Record<string, unknown>
      const textRaw = extendData.text
      const text = typeof textRaw === 'string' ? textRaw : String(textRaw ?? '')
      const color = typeof extendData.color === 'string' ? extendData.color : '#555555'
      const side = extendData.side === 'sell' ? 'sell' : 'buy'
      const isBuy = side === 'buy'

      const boxPaddingX = 8
      const boxPaddingY = 4
      const fontSize = 12

      const textWidth = text.split('').reduce((total, char) => {
        const code = char.charCodeAt(0)
        return total + (code > 255 ? 12 : 7)
      }, 0)

      const boxWidth = textWidth + boxPaddingX * 2
      const boxHeight = fontSize + boxPaddingY * 2
      const boxY = isBuy ? signalY : signalY - boxHeight

      const circleY = anchorY
      const lineStartY = circleY
      const lineEndY = isBuy ? boxY : boxY + boxHeight

      return [
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x, y: lineStartY },
              { x, y: lineEndY },
            ],
          },
          styles: { style: 'stroke', color, dashedValue: [2, 2] },
          ignoreEvent: true,
        },
        {
          type: 'circle',
          attrs: { x, y: circleY, r: 4 },
          styles: { style: 'fill', color },
          ignoreEvent: true,
        },
        {
          type: 'rect',
          attrs: {
            x: x - boxWidth / 2,
            y: boxY,
            width: boxWidth,
            height: boxHeight,
            r: 4,
          },
          styles: { style: 'fill', color, borderSize: 0 },
          ignoreEvent: true,
        },
        {
          type: 'text',
          attrs: {
            x,
            y: boxY + boxHeight / 2,
            text,
            align: 'center',
            baseline: 'middle',
          },
          styles: { color: '#ffffff', size: fontSize, weight: 'bold' },
          ignoreEvent: true,
        },
      ]
    },
  })
}

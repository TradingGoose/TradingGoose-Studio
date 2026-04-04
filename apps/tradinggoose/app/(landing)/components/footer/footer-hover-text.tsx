'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useCardGlow } from '@/app/(landing)/components/use-card-glow'
import { soehne } from '@/app/fonts/soehne/soehne'

interface FooterHoverTextProps {
  text: string
}

export default function FooterHoverText({ text }: FooterHoverTextProps) {
  const centerX = 500
  const centerY = 250
  const measureRef = useRef<SVGTextElement>(null)
  const [textScale, setTextScale] = useState(1)
  const [textBounds, setTextBounds] = useState({ top: 30, height: 180 })

  useCardGlow()

  useEffect(() => {
    let cancelled = false

    const measureText = async () => {
      await document.fonts.ready

      if (!measureRef.current || cancelled) {
        return
      }

      const bounds = measureRef.current.getBBox()

      if (!bounds.width) {
        return
      }

      const nextScale = 940 / bounds.width
      const scaledTop = centerY + (bounds.y - centerY) * nextScale
      const scaledHeight = bounds.height * nextScale

      setTextScale(nextScale)
      setTextBounds({ top: scaledTop - 60, height: scaledHeight })
    }

    void measureText()

    return () => {
      cancelled = true
    }
  }, [text])

  const textTransform = `translate(${centerX} ${centerY}) scale(${textScale}) translate(${-centerX} ${-centerY})`
  const visibleHeight = textBounds.height * 0.8
  const fullViewBox = `0 ${textBounds.top} 1000 ${textBounds.height}`

  const svgClassName = `${soehne.className} absolute inset-0 block h-full w-full select-none`

  return (
    <div className='w-full overflow-hidden' style={{ aspectRatio: `1000 / ${visibleHeight}` }}>
      <div
        className='card group relative w-full'
        style={{ aspectRatio: `1000 / ${textBounds.height}` }}
      >
        {/* Hidden measure text */}
        <svg
          viewBox='0 0 1000 280'
          className='absolute inset-0 w-full'
          style={{ visibility: 'hidden' }}
          aria-hidden='true'
        >
          <text
            ref={measureRef}
            x='500'
            y='250'
            textAnchor='middle'
            dominantBaseline='middle'
            className='fill-transparent font-semibold'
            style={{ fontSize: 132 }}
          >
            {text}
          </text>
        </svg>

        {/* Base layer: muted outline + stroke-dash draw-in */}
        <svg
          viewBox={fullViewBox}
          preserveAspectRatio='xMidYMid meet'
          role='img'
          aria-label={text}
          className={svgClassName}
        >
          <g transform={textTransform}>
            <text
              x='500'
              y='250'
              textAnchor='middle'
              dominantBaseline='middle'
              stroke='hsl(var(--foreground) / 0.16)'
              strokeWidth='0.5'
              className='fill-transparent font-semibold'
              style={{ fontSize: 132, opacity: 0.65 }}
            >
              {text}
            </text>

            <motion.text
              x='500'
              y='250'
              textAnchor='middle'
              dominantBaseline='middle'
              stroke='hsl(var(--foreground) / 0.18)'
              strokeWidth='0.5'
              className='fill-transparent font-semibold'
              style={{ fontSize: 132 }}
              initial={{ strokeDashoffset: 900, strokeDasharray: 900 }}
              animate={{ strokeDashoffset: 0, strokeDasharray: 900 }}
              transition={{ duration: 4, ease: 'easeInOut' }}
            >
              {text}
            </motion.text>
          </g>
        </svg>

        {/* Glow layer: cursor-following CSS mask using --shine-x / --shine-y */}
        <div
          className='pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100'
          style={{
            maskImage:
              'radial-gradient(circle at var(--shine-x, 50%) var(--shine-y, 50%), black 0%, black 5%, transparent 20%)',
            WebkitMaskImage:
              'radial-gradient(circle at var(--shine-x, 50%) var(--shine-y, 50%), black 0%, black 5%, transparent 20%)',
          }}
        >
          <svg
            viewBox={fullViewBox}
            preserveAspectRatio='xMidYMid meet'
            className={svgClassName}
            aria-hidden='true'
          >
            <g transform={textTransform}>
              <text
                x='500'
                y='250'
                textAnchor='middle'
                dominantBaseline='middle'
                stroke='hsl(var(--primary) / 0.3)'
                strokeWidth='0.5'
                fill='hsl(var(--primary) / 0.06)'
                className='font-semibold'
                style={{ fontSize: 132 }}
              >
                {text}
              </text>
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}

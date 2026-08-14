import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OptionsSelector, parseSpecialTags } from './options-selector'

describe('parseSpecialTags', () => {
  it('preserves escaped quotes and newlines in streaming options', () => {
    const parsed = parseSpecialTags(
      '<options>{"1":"Use \\"quoted\\"\\ntext","2":{"title":"Review \\"draft\\"\\nnow"'
    )

    expect(parsed.options).toEqual({
      '1': 'Use "quoted"\ntext',
      '2': { title: 'Review "draft"\nnow' },
    })
    expect(parsed.optionsComplete).toBe(false)
    expect(parsed.cleanContent).toBe('')
  })

  it('preserves double-escaped backslash sequences in streaming options', () => {
    const parsed = parseSpecialTags('<options>{"1":"Show \\\\n literally"')

    expect(parsed.options).toEqual({ '1': 'Show \\n literally' })
  })

  it('renders option labels as valid button content', () => {
    const markup = renderToStaticMarkup(
      createElement(OptionsSelector, {
        options: { '1': '[Review](https://example.com)' },
        onSelect: () => {},
      })
    )
    const buttonContent = markup.match(/<button[^>]*>([\s\S]*?)<\/button>/)?.[1]

    expect(buttonContent).not.toMatch(/<(?:a|button|div|p)\b/)
    expect(buttonContent).toContain('[Review](https://example.com)')
  })
})

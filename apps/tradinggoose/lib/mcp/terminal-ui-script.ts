/**
 * Dependency-free terminal UI primitives for the MCP installer.
 *
 * The installer is delivered as a standalone `curl | sh` script, so it cannot
 * require picocolors/ora/boxen/@inquirer/prompts. This module re-implements the
 * pieces the installer needs so the rendered output matches the Context7 CLI:
 * colored output, a spinner, a rounded box, and a multi-select checkbox prompt
 * with hover-fallback selection.
 *
 * The exported string is concatenated ahead of the installer body and executed
 * by node, so everything here must be plain CommonJS-compatible JS with no
 * imports beyond node core.
 */
export const MCP_TERMINAL_UI_SCRIPT = String.raw`const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const CTRL_C = String.fromCharCode(3)
const CSI = ESC + '['
const ANSI_PATTERN = new RegExp(ESC + '\\[[0-9;]*[A-Za-z]', 'g')
const OSC_PATTERN = new RegExp(ESC + '\\][^' + BEL + ']*' + BEL, 'g')
// Matches a single CSI or OSC-8 sequence anchored at the start of a slice.
const ESCAPE_AT_START = new RegExp('^(?:\\[[0-9;]*[A-Za-z]|\\][^' + BEL + ']*' + BEL + ')')

const SUPPORTS_COLOR = (function () {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true
  if (!process.stdout.isTTY) return false
  return process.env.TERM !== 'dumb'
})()

// TradingGoose brand yellow (#ffcc00). Truecolor terminals get the exact hex;
// 256-color terminals fall back to the nearest cube entry (220 = #ffd700) and
// everything else to plain ANSI yellow.
const COLOR_DEPTH = (function () {
  if (/truecolor|24bit/i.test(process.env.COLORTERM || '')) return 3
  if (/256/.test(process.env.TERM || '')) return 2
  return 1
})()
const BRAND_OPEN = COLOR_DEPTH === 3 ? '38;2;255;204;0' : COLOR_DEPTH === 2 ? '38;5;220' : '33'

const SUPPORTS_UNICODE =
  process.platform !== 'win32' ||
  Boolean(process.env.WT_SESSION) ||
  process.env.TERM_PROGRAM === 'vscode'

// picocolors-style nesting: re-open the outer style after any inner reset so
// pc.dim(pc.cyan(x)) does not lose the dim half-way through.
function paint(open, close) {
  const openCode = CSI + open + 'm'
  const closeCode = CSI + close + 'm'
  return function (input) {
    const text = String(input)
    if (!SUPPORTS_COLOR) return text
    const body = text.includes(closeCode) ? text.split(closeCode).join(closeCode + openCode) : text
    return openCode + body + closeCode
  }
}

const pc = {
  bold: paint('1', '22'),
  dim: paint('2', '22'),
  red: paint('31', '39'),
  brand: paint(BRAND_OPEN, '39'),
  yellow: paint('33', '39'),
  cyan: paint('36', '39'),
  gray: paint('90', '39'),
}

const symbols = SUPPORTS_UNICODE
  ? {
      tick: '✔',
      cross: '✖',
      warn: '⚠',
      pointer: '❯',
      checked: '◉',
      unchecked: '◯',
      topLeft: '╭',
      topRight: '╮',
      bottomLeft: '╰',
      bottomRight: '╯',
      horizontal: '─',
      vertical: '│',
    }
  : {
      tick: 'v',
      cross: 'x',
      warn: '!',
      pointer: '>',
      checked: '(*)',
      unchecked: '( )',
      topLeft: '+',
      topRight: '+',
      bottomLeft: '+',
      bottomRight: '+',
      horizontal: '-',
      vertical: '|',
    }

function visibleLength(text) {
  return String(text).replace(OSC_PATTERN, '').replace(ANSI_PATTERN, '').length
}

function padVisible(text, width) {
  return text + ' '.repeat(Math.max(0, width - visibleLength(text)))
}

function terminalWidth() {
  return process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80
}

/**
 * Hard-truncates to a visible width, copying escape sequences through without
 * counting them. The redraw in checkbox() moves the cursor up by a fixed line
 * count, so a line that soft-wraps would desynchronise it — every rendered line
 * is truncated to the terminal width to make wrapping impossible.
 */
function truncateVisible(text, width) {
  if (width <= 0) return ''
  if (visibleLength(text) <= width) return text

  const limit = Math.max(0, width - 1)
  let result = ''
  let visible = 0
  let index = 0

  while (index < text.length && visible < limit) {
    if (text[index] === ESC) {
      const rest = text.slice(index)
      const match = ESCAPE_AT_START.exec(rest.slice(1))
      if (match) {
        result += rest.slice(0, match[0].length + 1)
        index += match[0].length + 1
        continue
      }
    }
    result += text[index]
    visible++
    index++
  }

  return result + (SUPPORTS_UNICODE ? '…' : '...') + CSI + '0m'
}

/**
 * Renders a rounded box with an optional left-aligned title, matching the
 * boxen 'round' border style used by the Context7 login prompt. Content is
 * never wrapped: callers keep lines short enough to fit, and anything wider
 * than the terminal simply extends the box.
 */
function box(lines, options) {
  const opts = options || {}
  const color = opts.borderColor || pc.gray
  const contentWidth = Math.max.apply(
    null,
    [0].concat(lines.map(function (line) {
      return visibleLength(line)
    }))
  )
  const title = opts.title ? ' ' + opts.title + ' ' : ''
  const innerWidth = Math.max(contentWidth + 2, visibleLength(title) + 2)
  const topFill = Math.max(0, innerWidth - visibleLength(title) - 1)
  const top = color(
    symbols.topLeft + symbols.horizontal + title + symbols.horizontal.repeat(topFill) + symbols.topRight
  )
  const bottom = color(symbols.bottomLeft + symbols.horizontal.repeat(innerWidth) + symbols.bottomRight)
  const blank = color(symbols.vertical) + ' '.repeat(innerWidth) + color(symbols.vertical)

  const rendered = [top, blank]
  for (const line of lines) {
    rendered.push(color(symbols.vertical) + ' ' + padVisible(line, innerWidth - 2) + ' ' + color(symbols.vertical))
  }
  rendered.push(blank)
  rendered.push(bottom)
  return rendered.join('\n')
}

/** OSC 8 hyperlink; degrades to plain text on terminals that ignore it. */
function link(text, url) {
  if (!SUPPORTS_COLOR) return text
  return ESC + ']8;;' + url + BEL + text + ESC + ']8;;' + BEL
}

const log = {
  plain: function (message) {
    console.log(message)
  },
  blank: function () {
    console.log('')
  },
  dim: function (message) {
    console.log(pc.dim(message))
  },
  success: function (message) {
    console.log(pc.brand(symbols.tick + ' ') + message)
  },
  warn: function (message) {
    console.log(pc.yellow(symbols.warn + ' ') + message)
  },
  error: function (message) {
    console.log(pc.red(symbols.cross + ' ') + message)
  },
}

const SPINNER_FRAMES = SUPPORTS_UNICODE
  ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  : ['-', '\\', '|', '/']

/**
 * Minimal ora replacement. On a non-TTY it degrades to a single line per state
 * change so piped output stays readable.
 */
function spinner(initialText) {
  const stream = process.stdout
  const interactive = Boolean(stream.isTTY)
  let text = initialText
  let frame = 0
  let timer = null

  function clearLine() {
    stream.write('\r' + CSI + '2K')
  }

  function draw() {
    clearLine()
    stream.write(truncateVisible(pc.cyan(SPINNER_FRAMES[frame]) + ' ' + text, terminalWidth()))
    frame = (frame + 1) % SPINNER_FRAMES.length
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (interactive) clearLine()
  }

  function finish(symbol, message) {
    stop()
    console.log(symbol + ' ' + (message === undefined ? text : message))
  }

  const handle = {
    start: function () {
      if (!interactive) {
        console.log(pc.dim(text))
        return handle
      }
      stream.write(CSI + '?25l')
      draw()
      timer = setInterval(draw, 80)
      if (typeof timer.unref === 'function') timer.unref()
      return handle
    },
    setText: function (next) {
      text = next
      if (!interactive) console.log(pc.dim(next))
      return handle
    },
    succeed: function (message) {
      finish(pc.brand(symbols.tick), message)
      if (interactive) stream.write(CSI + '?25h')
      return handle
    },
    fail: function (message) {
      finish(pc.red(symbols.cross), message)
      if (interactive) stream.write(CSI + '?25h')
      return handle
    },
    stop: function () {
      stop()
      if (interactive) stream.write(CSI + '?25h')
      return handle
    },
  }

  return handle
}

/**
 * Multi-select prompt modelled on @inquirer/prompts checkbox as configured by
 * the Context7 CLI: green highlight, no looping at the list edges, and — when
 * the user confirms without checking anything — the hovered row is returned
 * instead of an empty selection.
 */
function checkbox(options) {
  const input = process.stdin
  const output = process.stdout
  const choices = options.choices
  const message = options.message
  const hint = pc.dim('(Press <space> to select, <a> to toggle all, <enter> to confirm)')

  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('An interactive terminal is required to choose targets.'))
  }

  return new Promise(function (resolve) {
    const selected = new Set()
    let cursor = 0
    let renderedLines = 0

    function answerLine(body) {
      return pc.brand('?') + ' ' + pc.bold(message) + ' ' + body
    }

    function buildFrame() {
      const lines = [pc.brand('?') + ' ' + pc.bold(message) + ' ' + hint]
      for (let index = 0; index < choices.length; index++) {
        const choice = choices[index]
        const active = index === cursor
        const marker = selected.has(index) ? pc.brand(symbols.checked) : pc.dim(symbols.unchecked)
        const pointer = active ? pc.brand(symbols.pointer) : ' '
        const label = active ? pc.brand(choice.name) : choice.name
        lines.push(pointer + marker + ' ' + label)
      }
      return lines
    }

    function render() {
      if (renderedLines > 0) output.write(CSI + renderedLines + 'A' + CSI + '0J')
      const width = terminalWidth()
      const lines = buildFrame().map(function (line) {
        return truncateVisible(line, width)
      })
      output.write(lines.join('\n') + '\n')
      renderedLines = lines.length
    }

    function teardown() {
      input.removeListener('data', onData)
      input.setRawMode(false)
      input.pause()
      output.write(CSI + '?25h')
    }

    function clearFrame() {
      if (renderedLines > 0) output.write(CSI + renderedLines + 'A' + CSI + '0J')
      renderedLines = 0
    }

    function confirm() {
      const picked =
        selected.size > 0
          ? Array.from(selected)
              .sort(function (a, b) {
                return a - b
              })
              .map(function (index) {
                return choices[index]
              })
          : [choices[cursor]]

      teardown()
      clearFrame()
      console.log(
        answerLine(
          pc.brand(
            picked
              .map(function (choice) {
                return choice.name
              })
              .join(', ')
          )
        )
      )
      resolve(
        picked.map(function (choice) {
          return choice.value
        })
      )
    }

    function onData(chunk) {
      const key = chunk.toString('utf8')

      if (key === CTRL_C) {
        teardown()
        output.write('\n')
        process.exit(130)
      }

      if (key === CSI + 'A' || key === 'k') {
        // loop: false — clamp at the edges rather than wrapping.
        cursor = Math.max(0, cursor - 1)
      } else if (key === CSI + 'B' || key === 'j') {
        cursor = Math.min(choices.length - 1, cursor + 1)
      } else if (key === ' ') {
        if (selected.has(cursor)) selected.delete(cursor)
        else selected.add(cursor)
      } else if (key === 'a') {
        if (selected.size === choices.length) {
          selected.clear()
        } else {
          for (let index = 0; index < choices.length; index++) selected.add(index)
        }
      } else if (key === '\r' || key === '\n') {
        confirm()
        return
      } else {
        return
      }

      render()
    }

    output.write(CSI + '?25l')
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
    render()
  })
}
`

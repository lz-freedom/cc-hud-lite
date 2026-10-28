import type { ClientModule } from 'claude-code'

import type { ChipsProps } from '../types'

/** Cells a run of text takes: two for East Asian wide characters, one for the rest. */
function cells(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    width += isWide ? 2 : 1
  }

  return width
}

/**
 * The toolbar's items, drawn as plain text so nothing lights or inverts under the pointer: a left
 * press on a pressable one posts its id, and the hooks module opens or closes that panel.
 */
const Chips: ClientModule<ChipsProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  const between = cells(props.separator)
  const spans: { id: string; from: number; to: number }[] = []
  let x = 0
  for (const chip of props.chips) {
    const width = chip.runs.reduce((sum, run) => sum + cells(run.text), 0)
    if (chip.pressable) {
      spans.push({ id: chip.id, from: x, to: x + width })
    }
    x += width + between
  }
  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left') {
      return
    }
    const hit = spans.find(span => event.x >= span.from && event.x < span.to)
    if (hit !== undefined) {
      surface.post({ press: hit.id })
    }
  })

  return (
    <Box flexDirection="row">
      {props.chips.flatMap((chip, i) => [
        ...(i > 0 ? [<Text dimColor>{props.separator}</Text>] : []),
        <Box key={`chip-${chip.id}`}>
          <Text>
            {chip.runs.map(run => (
              <Text {...(run.color === null ? {} : { color: run.color })} dimColor={run.dim} bold={run.bold}>
                {run.text}
              </Text>
            ))}
          </Text>
        </Box>,
      ])}
    </Box>
  )
}

export default Chips

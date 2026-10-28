import type { ClientModule } from 'claude-code'

import type { HitProps } from '../types'

/**
 * A press target that draws nothing: laid over a picture, which takes no presses, so a left press
 * there still reaches the hooks module as the chips' presses do.
 */
const Hit: ClientModule<HitProps> = (props, surface) => {
  const { Box } = surface.elements
  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') {
      surface.post({ press: props.press })
    }
  })

  return <Box width={props.columns} height={props.rows} />
}

export default Hit

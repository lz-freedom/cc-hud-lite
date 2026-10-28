import type { On, PromptEditInput, SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// A 1x1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg=='
/** A PNG of about `bytes` decoded bytes: the 1x1 one's signature and header, then zeros. */
function pngOf(bytes: number): string {
  return PNG.slice(0, 88) + 'AAAA'.repeat(Math.ceil((bytes - 66) / 3))
}

/** What a base64 source holds decoded, as the engine counts it against a drawing. */
function decoded(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0

  return Math.floor(base64.length / 4) * 3 - padding
}

// Where the toolbar's chips are drawn, and a chip's text there.
const CHIPS = { in: 'chips' } as const

const PLAN_TOOL = 'mcp__cc-hud-lite__update_plan'
const WRAP_TOOL = 'mcp__cc-hud-lite__wrap_up'

const TERMINAL = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

const BAND = {
  plugin: 'cc-hud-lite',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 30,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const IDLE = { ...BAND, props: { ...BAND.props, isWorking: false } }

// The hint line under the prompt, where the status line sits by default.
const HINT = {
  plugin: 'cc-hud-lite',
  component: 'PromptHint',
  requestId: 'hint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const COMPOSE = {
  model: 'opus',
  promptModel: 'opus',
  surfaces: ['terminal'],
  outputStyle: null,
  traits: [],
} as const

const PICKER = {
  options: [
    { model: 'gateway/claude-opus-5-5[1m]', label: 'Claude Opus 5.5 · gateway', description: 'via a gateway' },
    { model: 'gateway/claude-sonnet-5-5', label: 'Claude Sonnet 5.5 · gateway', description: 'via a gateway' },
  ],
}

const USAGE = {
  startedAt: 0,
  rateLimits: [],
  context: {
    tokens: 468_300,
    window: 1_000_000,
    percent: 47,
    breakdown: {
      categories: [
        { name: 'MCP tools', tokens: 261_700, color: 'promptBorder', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 173_200, color: 'claude', isDeferred: false, kind: 'used' },
        { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
        { name: 'Free space', tokens: 498_700, color: 'inactive', isDeferred: false, kind: 'free' },
      ],
      totalTokens: 468_300,
      maxTokens: 1_000_000,
      rawMaxTokens: 1_000_000,
      autocompactSource: 'model',
      percentage: 47,
      gridRows: [],
      model: 'opus',
      memoryFiles: [{ path: '/Users/me/.claude/CLAUDE.md', type: 'User', tokens: 1_500 }],
      mcpTools: [
        { name: 'mcp__files__read', serverName: 'files', tokens: 2_000, isLoaded: true },
        { name: 'mcp__files__write', serverName: 'files', tokens: 1_000, isLoaded: true },
        { name: 'mcp__search__web', serverName: 'search', tokens: 500, isLoaded: true },
      ],
      agents: [{ agentType: 'Explore', source: 'built-in', tokens: 300 }],
      autoCompactThreshold: 900_000,
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
} as unknown as SessionUsage

/**
 * What a session answers beneath the mod, with what the mod asked of it; `env` is its process
 * environment and `settings` what its settings hold besides the picker and effortLevel.
 */
function engine(on: On, env: Record<string, string> = {}, settings: Record<string, unknown> = {}, usage: SessionUsage = USAGE) {
  const seen = {
    tools: [] as string[],
    sent: [] as string[],
    ran: [] as string[],
    opened: [] as string[],
    closed: [] as string[],
    stored: {} as Record<string, unknown>,
    runs: [] as string[],
    copied: [] as string[],
    blits: 0,
  }
  // What git answers in /work: a branch one commit ahead of its upstream, two files changed.
  const repo = { status: '## main...origin/main [ahead 1]\n M a.ts\n?? b.ts\n' }
  // How large the scaled copies read back, decoded; 0 is the 1x1 PNG.
  const sizes = { view: 0, thumb: 0 }
  // The files sips and base64 wrote, which exist from then on.
  const files = new Set<string>()
  let model = 'gateway/claude-opus-5-5[1m]'
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', (_, e) => {
    seen.tools.push(e.name)

    return { value: { tool: `mcp__cc-hud-lite__${e.name}` } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.model', () => ({ value: model }))
  on('settings.read', () => ({ value: { modelPicker: PICKER, effortLevel: 'high', ...settings } }))
  on('session.usage', () => ({ value: usage }))
  on('prompt.submit', (_, e) => {
    seen.sent.push(e.text)

    return { text: e.text }
  })
  on('command.run', (_, e) => {
    seen.ran.push(`${e.command} ${e.args}`.trim())
    if (e.command === 'model') {
      model = e.args
    }

    return { text: '' }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' as const }] }))
  on('ui.blit', () => {
    seen.blits += 1

    return { value: {} }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('ui.open', (_, e) => {
    seen.opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_, e) => {
    seen.closed.push(e.id)

    return { value: undefined }
  })
  on('ui.panes', () => {
    const up = seen.opened.filter((id, i) => seen.closed.filter(one => one === id).length < seen.opened.slice(0, i + 1).filter(one => one === id).length)

    return { value: [...new Set(up)].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true as const })) }
  })
  on('store.get', (_, e) => ({ value: seen.stored[e.key] }))
  on('store.set', (_, e) => {
    seen.stored[e.key] = e.value

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    seen.runs.push(e.argv.join(' '))
    if (e.argv[0] === 'git') {
      const stdout = e.argv[1] === 'rev-parse' ? '/work\n' : repo.status

      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    for (const flag of ['--out', '-o']) {
      const at = e.argv.indexOf(flag)
      const path = at < 0 ? undefined : e.argv[at + 1]
      if (path !== undefined) {
        files.add(path)
      }
    }

    return {
      value: { exitCode: 0, stdout: 'pixelWidth: 1\npixelHeight: 1\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('session.cwd', () => ({ value: '/work' }))
  on('ui.copy', (_, e) => {
    seen.copied.push(e.text)

    return { value: { isCopied: true as const } }
  })
  on('fs.read', (_, e) => {
    const bytes = e.path.endsWith('.view.png') ? sizes.view : e.path.endsWith('.thumb.png') ? sizes.thumb : 0

    return { value: { base64: bytes > 0 ? pngOf(bytes) : PNG } }
  })
  mock.env(on, { HOME: '/Users/me', ...env })
  const clock = mock.clock(on)

  return { seen, clock, sizes, repo }
}

test('the band lists the plan and turns the running step', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start(TERMINAL)
  const first = await $.tool.call({
    tool: PLAN_TOOL,
    items: [
      { content: 'Read the config', status: 'in_progress' },
      { content: 'Write the mod', status: 'pending' },
    ],
  })
  expect(first.result).toBe('Plan shown: 0 of 2 steps done.')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: 'Read the config' }))?.props.bold).toBe(true)
  expect(await band.find({ type: 'Raster', key: 'spin' })).toBeDefined()
  await clock.advance(250)
  expect(seen.blits > 0).toBe(true)

  await $.tool.call({ tool: PLAN_TOOL, advance: true })
  expect((await band.find({ type: 'Text', text: 'Read the config' }))?.props.dimColor).toBe(true)
  expect((await band.find({ type: 'Text', text: 'Write the mod' }))?.props.bold).toBe(true)
  await band.unmount()
})

test('a step update before any plan is refused with what to send', async ($, on) => {
  engine(on)
  await $.session.start(TERMINAL)
  const refused = await $.tool.call({ tool: PLAN_TOOL, advance: true })
  expect(refused.deny ?? refused.text ?? '').toContain('There is no plan yet')
})

test('wrap_up shows the card, and a button sends its reply', async ($, on) => {
  const { seen } = engine(on)
  await $.session.start(TERMINAL)
  await $.tool.call({ tool: PLAN_TOOL, items: [{ content: 'Check it', status: 'in_progress' }] })
  await $.tool.call({
    tool: WRAP_TOOL,
    recap: 'The mod loads.',
    ask: 'Ship it?',
    actions: [
      { label: 'Ship', message: 'ship it' },
      { label: 'Wait', message: 'not yet' },
    ],
  })

  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: 'Ship it?' }))?.text).toBe('Ship it?')
  expect((await band.find({ type: 'Text', text: /1 of 1 steps done/ }))?.text).toBe('✔ 1 of 1 steps done')
  expect((await band.find({ type: 'Markdown' }))?.props.text).toBe('The mod loads.')

  // The close mark is one red Button, so the pointer inverts it whole, as the engine's `[-]`.
  const dismiss = await band.find({ type: 'Button', key: 'mark-dismiss' })
  expect(dismiss?.text).toBe('[✕]')
  expect((await band.find({ type: 'Text', text: '[✕]' }))?.props.color).toBe('error')
  await band.press({ key: 'action-1' })
  expect(seen.sent).toEqual(['ship it'])
  expect(await band.find({ type: 'Button', key: 'action-1' })).toBeUndefined()
  await band.unmount()
})

test('wrap_up without buttons draws no card, and the finished list goes too', async ($, on) => {
  engine(on)
  await $.session.start(TERMINAL)
  await $.tool.call({ tool: PLAN_TOOL, items: [{ content: 'Check it', status: 'in_progress' }] })
  const done = await $.tool.call({ tool: WRAP_TOOL, recap: 'Searched and showed the results.' })
  expect(done.result ?? done.text ?? '').toContain('Nothing is drawn')

  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  expect(await band.find({ type: 'Markdown' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'Check it' })).toBeUndefined()
  await band.unmount()
})

test('a new prompt clears the list, the card and an open panel', async ($, on) => {
  engine(on)
  await $.session.start(TERMINAL)
  await $.tool.call({ tool: PLAN_TOOL, items: [{ content: 'One', status: 'in_progress' }] })
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  await line.post({ press: 'effort' }, CHIPS)
  expect((await band.find({ type: 'Text', text: 'Effort' }))?.text).toBe('Effort')
  // The heading is set into the frame's top edge, its corners drawn with it.
  expect(await band.find({ type: 'Text', text: '╭─ ' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '─╮' })).toBeDefined()
  // Its close mark closes it; the effort chip opens it again.
  await band.press({ key: 'mark-close' })
  expect(await band.find({ type: 'Text', text: 'Effort' })).toBeUndefined()
  await line.post({ press: 'effort' }, CHIPS)

  await $.turn.start({ text: 'next question', turnId: 't2' })
  expect(await band.find({ type: 'Text', text: 'Effort' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'One' })).toBeUndefined()
  await line.unmount()
  await band.unmount()
})

test('the context chip shows the meter and opens the details, with compact and clear', async ($, on) => {
  const { seen } = engine(on)
  await $.session.start(TERMINAL)
  await $.session.measure({
    context: { tokens: 468_300, window: 1_000_000, percent: 47 },
    rateLimits: [],
    changed: ['context'],
  })

  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  // The bar is a picture laid over blank cells of the chip: 47% fills half of it.
  expect((await line.find({ key: 'chip-context', ...CHIPS }))?.text).toBe(`[${' '.repeat(12)}] 47%`)
  const bar = await line.find({ type: 'Image', key: 'meter' })
  expect(bar?.props.alt).toBe('■■■■■■······')
  expect(bar?.props.source).toMatchObject({ width: 192, height: 36 })
  // The chips are text, not Buttons: nothing in them inverts under the pointer.
  expect(await line.find({ type: 'Button', ...CHIPS })).toBeUndefined()

  await line.pointer({ type: 'down', x: 1, y: 0, button: 'left', ...CHIPS })
  expect((await band.find({ type: 'Text', text: 'MCP tools' }))?.text).toBe('MCP tools')
  expect((await band.find({ type: 'Text', text: '26.2%' }))?.text).toBe('26.2%')

  await band.press({ key: 'list-mcp' })
  expect((await band.find({ type: 'Text', text: 'files' }))?.text).toBe('files')
  expect((await band.find({ type: 'Text', text: '2 tools' }))?.text).toBe('2 tools')

  await band.press({ key: 'compact' })
  expect(seen.ran).toContain('compact')

  await band.press({ key: 'clear' })
  expect(seen.ran).not.toContain('clear')
  await band.press({ key: 'clear-yes' })
  expect(seen.ran).toContain('clear')
  await line.unmount()
  await band.unmount()
})

test('the model chip lists the picker and switches by /model', async ($, on) => {
  const { seen } = engine(on)
  await $.session.start(TERMINAL)
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect((await line.find({ key: 'chip-model', ...CHIPS }))?.text).toBe('Opus 5.5')

  // The context chip takes cells 0 to 17, then the ' | ' between items; the model chip starts at 21.
  await line.pointer({ type: 'down', x: 19, y: 0, button: 'left', ...CHIPS })
  expect(await band.find({ type: 'Text', text: 'Model' })).toBeUndefined()
  await line.pointer({ type: 'down', x: 22, y: 0, button: 'left', ...CHIPS })
  expect((await band.find({ type: 'Button', key: 'model-2' }))?.text).toContain('Claude Sonnet 5.5')

  await band.press({ key: 'model-2' })
  expect(seen.ran).toContain('model gateway/claude-sonnet-5-5')
  expect((await line.find({ key: 'chip-model', ...CHIPS }))?.text).toBe('Sonnet 5.5')
  await line.unmount()
  await band.unmount()
})

test('CLAUDE_CODE_EFFORT_LEVEL holds the effort: the chip says so and the panel offers no switch', async ($, on) => {
  const { seen } = engine(on, { CLAUDE_CODE_EFFORT_LEVEL: 'max' })
  await $.session.start(TERMINAL)
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect((await line.find({ key: 'chip-effort', ...CHIPS }))?.text).toBe('Max (env)')

  await line.post({ press: 'effort' }, CHIPS)
  expect(await band.find({ type: 'Button', key: 'effort-high' })).toBeUndefined()
  expect((await band.find({ type: 'Text', text: /overrides \/effort/ }))?.text).toContain('CLAUDE_CODE_EFFORT_LEVEL=max')

  // A typed /effort under the lock: the engine keeps max, and so does the toolbar.
  await $.command.run({ command: 'effort', args: 'high', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(seen.ran).toContain('effort high')
  expect((await line.find({ key: 'chip-effort', ...CHIPS }))?.text).toBe('Max (env)')
  await line.unmount()
  await band.unmount()
})

test('CLAUDE_CODE_EFFORT_LEVEL in the settings env holds the effort too, though the process lacks it', async ($, on) => {
  engine(on, {}, { env: { CLAUDE_CODE_EFFORT_LEVEL: 'max' } })
  await $.session.start(TERMINAL)
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect((await line.find({ key: 'chip-effort', ...CHIPS }))?.text).toBe('Max (env)')
  await line.unmount()
  await band.unmount()
})

test('before any reading the status line leaves the context out, bar and all', async ($, on) => {
  engine(on, {}, {}, { ...USAGE, context: { window: 1_000_000 } })
  await $.session.start(TERMINAL)
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await line.find({ key: 'chip-context', ...CHIPS })).toBeUndefined()
  expect(await line.find({ type: 'Image', key: 'meter' })).toBeUndefined()
  expect((await line.find({ key: 'chip-model', ...CHIPS }))?.text).toBe('Opus 5.5')
  await line.unmount()
  await band.unmount()
})

test('a gateway model id outside the picker shows by its Claude family and version', async ($, on) => {
  engine(on)
  await $.session.start(TERMINAL)
  await $.command.run({
    command: 'model',
    args: 'router-42.anthropic.claude-opus-5-5[1m]',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect((await line.find({ key: 'chip-model', ...CHIPS }))?.text).toBe('Opus 5.5')
  await line.unmount()
  await band.unmount()
})

test('the effort chip switches by /effort', async ($, on) => {
  const { seen } = engine(on)
  await $.session.start(TERMINAL)
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect((await line.find({ key: 'chip-effort', ...CHIPS }))?.text).toBe('High')

  await line.post({ press: 'effort' }, CHIPS)
  // Numbered in the label's own color, no hotkey's `3:` before it.
  expect((await band.find({ type: 'Button', key: 'effort-high' }))?.text).toBe(' 3 High ')
  expect((await band.find({ type: 'Button', key: 'effort-high' }))?.props.hotkey).toBeUndefined()
  await band.press({ key: 'effort-max' })
  expect(seen.ran).toContain('effort max')
  expect((await line.find({ key: 'chip-effort', ...CHIPS }))?.text).toBe('Max')

  // A digit at an empty prompt still picks by number, and never lands in the prompt.
  await line.post({ press: 'effort' }, CHIPS)
  // The kit raises `prompt.edit` as the editor does, though plugins' `$` has no call for it.
  const prompt = $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<{ text: string }> }
  const typed = await prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '2' })
  expect(typed.text).toBe('')
  expect(seen.ran).toContain('effort medium')
  await line.unmount()
  await band.unmount()
})

/** Raises the rows a Read of each file and its image result make, as the engine does. */
async function readImages($: Parameters<TestBody>[0], files: readonly string[]) {
  for (const [i, file] of files.entries()) {
    const id = `toolu_${i + 1}`
    await $.session.append({
      message: {
        type: 'assistant',
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: file } }],
      },
      door: 'response',
      origin: { kind: 'model', model: 'opus' },
      uuid: `use-${id}`,
    })
    await $.session.append({
      message: {
        type: 'user',
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }],
          },
        ],
      },
      door: 'tool-result',
      origin: { kind: 'tool', tool: 'Read' },
      uuid: `result-${id}`,
    })
  }
}

test('an image in a tool result lights the images chip and opens in the gallery', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start(TERMINAL)
  await readImages($, ['/tmp/shot.png'])

  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect((await line.find({ key: 'chip-images', ...CHIPS }))?.text).toBe('Images(1) ●')

  await line.post({ press: 'images' }, CHIPS)
  expect((await band.find({ type: 'Text', text: 'Image Viewer' }))?.text).toBe('Image Viewer')
  expect((await band.find({ type: 'Button', key: 'pick-1' }))?.text).toBe('1 shot.png')
  expect((await band.find({ type: 'Text', text: '1 / 1' }))?.text).toBe('1 / 1')
  expect((await band.find({ type: 'Text', text: 'Preparing preview…' }))?.text).toBe('Preparing preview…')

  // The row's bytes are written out once, and sips makes each copy from them.
  await clock.advance(10)
  expect(seen.runs.filter(run => run.startsWith('/usr/bin/base64 -D -o /tmp/cc-hud-lite-art/toolu_1_1.source.png'))).toHaveLength(1)
  expect(seen.runs.some(run => run.startsWith('/usr/bin/sips -s format png') && run.endsWith('toolu_1_1.view.png'))).toBe(true)
  expect((await band.find({ type: 'Image', key: 'view' }))?.props.alt).toBe('shot.png')
  expect((await line.find({ key: 'chip-images', ...CHIPS }))?.text).toBe('Images(1)')
  await line.unmount()
  await band.unmount()
})

test('the gallery lists every image, picks one, and moves its list between left and bottom', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start(TERMINAL)
  await readImages($, ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png'])

  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  await line.post({ press: 'images' }, CHIPS)
  await clock.advance(10)
  expect((await band.find({ type: 'Text', text: '3 / 3' }))?.text).toBe('3 / 3')
  expect((await band.find({ type: 'Button', key: 'pick-1' }))?.text).toContain('a.png')

  await band.press({ key: 'pick-1' })
  expect((await band.find({ type: 'Text', text: '1 / 3' }))?.text).toBe('1 / 3')

  // One mark per control, in one color: the layout in use, the expand mark green.
  expect((await band.find({ type: 'Button', key: 'layout' }))?.text).toBe('[◧]')
  expect((await band.find({ type: 'Text', text: '[⤢]' }))?.props.color).toBe('success')
  await band.press({ key: 'layout' })
  expect(seen.stored.galleryLayout).toBe('bottom')
  expect((await band.find({ type: 'Button', key: 'layout' }))?.text).toBe('[⬓]')
  expect((await band.find({ type: 'Button', key: 'pick-1' }))?.text).toBe('1')
  // A thumbnail shows its image when pressed, as its number does.
  await band.post({ press: 'pick:1' }, { in: 'pick-hit-toolu_2:1' })
  expect((await band.find({ type: 'Text', text: '2 / 3' }))?.text).toBe('2 / 3')
  await band.press({ key: 'pick-1' })

  // Expanding moves the gallery into the large pane: the band's panel closes.
  await band.press({ key: 'bigview' })
  expect(seen.opened).toEqual(['cc-hud-lite-bigview'])
  expect(await band.find({ type: 'Text', text: 'Image Viewer' })).toBeUndefined()

  const big = await $.ui.mount({
    plugin: 'cc-hud-lite',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cc-hud-lite-bigview',
    props: {
      title: 'Image',
      isFocused: true,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
  // The pane holds the whole gallery: the picture, the list and the buttons.
  expect((await big.find({ type: 'Image', key: 'view' }))?.props.alt).toBe('a.png')
  expect((await big.find({ type: 'Button', key: 'pick-3' }))?.text).toBe('3')
  await big.press({ key: 'big-next' })
  expect((await big.find({ type: 'Image', key: 'view' }))?.props.alt).toBe('b.png')

  // Shrinking closes the pane and opens the gallery above the prompt again, at the same image.
  await big.press({ key: 'smallview' })
  expect(seen.closed).toEqual(['cc-hud-lite-bigview'])
  expect((await band.find({ type: 'Text', text: '2 / 3' }))?.text).toBe('2 / 3')
  await band.press({ key: 'pick-1' })

  // The pane's close mark only closes it.
  await band.press({ key: 'bigview' })
  await big.press({ key: 'mark-big' })
  expect(seen.closed).toEqual(['cc-hud-lite-bigview', 'cc-hud-lite-bigview'])
  expect(await band.find({ type: 'Text', text: 'Image Viewer' })).toBeUndefined()
  await big.unmount()
  await band.unmount()
})

test('a transcript row keeps its images beside it, and opens the gallery at them', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start(TERMINAL)
  await readImages($, ['/tmp/a.png', '/tmp/b.png'])
  await clock.advance(10)

  const row = await $.ui.mount({
    plugin: 'cc-hud-lite',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-1',
    props: {
      calls: [
        {
          tool_use_id: 'toolu_2',
          tool: 'Read',
          input: { file_path: '/tmp/b.png' },
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
        },
      ],
      isActive: false,
      isExpanded: false,
    },
  })
  expect((await row.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
  expect((await row.find({ type: 'Image', key: 'row-toolu_2:1' }))?.props.alt).toBe('▣')

  // The thumbnail itself opens the gallery: a target over it takes the press, no `[›]` beside it.
  expect(await row.find({ type: 'Button' })).toBeUndefined()
  await row.post({ press: 'open:toolu_2:1' }, { in: 'thumb-toolu_2:1' })
  await row.unmount()

  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: '2 / 2' }))?.text).toBe('2 / 2')
  expect((await band.find({ type: 'Button', key: 'pick-2' }))?.text).toBe('2 b.png')
  await band.unmount()
})

test('a pasted image shows beside its message', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start(TERMINAL)
  await $.session.append({
    message: {
      type: 'user',
      role: 'user',
      content: [
        { type: 'text', text: '[Image #1] what is this' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
      ],
    },
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'prompt-1',
  })
  await clock.advance(10)

  const row = await $.ui.mount({
    plugin: 'cc-hud-lite',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'prompt-1',
    props: { text: '[Image #1] what is this', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect((await row.find({ type: 'Image', key: 'row-prompt-1:1' }))?.props.alt).toBe('▣')
  await row.unmount()
})

test('a gallery of large pictures stays within what one drawing may hold', async ($, on) => {
  const { clock, sizes } = engine(on)
  sizes.view = 1_500_000
  sizes.thumb = 200_000
  await $.session.start(TERMINAL)
  await readImages($, ['/tmp/1.png', '/tmp/2.png', '/tmp/3.png', '/tmp/4.png', '/tmp/5.png', '/tmp/6.png'])
  await clock.advance(10)

  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  await line.post({ press: 'images' }, CHIPS)
  await clock.advance(10)
  // The surface draws the tree: it refuses one holding more than 2 MiB of Image bytes.
  expect(await band.drawn()).toBeDefined()
  const images = await band.findAll({ type: 'Image' })
  const held = images.reduce((sum, image) => {
    const source = image.props.source as { png?: string; rgba?: string }

    return sum + decoded(source.png ?? source.rgba ?? '')
  }, 0)
  expect(images.some(image => image.key === 'view')).toBe(true)
  expect(held <= 2_097_152).toBe(true)
  // The view and two thumbnails; what did not fit waits as a placeholder.
  expect(images.filter(image => image.key?.startsWith('pick-img-')).length).toBe(2)
  expect(images.at(-1)?.key).toBe('view')
  await line.unmount()
  await band.unmount()
})

test('the git chip shows the branch, and pressing it shows the directory', async ($, on) => {
  const { seen } = engine(on)
  await $.session.start(TERMINAL)
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect((await line.find({ key: 'chip-git', ...CHIPS }))?.text).toBe('work git:(main)')
  // The items read as a status line, a thin bar between each; no spend limit without a reading.
  expect((await line.findAll({ type: 'Text', text: ' | ', ...CHIPS })).length).toBe(3)

  await line.post({ press: 'git' }, CHIPS)
  expect((await band.find({ type: 'Text', text: 'Directory' }))?.text).toBe('Directory')
  expect((await band.find({ type: 'Text', text: '/work' }))?.text).toBe('/work')
  expect((await band.find({ type: 'Text', text: /changed/ }))?.text).toBe('2 changed · ↑1 ↓0 against origin/main')

  await band.press({ key: 'copy-path' })
  expect(seen.copied).toEqual(['/work'])
  await line.unmount()
  await band.unmount()
})

test('the spend limit shows what the gateway reports, and is left out without a reading', async ($, on) => {
  engine(on)
  await $.session.start(TERMINAL)
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await line.find({ key: 'chip-spend', ...CHIPS })).toBeUndefined()

  await $.session.measure({
    context: { tokens: 468_300, window: 1_000_000, percent: 47 },
    rateLimits: [{ kind: 'spend_limit', percentUsed: 62.8, resetsAt: '2026-11-01T00:00:00Z' }],
    changed: ['rateLimits'],
  })
  expect((await line.find({ key: 'chip-spend', ...CHIPS }))?.text).toBe('Spend Limit: 62.8%')
  await line.unmount()
  await band.unmount()
})

test('the status line sits under the prompt, and /toolbar moves it into the band above', async ($, on) => {
  const { seen } = engine(on)
  await $.session.start(TERMINAL)
  const band = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  const line = await $.ui.mount({ ...HINT, surface: 'terminal' })
  // Under the prompt, in the hint line's place; nothing open draws nothing above, so no [-].
  expect((await line.find({ key: 'chip-model', ...CHIPS }))?.text).toBe('Opus 5.5')
  expect(await line.find({ type: 'Text', text: 'engine' })).toBeUndefined()
  expect((await band.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
  expect(await band.find({ type: 'Client' })).toBeUndefined()

  const moved = await $.command.run({ command: 'toolbar', args: 'above', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(moved.text).toBe('Status line: above the prompt.')
  expect(seen.stored.toolbarPlace).toBe('above')
  expect((await band.find({ key: 'chip-model', ...CHIPS }))?.text).toBe('Opus 5.5')
  expect(await line.find({ type: 'Client' })).toBeUndefined()
  await line.unmount()
  await band.unmount()
})

test('the system prompt teaches the tools only where they are offered', async ($, on) => {
  engine(on)
  await $.session.start(TERMINAL)
  const offered = await $.prompt.compose({
    ...COMPOSE,
    tools: ['Bash', 'mcp__cc-hud-lite__update_plan', 'mcp__cc-hud-lite__wrap_up'],
  })
  expect(offered.sections.map(section => section.id)).toEqual(['intro', 'cc-hud-lite:workflow'])

  const desktop = await $.prompt.compose({ ...COMPOSE, tools: ['mcp__cc-hud-lite__update_plan', 'mcp__ccd_turn__update_plan'] })
  expect(desktop.sections.map(section => section.id)).toEqual(['intro'])
})

test('outside a terminal session it registers nothing and leaves the band alone', async ($, on) => {
  const { seen } = engine(on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(seen.tools).toEqual([])

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
  await band.unmount()
})

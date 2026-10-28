import { atom, read, update } from 'claude-code'
import type {
  Elements,
  EngineInterface,
  Register,
  RenderElement,
  SessionContextBreakdown,
  Timer,
  ToolSpec,
} from 'claude-code'

import type {
  CardAction,
  Chip,
  ChipRun,
  ContextItem,
  ContextView,
  GalleryLayout,
  GitInfo,
  Meter,
  ModelChoice,
  NextStep,
  Panel,
  PlanStatus,
  PlanStep,
  Runtime,
  Shot,
  SpendLimit,
  ToolbarPlace,
} from '../types'

const PLAN_TOOL = 'mcp__cc-hud-lite__update_plan'
const WRAP_TOOL = 'mcp__cc-hud-lite__wrap_up'
// The full-height view of one image, beside the transcript where the layout docks panes.
const BIG_PANE = 'cc-hud-lite-bigview'
// Where the gallery's list sits, and where the status line does, kept across sessions.
const LAYOUT_KEY = 'galleryLayout'
const PLACE_KEY = 'toolbarPlace'
// Thumbnails beside a transcript row, the rest counted.
const ROW_THUMBS = 3

const MAX_STEPS = 12
const MAX_SHOTS = 200
const MAX_CALLS = 2000
const MAX_LISTED = 12
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** An effort level as the status line and panel show it: `Medium`, `XHigh`, `Default`. */
function effortName(level: string): string {
  return level === 'xhigh' ? 'XHigh' : level.charAt(0).toUpperCase() + level.slice(1)
}
// Cells in the context chip's bar. The toolbar draws it as a picture: no character is both centered in
// the row and taller than the text (`■` sits centered but short, `▆` and `█` are drawn from the bottom).
const METER_CELLS = 12
// The picture: 12 cells by one row at the screen's own pixels, so the terminal draws it unscaled and
// sharp. iTerm2 rounds a cell up to whole points (8 x 18 for a common 13 pt font) and a Retina
// screen doubles them: 16 x 36 pixels a cell. Another cell size only rescales it, a little softer.
const METER_PIXELS = { width: 192, height: 36 }
// The bar's height, about 60% of the row, centered: 7 pixels clear above and below.
const METER_THICKNESS = 22
// The theme's colours in the dark themes, which the picture cannot name; the rest of the bar is grey.
const METER_RGB: Record<'success' | 'warning' | 'error' | 'rest', readonly [number, number, number]> = {
  success: [78, 186, 101],
  warning: [255, 193, 7],
  error: [255, 107, 128],
  rest: [96, 96, 108],
}
// The glyph the context panel's bar is made of.
const METER_GLYPH = '■'

// Every picture is drawn from a scaled copy macOS's sips makes in the temp folder: a small one for
// lists and transcript rows, a larger one to view. The engine refuses a drawing that holds more than
// 2 MiB of Image bytes, so each drawing also counts what it holds and keeps a margin under that.
const SIPS = '/usr/bin/sips'
const BASE64_TOOL = '/usr/bin/base64'
const THUMB_PIXELS = 160
const VIEW_PIXELS = 1024
const TREE_IMAGE_BYTES = 2 * 1024 * 1024 - 64 * 1024
// Scaled pictures kept in memory, counted in base64 characters.
const MAX_ART_CHARS = 24 * 1024 * 1024
// Images whose bytes wait in memory to be written out, and the largest one kept.
const MAX_PENDING = 40
const MAX_PENDING_CHARS = 16 * 1024 * 1024
const MAX_ORIGINALS = 3

const plan = atom({ plugin: 'cc-hud-lite', key: 'plan' } as const, [])
const card = atom({ plugin: 'cc-hud-lite', key: 'card' } as const, null)
const shots = atom({ plugin: 'cc-hud-lite', key: 'shots' } as const, [])
const shown = atom({ plugin: 'cc-hud-lite', key: 'shown' } as const, 0)
const unseen = atom({ plugin: 'cc-hud-lite', key: 'unseen' } as const, 0)
const context = atom({ plugin: 'cc-hud-lite', key: 'context' } as const, null)
const expanded = atom({ plugin: 'cc-hud-lite', key: 'expanded' } as const, null)
const meter = atom({ plugin: 'cc-hud-lite', key: 'meter' } as const, null)
const panel = atom({ plugin: 'cc-hud-lite', key: 'panel' } as const, null)
const confirm = atom({ plugin: 'cc-hud-lite', key: 'confirm' } as const, null)
const runtime = atom({ plugin: 'cc-hud-lite', key: 'runtime' } as const, { model: null, effort: null })
const models = atom({ plugin: 'cc-hud-lite', key: 'models' } as const, [])
const layout = atom({ plugin: 'cc-hud-lite', key: 'layout' } as const, 'left')
const artwork = atom({ plugin: 'cc-hud-lite', key: 'art' } as const, 0)
const gitInfo = atom({ plugin: 'cc-hud-lite', key: 'git' } as const, null)
const spendLimit = atom({ plugin: 'cc-hud-lite', key: 'spend' } as const, null)
const place = atom({ plugin: 'cc-hud-lite', key: 'place' } as const, 'below')

// On in an interactive terminal session only: the desktop app draws its own.
let isActive = false
// The home directory, to write paths under it with a `~`.
let home: string | null = null
// The level CLAUDE_CODE_EFFORT_LEVEL holds the whole session at: /effort cannot move it.
let effortLock: string | null = null
// Shot id → the bytes its row carried, until they are written to the temp folder.
const pending = new Map<string, { mime: string; data: string }>()
// tool_use id → the tool and the file it read, to label the images it returns.
const calls = new Map<string, { tool: string; path: string | null }>()
// The band's instance, and the timer that turns the running step's glyph.
let bandId: string | null = null
// What the digits 1-9 press at an empty prompt, in the order the band last numbered them: a
// Button's own hotkey draws a second color (`1:`) before its label, so the band catches the keys.
let numbered: (() => unknown)[] = []
let spinner: Timer | null = null
let spinFrame = 0

type Art = { png: string; width: number | null; height: number | null }
type Variant = 'thumb' | 'view'
// `${shot id}|${variant}` → its scaled picture, least recently drawn first.
const arts = new Map<string, Art>()
let artChars = 0
// Pictures that could not be made, and those waiting to be, made one at a time.
const failed = new Set<string>()
const queued = new Set<string>()
const jobs: { shot: Shot; variant: Variant }[] = []
let isDraining = false
let artFolder: string | null = null
// The last few originals the full-height view drew.
const originals = new Map<string, Art>()

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CLAUDE_ORANGE = 0xd77757
const DEFAULT_COLOR = 0x01000000
const SPIN = ['◐', '◓', '◑', '◒']
const STEP_GLYPH: Record<PlanStatus, string> = { completed: '✔', in_progress: '◐', pending: '◌' }
/** A step's text: done dim, the running one lit, the rest plain. Not a control, so its mark has a color of its own. */
const STEP_STYLE: Record<PlanStatus, { color?: string; dimColor?: boolean; bold?: boolean }> = {
  completed: { dimColor: true },
  in_progress: { color: 'claude', bold: true },
  pending: {},
}
/** A step's mark: a green ✔, an orange ◐, a dim ◌. */
const MARK_STYLE: Record<PlanStatus, { color?: string; dimColor?: boolean }> = {
  completed: { color: 'success' },
  in_progress: { color: 'claude' },
  pending: { dimColor: true },
}
const FALLBACK_MODELS: ModelChoice[] = [
  { model: 'opus', label: 'Opus', detail: 'alias' },
  { model: 'sonnet', label: 'Sonnet', detail: 'alias' },
  { model: 'haiku', label: 'Haiku', detail: 'alias' },
]

const PLAN_SPEC: ToolSpec = {
  name: 'update_plan',
  description:
    'Keep the task list drawn above the prompt, which the person reads to follow your work. ' +
    'First call: {"items": [...]}, the whole plan, the step you start "in_progress", the rest "pending". ' +
    'Next step: {"advance": true} beside the call that begins it. Out of order: {"done": [2], "start": 4} (1-based). ' +
    'A changed plan: {"items": [...]} again.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'The whole plan in order, 1 to 12 short imperative steps; replaces the previous list.',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
        },
      },
      advance: { type: 'boolean', description: 'Completes the in_progress step and starts the next pending one.' },
      done: { type: 'array', items: { type: 'number' }, description: 'Steps to mark completed, 1-based.' },
      start: { type: 'number', description: 'The step to mark in_progress, 1-based.' },
    },
  },
  isDeferred: false,
}

const WRAP_SPEC: ToolSpec = {
  name: 'wrap_up',
  description:
    'Fill the next-step card drawn above the prompt when a turn that kept a task list, changed files or ran commands is done. ' +
    'Call it once, before your closing message.',
  inputSchema: {
    type: 'object',
    properties: {
      recap: {
        type: 'string',
        description: "Two or three short sentences in the person's language: what is now true, and what is not done or not verified.",
      },
      ask: {
        type: 'string',
        description: "One short question, only when the next move is the person's (a choice, a go-ahead).",
      },
      actions: {
        type: 'array',
        maxItems: 2,
        description: 'One or two buttons answering ask, your recommendation first.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'One to three words.' },
            message: { type: 'string', description: "What pressing it sends, as the person's own reply." },
          },
          required: ['label', 'message'],
        },
      },
    },
    required: ['recap'],
  },
  isDeferred: false,
}

const WORKFLOW = `# Task list and next-step card (cc-hud-lite)
The person follows your work in a task list drawn above the prompt: \`${PLAN_TOOL}\` keeps it. Use it in place of TaskCreate, TaskUpdate and TodoWrite.
- For a request that edits files or runs more than one command, send the whole plan in the same message as your first tool call of the turn: {"items": [...]}, short imperative steps (about seven words each), the step you are starting "in_progress", the rest "pending".
- As a step finishes, send {"advance": true} beside the call that starts the next one. Out of order: {"done": [2], "start": 4} (1-based). When the plan changes, send {"items": [...]} again. Keep exactly one step in_progress while you work.
- A single command or pure conversation needs no list.
When a turn in which you kept the list, changed files or ran commands is done, call \`${WRAP_TOOL}\` once, before your closing message. \`recap\` is two or three short sentences in the person's language: what is now true, and what is not done or not verified. Only when the next move is the person's (a choice, a go-ahead to act, commit or send), add \`ask\`, one short question, and \`actions\`, one or two buttons: \`label\` one to three words, \`message\` what pressing it sends as their reply, your recommendation first. Then write your closing message: your full answer, without asking the card's question again.`

function toBase64(bytes: readonly number[]): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += BASE64.charAt((n >> 18) & 63) + BASE64.charAt((n >> 12) & 63)
    out += b === undefined ? '=' : BASE64.charAt((n >> 6) & 63)
    out += c === undefined ? '=' : BASE64.charAt(n & 63)
  }

  return out
}

/** One Raster cell: the glyph in a colour over the terminal's own background. */
function cellOf(glyph: string, rgb: number): string {
  const bytes: number[] = []
  for (const word of [glyph.codePointAt(0) ?? 32, rgb, DEFAULT_COLOR]) {
    bytes.push(word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff)
  }

  return toBase64(bytes)
}

const SPIN_CELLS = SPIN.map(glyph => cellOf(glyph, CLAUDE_ORANGE))

// The last bar drawn, kept while the reading stays the same.
let meterCache: { key: string; rgba: string } | null = null

/** The context bar as RGBA pixels: filled to `percent` in its level's colour, grey after, clear above and below. */
function meterPicture(percent: number | null): { rgba: string; width: number; height: number } {
  const { width, height } = METER_PIXELS
  const level = percent === null ? null : percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'
  const fillTo = percent === null ? 0 : Math.round((width * Math.min(100, Math.max(0, percent))) / 100)
  const key = `${fillTo}:${level ?? 'none'}`
  if (meterCache?.key !== key) {
    const top = Math.round((height - METER_THICKNESS) / 2)
    const fill = level === null ? METER_RGB.rest : METER_RGB[level]
    const bytes: number[] = new Array<number>(width * height * 4).fill(0)
    for (let y = top; y < top + METER_THICKNESS; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b] = x < fillTo ? fill : METER_RGB.rest
        const at = (y * width + x) * 4
        bytes[at] = r
        bytes[at + 1] = g
        bytes[at + 2] = b
        bytes[at + 3] = 255
      }
    }
    meterCache = { key, rgba: toBase64(bytes) }
  }

  return { rgba: meterCache.rgba, width, height }
}

function stopSpinner(): void {
  spinner?.cancel()
  spinner = null
}

/** Turns the running step's glyph in place, without drawing the band again. */
function startSpinner($: EngineInterface): void {
  if (spinner !== null) {
    return
  }
  spinner = $.clock.every(120, () => {
    if (bandId === null) {
      return
    }
    spinFrame = (spinFrame + 1) % SPIN_CELLS.length
    $.ui.blit({ requestId: bandId, key: 'spin', cells: SPIN_CELLS[spinFrame] ?? '' }).then(
      done => {
        if (done.deny !== undefined) {
          stopSpinner()
        }
      },
      () => stopSpinner(),
    )
  })
}

const STATUSES: readonly PlanStatus[] = ['pending', 'in_progress', 'completed']

function isStatus(value: unknown): value is PlanStatus {
  return STATUSES.some(status => status === value)
}

function mark(step: PlanStep, status: PlanStatus): PlanStep {
  return { ...step, status }
}

function readSteps(value: unknown): PlanStep[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return 'items is a non-empty list of { content, status }.'
  }
  if (value.length > MAX_STEPS) {
    return `items holds ${value.length} steps; keep it to ${MAX_STEPS}.`
  }
  const steps: PlanStep[] = []
  for (const item of value) {
    const { content, status } = (typeof item === 'object' && item !== null ? item : {}) as {
      content?: unknown
      status?: unknown
    }
    if (typeof content !== 'string' || content.trim() === '') {
      return 'Each item needs a non-empty content.'
    }
    if (!isStatus(status)) {
      return `Each status is one of ${STATUSES.join(', ')}.`
    }
    steps.push({ content: content.trim(), status })
  }

  return steps
}

/** 1-based step numbers to 0-based indexes, or what is wrong with them. */
function readPositions(value: unknown, count: number): number[] | string {
  const list: unknown[] = value === undefined ? [] : Array.isArray(value) ? value : [value]
  const indexes: number[] = []
  for (const n of list) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > count) {
      return `Steps are numbered 1 to ${count}.`
    }
    indexes.push(n - 1)
  }

  return indexes
}

function advance(steps: readonly PlanStep[]): PlanStep[] {
  const current = steps.findIndex(step => step.status === 'in_progress')
  const following = steps.findIndex((step, i) => i > current && step.status === 'pending')

  return steps.map((step, i) =>
    i === current ? mark(step, 'completed') : i === following ? mark(step, 'in_progress') : step,
  )
}

function describePlan(steps: readonly PlanStep[]): string {
  const done = steps.filter(step => step.status === 'completed').length
  const running = steps.filter(step => step.status === 'in_progress').length
  const note = running > 1 ? ' Keep only one step in_progress.' : ''

  return `Plan shown: ${done} of ${steps.length} steps done.${note}`
}

function readActions(value: unknown): CardAction[] {
  if (!Array.isArray(value)) {
    return []
  }
  const actions: CardAction[] = []
  for (const item of value.slice(0, 2)) {
    const { label, message } = (typeof item === 'object' && item !== null ? item : {}) as {
      label?: unknown
      message?: unknown
    }
    if (typeof label !== 'string' || label.trim() === '') {
      continue
    }
    const reply = typeof message === 'string' && message.trim() !== '' ? message.trim() : label.trim()
    actions.push({ label: label.trim().slice(0, 24), message: reply.slice(0, 300) })
  }

  return actions
}

function tokens(count: number): string {
  const short = (value: number) => String(Math.round(value * 10) / 10)
  if (count >= 1_000_000) {
    return `${short(count / 1_000_000)}M`
  }
  if (count >= 1_000) {
    return `${short(count / 1_000)}k`
  }

  return String(Math.round(count))
}

function share(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—'
}

/** The theme colour for how full the window is. */
function fillColor(percent: number): string {
  return percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'
}

function toView(breakdown: SessionContextBreakdown): ContextView {
  const servers = new Map<string, { tools: number; tokens: number }>()
  for (const tool of breakdown.mcpTools) {
    const server = servers.get(tool.serverName) ?? { tools: 0, tokens: 0 }
    server.tools += 1
    server.tokens += tool.isLoaded ? tool.tokens : 0
    servers.set(tool.serverName, server)
  }
  const byTokens = (a: ContextItem, b: ContextItem) => b.tokens - a.tokens

  return {
    totalTokens: breakdown.totalTokens,
    maxTokens: breakdown.rawMaxTokens,
    rows: breakdown.categories.map(row => ({ name: row.name, tokens: row.tokens, color: row.color, kind: row.kind })),
    mcpToolCount: breakdown.mcpTools.length,
    mcp: [...servers]
      .map(([name, server]) => ({ name, detail: `${server.tools} tools`, tokens: server.tokens }))
      .sort(byTokens),
    memory: breakdown.memoryFiles
      .map(file => ({ name: file.path, detail: file.type, tokens: file.tokens }))
      .sort(byTokens),
    agents: breakdown.agents
      .map(agent => ({ name: agent.agentType, detail: agent.source, tokens: agent.tokens }))
      .sort(byTokens),
    skills: (breakdown.skills?.skillFrontmatter ?? [])
      .map(skill => ({ name: skill.name, detail: skill.pluginName ?? String(skill.source), tokens: skill.tokens }))
      .sort(byTokens),
    autoCompactAt: breakdown.isAutoCompactEnabled ? breakdown.autoCompactThreshold ?? null : null,
  }
}

type Segment = { cells: number; glyph: string; color: string | null }

/** The stacked bar: used rows in their colours, the compaction buffer, then free space. */
function segments(view: ContextView, width: number): Segment[] {
  const max = Math.max(1, view.maxTokens)
  const list: Segment[] = []
  for (const row of view.rows) {
    if (row.kind !== 'used' && row.kind !== 'buffer') {
      continue
    }
    const cells = row.tokens > 0 ? Math.max(1, Math.round((row.tokens / max) * width)) : 0
    if (cells > 0) {
      list.push({ cells, glyph: row.kind === 'buffer' ? '□' : METER_GLYPH, color: row.color })
    }
  }
  let total = list.reduce((sum, segment) => sum + segment.cells, 0)
  while (total > width && list.length > 0) {
    const widest = list.reduce((a, b) => (b.cells > a.cells ? b : a))
    widest.cells -= 1
    total -= 1
  }
  if (total < width) {
    list.push({ cells: width - total, glyph: METER_GLYPH, color: null })
  }

  return list.filter(segment => segment.cells > 0)
}

async function refreshContext($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown
  const view = breakdown === undefined ? null : toView(breakdown)
  await update($, context, () => view)
  if (view !== null && view.maxTokens > 0) {
    const estimate = { tokens: view.totalTokens, window: view.maxTokens, percent: Math.round((view.totalTokens / view.maxTokens) * 100) }
    await update($, meter, now => now ?? estimate)
  }
}

/** The gateway's spend limit among the windows the last response reported, or null without one. */
function spendOf(limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): SpendLimit | null {
  const limit = limits.find(one => one.kind === 'spend_limit')

  return limit === undefined ? null : { percent: limit.percentUsed, resetsAt: limit.resetsAt ?? null }
}

/** The live window's fill and the spend limit, as the status line reads them. */
async function refreshUsage($: EngineInterface): Promise<void> {
  const { context: now, rateLimits } = await $.session.usage()
  const used = now.tokens
  const percent = now.percent
  if (used !== undefined && percent !== undefined) {
    await update($, meter, () => ({ tokens: used, window: now.window, percent }))
  }
  await update($, spendLimit, () => spendOf(rateLimits))
}

/** The session's directory and its git state: branch, upstream, ahead and behind, changed files. */
async function refreshGit($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const git = (args: readonly string[]) => $.process.run(['git', ...args], { cwd, timeoutMs: 5_000 })
  const top = await git(['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) {
    await update($, gitInfo, () => ({ cwd, root: null, branch: null, upstream: null, ahead: 0, behind: 0, changed: 0 }))

    return
  }
  const status = await git(['status', '--porcelain=v1', '--branch'])
  const [head = '', ...files] = status.stdout.split('\n').filter(line => line !== '')
  // `## main...origin/main [ahead 1, behind 2]`, `## main`, `## No commits yet on main`, `## HEAD (no branch)`
  const named = /^## (?:No commits yet on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head)
  let branch = named?.[1] ?? null
  if (branch === null || branch.startsWith('HEAD (')) {
    const sha = await git(['rev-parse', '--short', 'HEAD'])
    branch = sha.exitCode === 0 && sha.stdout.trim() !== '' ? `(${sha.stdout.trim()})` : null
  }
  const counts = named?.[3] ?? ''
  const count = (word: string) => Number(new RegExp(`${word} (\\d+)`).exec(counts)?.[1] ?? 0)
  await update($, gitInfo, () => ({
    cwd,
    root: top.stdout.trim(),
    branch,
    upstream: named?.[2] ?? null,
    ahead: count('ahead'),
    behind: count('behind'),
    changed: files.length,
  }))
}

/** A path with the home directory written as `~`. */
function tilde(path: string): string {
  return home !== null && home !== '' && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

/** The models settings' modelPicker lists, or the aliases when it lists none. */
async function refreshModels($: EngineInterface): Promise<void> {
  const picker = await $.settings.read({ key: 'modelPicker' })
  const options = typeof picker === 'object' && picker !== null ? (picker as { options?: unknown }).options : undefined
  const list: ModelChoice[] = []
  for (const option of Array.isArray(options) ? options : []) {
    const { model, label, description } = (typeof option === 'object' && option !== null ? option : {}) as {
      model?: unknown
      label?: unknown
      description?: unknown
    }
    if (typeof model !== 'string' || model === '') {
      continue
    }
    const [name, where] = typeof label === 'string' && label !== '' ? label.split(' · ') : [model]
    list.push({
      model,
      label: name ?? model,
      detail: where ?? (typeof description === 'string' ? description : ''),
    })
  }
  await update($, models, () => (list.length > 0 ? list : FALLBACK_MODELS))
}

/** The session's model now. */
async function refreshModel($: EngineInterface): Promise<void> {
  const model = await $.session.model()
  await update($, runtime, now => ({ ...now, model }))
}

/** A variable's value in an env map, as a trimmed non-empty string. */
function envValue(env: unknown, name: string): string | null {
  const value = typeof env === 'object' && env !== null ? (env as Record<string, unknown>)[name] : undefined

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * The effort the session starts from, until a request names the one it is sent with. A
 * CLAUDE_CODE_EFFORT_LEVEL holds the session at its level: set in the shell, or in the settings'
 * env, which the engine applies though this process's own environment may not carry it.
 */
async function refreshEffort($: EngineInterface): Promise<void> {
  const fromShell = await $.env.get('CLAUDE_CODE_EFFORT_LEVEL').catch(() => undefined)
  const settingsEnv = await $.settings.read({ key: 'env' }).catch(() => undefined)
  effortLock =
    (typeof fromShell === 'string' && fromShell.trim() !== '' ? fromShell.trim() : null) ??
    envValue(settingsEnv, 'CLAUDE_CODE_EFFORT_LEVEL')
  const persisted = effortLock === null ? await $.settings.read({ key: 'effortLevel' }).catch(() => undefined) : undefined
  const effort = effortLock ?? (typeof persisted === 'string' && persisted !== '' ? persisted : null)
  await update($, runtime, now => ({ ...now, effort: effortLock ?? now.effort ?? effort }))
}

function normalizeModel(id: string): string {
  return id.toLowerCase().replace(/\[1m\]$/, '').trim()
}

function modelLabel(id: string | null, choices: readonly ModelChoice[]): string {
  if (id === null) {
    return 'model'
  }
  const found = choices.find(choice => normalizeModel(choice.model) === normalizeModel(id))
  if (found !== undefined) {
    return found.label.replace(/^Claude\s+/, '')
  }
  // A gateway's id that carries a Claude model's (`router-42.anthropic.claude-opus-5-5`): its family and version.
  const claude = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(normalizeModel(id))
  if (claude !== null) {
    const family = claude[1] ?? ''

    return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${claude[2] ?? ''}${claude[3] === undefined ? '' : `.${claude[3]}`}`
  }
  const tail = (normalizeModel(id).split('/').pop() ?? id).replace(/^claude-/, '')
  const pretty = tail.replace(/-(\d+)-(\d+)$/, ' $1.$2')

  return pretty.charAt(0).toUpperCase() + pretty.slice(1)
}

type Block = { type: string; [field: string]: unknown }

function headBytes(base64: string, count: number): number[] {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of base64) {
    const value = BASE64.indexOf(char)
    if (value < 0) {
      break
    }
    buffer = ((buffer << 6) | value) & 0xffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
      if (bytes.length === count) {
        break
      }
    }
  }

  return bytes
}

/** A PNG's pixel size from its IHDR chunk, read off the head of its base64. */
function pngSize(base64: string): { width: number; height: number } | null {
  const bytes = headBytes(base64.slice(0, 44), 24)
  const at = (i: number) => bytes[i] ?? 0
  if (bytes.length < 24 || at(0) !== 0x89 || at(1) !== 0x50 || at(2) !== 0x4e || at(3) !== 0x47) {
    return null
  }
  const word = (i: number) => at(i) * 2 ** 24 + at(i + 1) * 2 ** 16 + at(i + 2) * 2 ** 8 + at(i + 3)

  return { width: word(16), height: word(20) }
}

function keepPending(id: string, image: { mime: string; data: string }): void {
  if (image.data.length > MAX_PENDING_CHARS) {
    return
  }
  pending.delete(id)
  pending.set(id, image)
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value
    if (oldest === undefined) {
      break
    }
    pending.delete(oldest)
  }
}

function remember(id: string, tool: string, path: string | null): void {
  calls.set(id, { tool, path })
  while (calls.size > MAX_CALLS) {
    const oldest = calls.keys().next().value
    if (oldest === undefined) {
      break
    }
    calls.delete(oldest)
  }
}

function imageOf(block: Block): { mime: string; data: string } | null {
  if (block.type !== 'image' || typeof block.source !== 'object' || block.source === null) {
    return null
  }
  const { type, media_type: mime, data } = block.source as { type?: unknown; media_type?: unknown; data?: unknown }
  if (type !== 'base64' || typeof data !== 'string') {
    return null
  }

  return { mime: typeof mime === 'string' ? mime : 'image/png', data }
}

function makeShot(
  id: string,
  label: string,
  image: { mime: string; data: string },
  where: Pick<Shot, 'toolUseId' | 'messageId' | 'path'>,
): Shot {
  const size = image.mime === 'image/png' ? pngSize(image.data) : null
  keepPending(id, image)

  return { id, label, mime: image.mime, ...where, width: size?.width ?? null, height: size?.height ?? null }
}

function shortTool(tool: string): string {
  return tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') || tool : tool
}

function labelFor(call: { tool: string; path: string | null } | undefined): string {
  if (call === undefined) {
    return 'Tool image'
  }
  if (call.path === null) {
    return shortTool(call.tool)
  }

  // The file's name alone: the gallery lists images, not the tool calls that read them.
  return call.path.split('/').pop() || call.path
}

/** What the gallery calls a shot: its file's name where it has one (older shots kept `Read <file>`). */
function shotName(shot: Shot): string {
  return shot.path === null ? shot.label : shot.path.split('/').pop() || shot.label
}

/** The images a row carries: pasted into a prompt, or inside a tool's result. */
function collect(content: readonly Block[], door: string, uuid: string): Shot[] {
  const found: Shot[] = []
  for (const block of content) {
    if (block.type === 'tool_use' && typeof block.id === 'string') {
      const input = (typeof block.input === 'object' && block.input !== null ? block.input : {}) as {
        file_path?: unknown
      }
      remember(
        block.id,
        typeof block.name === 'string' ? block.name : 'tool',
        typeof input.file_path === 'string' ? input.file_path : null,
      )
      continue
    }
    if (door === 'prompt') {
      const image = imageOf(block)
      if (image !== null) {
        const n = found.length + 1
        found.push(makeShot(`${uuid}:${n}`, `Pasted image #${n}`, image, { toolUseId: null, messageId: uuid, path: null }))
      }
      continue
    }
    if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string' || !Array.isArray(block.content)) {
      continue
    }
    const toolUseId = block.tool_use_id
    const call = calls.get(toolUseId)
    let n = 0
    for (const inner of block.content as Block[]) {
      const image = imageOf(inner)
      if (image === null) {
        continue
      }
      n += 1
      found.push(
        makeShot(`${toolUseId}:${n}`, labelFor(call), image, {
          toolUseId,
          messageId: null,
          path: call?.path ?? null,
        }),
      )
    }
  }

  return found
}

function artKey(id: string, variant: Variant): string {
  return `${id}|${variant}`
}

function keepArt(key: string, art: Art): void {
  const old = arts.get(key)
  if (old !== undefined) {
    artChars -= old.png.length
    arts.delete(key)
  }
  arts.set(key, art)
  artChars += art.png.length
  while (artChars > MAX_ART_CHARS && arts.size > 1) {
    const oldest = arts.keys().next().value
    if (oldest === undefined) {
      break
    }
    artChars -= arts.get(oldest)?.png.length ?? 0
    arts.delete(oldest)
  }
}

/** A shot's id as a file name: anything but letters, digits, `-` and `_` becomes `_`. */
function fileStem(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

function extensionOf(mime: string): string {
  const kind = (mime.split('/')[1] ?? '').replace(/[^a-z0-9]/g, '')

  return kind === 'jpeg' ? 'jpg' : kind === '' ? 'img' : kind
}

/** The folder in the temp directory that holds the copies: written once per load, kept across reloads. */
async function folder($: EngineInterface): Promise<string> {
  if (artFolder !== null) {
    return artFolder
  }
  const tmp = await $.env.get('TMPDIR')
  const base = typeof tmp === 'string' && tmp !== '' ? tmp.replace(/\/+$/, '') : '/tmp'
  const dir = `${base}/cc-hud-lite-art`
  await $.process.run(['/bin/mkdir', '-p', dir], { timeoutMs: 10_000 })
  artFolder = dir

  return dir
}

/** What base64 holds once decoded: what the engine counts against a drawing. */
function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0

  return Math.floor(base64.length / 4) * 3 - padding
}

/** The Image bytes one drawing may still take. */
type Budget = { left: number }

function budget(): Budget {
  return { left: TREE_IMAGE_BYTES }
}

/** Counts a picture against the drawing it goes in: false, and nothing counted, when it does not fit. */
function spend(room: Budget, art: Art): boolean {
  const bytes = decodedBytes(art.png)
  if (bytes > room.left) {
    return false
  }
  room.left -= bytes

  return true
}

function toArt(base64: string): Art {
  const size = pngSize(base64)

  return { png: base64, width: size?.width ?? null, height: size?.height ?? null }
}

/** A shot's scaled picture once it is made; until then null, with the picture queued to be made. */
async function artOf($: EngineInterface, shot: Shot, variant: Variant): Promise<Art | null> {
  const key = artKey(shot.id, variant)
  const kept = arts.get(key)
  if (kept !== undefined) {
    arts.delete(key)
    arts.set(key, kept)

    return kept
  }
  if (failed.has(key) || queued.has(key)) {
    return null
  }
  // Made under an earlier load: the temp folder still holds it.
  try {
    const out = `${await folder($)}/${fileStem(shot.id)}.${variant}.png`
    if (await $.fs.exists(out)) {
      const art = toArt((await $.fs.read(out, { as: 'bytes' })).base64)
      keepArt(key, art)

      return art
    }
  } catch {
    // Made again below.
  }
  queueArt($, shot, variant)

  return null
}

function queueArt($: EngineInterface, shot: Shot, variant: Variant): void {
  const key = artKey(shot.id, variant)
  if (queued.has(key) || failed.has(key) || arts.has(key)) {
    return
  }
  queued.add(key)
  jobs.push({ shot, variant })
  if (isDraining) {
    return
  }
  isDraining = true
  $.clock.after(1, () => {
    void drain($)
  })
}

/** Makes the queued pictures one at a time; each that lands draws its drawings again. */
async function drain($: EngineInterface): Promise<void> {
  try {
    for (let job = jobs.shift(); job !== undefined; job = jobs.shift()) {
      const key = artKey(job.shot.id, job.variant)
      const art = await makeArt($, job.shot, job.variant).catch(() => null)
      queued.delete(key)
      if (art === null) {
        failed.add(key)
      } else {
        keepArt(key, art)
      }
      await update($, artwork, n => n + 1).catch(() => undefined)
    }
  } finally {
    isDraining = false
  }
}

/** A PNG copy no larger than the variant's side, made with sips; JPEG and the rest become PNG too. */
async function makeArt($: EngineInterface, shot: Shot, variant: Variant): Promise<Art | null> {
  const dir = await folder($)
  const source = await sourceOf($, shot, dir)
  if (source === null) {
    return null
  }
  const most = variant === 'thumb' ? THUMB_PIXELS : VIEW_PIXELS
  const side = await largestSide($, shot, source)
  const out = `${dir}/${fileStem(shot.id)}.${variant}.png`
  const scale = side === null || side > most ? ['-Z', String(most)] : []
  const made = await $.process.run([SIPS, '-s', 'format', 'png', ...scale, source, '--out', out], { timeoutMs: 20_000 })
  if (made.exitCode !== 0) {
    return null
  }

  return toArt((await $.fs.read(out, { as: 'bytes' })).base64)
}

/** A file holding the shot's own bytes: written from its row, or the file a tool read it from. */
async function sourceOf($: EngineInterface, shot: Shot, dir: string): Promise<string | null> {
  const written = `${dir}/${fileStem(shot.id)}.source.${extensionOf(shot.mime)}`
  const bytes = pending.get(shot.id)
  if (bytes !== undefined) {
    const decoded = await $.process.run([BASE64_TOOL, '-D', '-o', written], { stdin: bytes.data, timeoutMs: 20_000 })
    if (decoded.exitCode === 0) {
      pending.delete(shot.id)

      return written
    }
  }
  if (await $.fs.exists(written).catch(() => false)) {
    return written
  }
  if (shot.path !== null && (await $.fs.exists(shot.path).catch(() => false))) {
    return shot.path
  }

  return null
}

/** The longer side in pixels: from the PNG header, else as sips reads the file. */
async function largestSide($: EngineInterface, shot: Shot, source: string): Promise<number | null> {
  if (shot.width !== null && shot.height !== null) {
    return Math.max(shot.width, shot.height)
  }
  const asked = await $.process.run([SIPS, '-g', 'pixelWidth', '-g', 'pixelHeight', source], { timeoutMs: 20_000 })
  const width = /pixelWidth:\s*(\d+)/.exec(asked.stdout)?.[1]
  const height = /pixelHeight:\s*(\d+)/.exec(asked.stdout)?.[1]

  return width === undefined || height === undefined ? null : Math.max(Number(width), Number(height))
}

/** The shot's own PNG, for the full-height view, when one drawing can hold it. */
async function originalOf($: EngineInterface, shot: Shot): Promise<Art | null> {
  if (shot.mime !== 'image/png') {
    return null
  }
  const kept = originals.get(shot.id)
  if (kept !== undefined) {
    return kept
  }
  let base64 = pending.get(shot.id)?.data ?? null
  if (base64 === null) {
    const dir = await folder($)
    for (const path of [`${dir}/${fileStem(shot.id)}.source.png`, shot.path]) {
      if (path === null || !(await $.fs.exists(path).catch(() => false))) {
        continue
      }
      try {
        base64 = (await $.fs.read(path, { as: 'bytes' })).base64
        break
      } catch {
        // Over the read limit, or gone: try the next.
      }
    }
  }
  if (base64 === null || decodedBytes(base64) > TREE_IMAGE_BYTES) {
    return null
  }
  const art = toArt(base64)
  originals.set(shot.id, art)
  while (originals.size > MAX_ORIGINALS) {
    const oldest = originals.keys().next().value
    if (oldest === undefined) {
      break
    }
    originals.delete(oldest)
  }

  return art
}

/** Cells for a picture: as wide as allowed, its rows from its aspect, both capped. */
function fit(
  width: number | null,
  height: number | null,
  maxColumns: number,
  maxRows: number,
): { columns: number; rows: number } {
  const columnsCap = Math.max(1, Math.min(255, Math.floor(maxColumns)))
  const rowsCap = Math.max(1, Math.min(255, Math.floor(maxRows)))
  if (width === null || height === null || width <= 0 || height <= 0) {
    return { columns: Math.min(columnsCap, 48), rows: Math.min(rowsCap, 16) }
  }
  // A terminal cell is about 2.25 times as tall as it is wide (8x18 points in iTerm2 and Orca). Rows
  // lean down: a box taller than the picture centres it and leaves a gap above, so a large view's top
  // would sit below the list beside it; a thumbnail's 1.8 rows still make 2.
  const ratio = height / width / 2.25
  let columns = columnsCap
  let rows = Math.max(1, Math.floor(columns * ratio + 0.3))
  if (rows > rowsCap) {
    rows = rowsCap
    columns = Math.max(1, Math.min(columnsCap, Math.round(rows / ratio)))
  }

  return { columns, rows }
}

/** The tools whose results can carry an image: Read, and MCP tools. */
function mayHoldImages(tool: string): boolean {
  return tool === 'Read' || tool.startsWith('mcp__')
}

async function togglePanel($: EngineInterface, which: Panel): Promise<void> {
  const next = (await read($, panel)) === which ? null : which
  await update($, confirm, () => null)
  if (next === 'context') {
    await refreshContext($)
  }
  if (next === 'model') {
    await refreshModels($)
  }
  if (next === 'git') {
    await refreshGit($).catch(() => undefined)
  }
  if (next === 'images') {
    // One gallery at a time: opening it in the band takes it out of the large pane.
    if (await isExpanded($)) {
      await $.ui.close({ id: BIG_PANE }).catch(() => undefined)
    }
    // New images since the gallery was last open: start at the newest; else where it was left.
    if ((await read($, unseen)) > 0) {
      const total = (await read($, shots)).length
      await update($, shown, () => Math.max(0, total - 1))
    }
    await update($, unseen, () => 0)
  }
  await update($, panel, () => next)
}

async function closePanel($: EngineInterface): Promise<void> {
  await update($, confirm, () => null)
  await update($, panel, () => null)
}

async function step($: EngineInterface, delta: number): Promise<void> {
  const total = (await read($, shots)).length
  await update($, shown, n => Math.min(Math.max(0, n + delta), Math.max(0, total - 1)))
}

/** Whether the gallery's large pane is up. */
async function isExpanded($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes().catch(() => [])

  return panes.some(pane => pane.id === BIG_PANE && pane.isPlaced)
}

/**
 * The gallery at the image a transcript row's thumbnail was pressed for: in the large pane when it
 * is up, else above the prompt.
 */
async function openGallery($: EngineInterface, id: string): Promise<void> {
  const list = await read($, shots)
  const index = list.findIndex(shot => shot.id === id)
  await update($, shown, () => (index < 0 ? Math.max(0, list.length - 1) : index))
  await update($, unseen, () => 0)
  if (await isExpanded($)) {
    return
  }
  await update($, confirm, () => null)
  await update($, panel, () => 'images')
}

async function toggleLayout($: EngineInterface): Promise<void> {
  const next: GalleryLayout = (await read($, layout)) === 'left' ? 'bottom' : 'left'
  await update($, layout, () => next)
  await $.store.set(LAYOUT_KEY, next)
}

async function refreshLayout($: EngineInterface): Promise<void> {
  const saved = await $.store.get(LAYOUT_KEY)
  if (saved === 'left' || saved === 'bottom') {
    await update($, layout, () => saved)
  }
  const where = await $.store.get(PLACE_KEY)
  if (where === 'above' || where === 'below') {
    await update($, place, () => where)
  }
}

/** Moves the status line above the prompt or under it, and keeps the choice for later sessions. */
async function movePlace($: EngineInterface, where: ToolbarPlace): Promise<void> {
  await update($, place, () => where)
  await $.store.set(PLACE_KEY, where)
}

/** Moves the gallery from the band into its large pane: the pane opens, the band's panel closes. */
async function expandGallery($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: BIG_PANE, title: 'Images', focus: true, closeOnEscape: true, columns: 200, rows: 40 })
  if (!opened.isPlaced) {
    // No room for it now: leave the gallery where it is rather than show nothing.
    await $.ui.close({ id: BIG_PANE }).catch(() => undefined)
    $.ui.toast('No room for the large gallery in this terminal')

    return
  }
  await closePanel($)
}

/** Moves the gallery back from its large pane into the band above the prompt. */
async function shrinkGallery($: EngineInterface): Promise<void> {
  await $.ui.close({ id: BIG_PANE }).catch(() => undefined)
  await update($, confirm, () => null)
  await update($, panel, () => 'images')
}

async function answer($: EngineInterface, action: CardAction): Promise<void> {
  await update($, card, () => null)
  await $.prompt.submit({ text: action.message, asUser: true })
}

/** Runs a slash command once the session is idle, as if the person typed it. */
function runCommand($: EngineInterface, command: string, args?: string): Promise<void> {
  return $.command.run(args === undefined ? { command } : { command, args }).then(
    () => undefined,
    () => undefined,
  )
}

async function chooseModel($: EngineInterface, choice: ModelChoice): Promise<void> {
  await closePanel($)
  await update($, runtime, now => ({ ...now, model: choice.model }))
  void runCommand($, 'model', choice.model)
}

async function chooseEffort($: EngineInterface, level: string): Promise<void> {
  if (effortLock !== null) {
    return
  }
  await closePanel($)
  await update($, runtime, now => ({ ...now, effort: level }))
  void runCommand($, 'effort', level)
}

function compactNow($: EngineInterface): void {
  void runCommand($, 'compact').then(() => refreshContext($).catch(() => undefined))
}

async function clearNow($: EngineInterface): Promise<void> {
  await closePanel($)
  void runCommand($, 'clear')
}

type Ui = Elements['terminal']

type BandState = {
  steps: PlanStep[]
  reply: NextStep | null
  open: Panel | null
  gauge: Meter | null
  now: Runtime
  choices: ModelChoice[]
  shotCount: number
  fresh: number
  git: GitInfo | null
  spending: SpendLimit | null
}

/** The theme colours a filled button takes, by what it does. */
type Tone = 'claude' | 'suggestion' | 'error' | 'success' | 'warning' | 'inactive'

/** A filled button: its label on the tone's colour, so it reads as something to press. */
function pill(ui: Ui, key: string, label: string, tone: Tone, onPress: () => unknown) {
  const { Button, Text } = ui

  return (
    <Button key={key} plain onPress={() => void onPress()}>
      <Text backgroundColor={tone} color="inverseText" bold>
        {` ${label} `}
      </Text>
    </Button>
  )
}

const PANELS: readonly Panel[] = ['context', 'model', 'effort', 'images', 'git']

function isPanel(value: unknown): value is Panel {
  return PANELS.some(panel => panel === value)
}

// What sets the toolbar's items apart, as a status line does: an ASCII bar, about as tall as the text
// beside it, where the box-drawing `│` fills the whole cell.
const SEPARATOR = ' | '

/**
 * One line right above the prompt, a status line: context, model, effort, git branch, the spend
 * limit when the gateway reports one (left out otherwise, as ccstatusline does), then the images
 * when there are any; all but the spend limit open a panel. Set at the left, under the frame's
 * edge and the prompt. A surface module draws them as plain text: a Button inverts under the pointer, and these keep
 * their colours.
 */
function toolbar(ui: Ui, state: BandState) {
  const { Box, Client, Image } = ui
  const gauge = state.gauge
  const filled =
    gauge === null
      ? 0
      : Math.min(METER_CELLS, Math.max(gauge.percent > 0 ? 1 : 0, Math.round((gauge.percent / 100) * METER_CELLS)))
  type Look = Omit<ChipRun, 'text'>
  const plain: Look = { color: null, dim: false, bold: false }
  const lit: Look = { color: 'claude', dim: false, bold: true }
  const tinted = (color: string): Look => ({ ...plain, color })
  // Each item is one look, never several: lit while its panel is open, plain otherwise.
  const word = (which: Panel) => (state.open === which ? lit : plain)
  const run = (text: string, look: Look): ChipRun => ({ text, ...look })
  const git = state.git
  const spending = state.spending
  const chips: Chip[] = [
    ...(gauge === null
      ? []
      : [
          {
            id: 'context',
            pressable: true,
            runs: [
              // Left blank between the brackets: the bar's picture lies over these cells.
              run(`[${' '.repeat(METER_CELLS)}] ${gauge.percent}%`, word('context')),
            ],
          },
        ]),
    { id: 'model', pressable: true, runs: [run(modelLabel(state.now.model, state.choices), word('model'))] },
    {
      id: 'effort',
      pressable: true,
      runs: [run(`${effortName(state.now.effort ?? 'default')}${effortLock === null ? '' : ' (env)'}`, word('effort'))],
    },
  ]
  // The folder and its branch as a shell prompt shows them: `my-project git:(main)`.
  if (git !== null) {
    const folderName = git.cwd.split('/').filter(part => part !== '').pop() ?? git.cwd
    chips.push({
      id: 'git',
      pressable: true,
      runs: [run(git.branch === null ? folderName : `${folderName} git:(${git.branch})`, word('git'))],
    })
  }
  if (spending !== null) {
    chips.push({
      id: 'spend',
      pressable: false,
      runs: [run(`Spend Limit: ${Math.round(spending.percent * 10) / 10}%`, tinted(fillColor(spending.percent)))],
    })
  }
  if (state.shotCount > 0) {
    chips.push({
      id: 'images',
      pressable: true,
      runs: [run(`Images(${state.shotCount})${state.fresh > 0 ? ' ●' : ''}`, word('images'))],
    })
  }

  const bar = gauge === null ? null : meterPicture(gauge.percent)

  return (
    <Box flexDirection="row">
      <Box>
        <Client key="chips" module="./chips.tsx" props={{ chips, separator: SEPARATOR }} />
        {bar !== null && (
          <Box position="absolute" left={1} top={0}>
            <Image
              key="meter"
              source={{ rgba: bar.rgba, width: bar.width, height: bar.height }}
              columns={METER_CELLS}
              rows={1}
              alt={`${'■'.repeat(filled)}${'·'.repeat(METER_CELLS - filled)}`}
            />
          </Box>
        )}
        {/* A picture takes no presses: this target over it, drawing nothing, takes them for the chip. */}
        {bar !== null && (
          <Box position="absolute" left={1} top={0}>
            <Client key="meter-hit" module="./hit.tsx" props={{ press: 'context', columns: METER_CELLS, rows: 1 }} />
          </Box>
        )}
      </Box>
    </Box>
  )
}

/** How a panel closes: `close` closes the open panel, `dismiss` takes the next-step card away, `big` closes the large gallery pane. */
type Close = 'close' | 'dismiss' | 'big'

/**
 * A control in a panel's heading, `[glyph]` in one color: as the engine's own `[-]` beside the band
 * is, so the pointer inverts it whole. Dim, as `[-]` is, unless it carries a color of its own.
 */
function iconButton(ui: Ui, key: string, glyph: string, color: string | null, onPress: () => unknown) {
  const { Button, Text } = ui

  return color === null ? (
    <Button key={key} plain dimColor onPress={() => void onPress()}>
      <Text>{`[${glyph}]`}</Text>
    </Button>
  ) : (
    <Button key={key} plain onPress={() => void onPress()}>
      <Text color={color}>{`[${glyph}]`}</Text>
    </Button>
  )
}

/** A panel's close mark, a red `[✕]` at its top right. */
function closeMark($: EngineInterface, ui: Ui, close: Close) {
  const onPress =
    close === 'close'
      ? () => closePanel($)
      : close === 'dismiss'
        ? () => update($, card, () => null)
        : () => $.ui.close({ id: BIG_PANE })

  return iconButton(ui, `mark-${close}`, '✕', 'error', onPress)
}

/** A panel's heading: its title, a note and any controls on the right, and its close mark. */
type Head = {
  title: string
  note: string
  controls: readonly RenderElement[]
  close: Close | null
  /** A title in grey rather than bold, as the next-step card's count is. */
  isQuiet?: boolean
}

/** A panel: its heading, where it has one, and its rows. */
type Sheet = { head: Head | null; rows: readonly RenderElement[] }

function heading(title: string, note: string, controls: readonly RenderElement[], close: Close | null): Head {
  return { title, note, controls, close }
}

function sheet(head: Head | null, ...rows: RenderElement[]): Sheet {
  return { head, rows }
}

/** A heading's right end, each part erasing what lies under it: ` note  [..] [✕] `. */
function headTail($: EngineInterface, ui: Ui, head: Head) {
  const { Text } = ui
  const marks = [...head.controls, ...(head.close === null ? [] : [closeMark($, ui, head.close)])]

  return [
    <Text> </Text>,
    ...(head.note === '' ? [] : [<Text dimColor>{head.note}</Text>, <Text>  </Text>]),
    ...marks.flatMap(mark => [mark, <Text> </Text>]),
  ]
}

/** A heading as a row of its own, where nothing frames the panel: the large gallery pane. */
function headRow($: EngineInterface, ui: Ui, head: Head) {
  const { Box, Text } = ui

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box flexShrink={1}>
        <Text {...(head.isQuiet === true ? { dimColor: true } : { bold: true })} wrap="truncate-end">
          {head.title}
        </Text>
      </Box>
      <Box flexDirection="row" flexShrink={0} marginLeft={2}>
        {headTail($, ui, head)}
      </Box>
    </Box>
  )
}

/** The frame's top edge with the heading set into it: `╭─ Title ──── note [..] [✕] ─╮`. */
function headEdge($: EngineInterface, ui: Ui, head: Head) {
  const { Box, Text } = ui

  return (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        <Text dimColor>{'╭─ '}</Text>
      </Box>
      <Box flexShrink={1}>
        <Text {...(head.isQuiet === true ? { dimColor: true } : { bold: true })} wrap="truncate-end">
          {head.title}
        </Text>
      </Box>
      <Text> </Text>
      {/* The line between the title and the right end: no width of its own, all the row leaves, one row. */}
      <Box flexGrow={1} flexShrink={0} width={0} height={1} overflow="hidden">
        <Text dimColor wrap="wrap">
          {'─'.repeat(400)}
        </Text>
      </Box>
      <Box flexDirection="row" flexShrink={0}>
        {headTail($, ui, head)}
      </Box>
      <Box flexShrink={0}>
        <Text dimColor>─╮</Text>
      </Box>
    </Box>
  )
}

/** A panel in the band: a rounded frame, its heading drawn over the top edge. */
function framed($: EngineInterface, ui: Ui, panel: Sheet, gap: number) {
  const { Box } = ui

  return (
    <Box flexDirection="column" marginBottom={gap}>
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        {panel.rows}
      </Box>
      {panel.head !== null && (
        <Box position="absolute" left={0} right={0} top={0}>
          {headEdge($, ui, panel.head)}
        </Box>
      )}
    </Box>
  )
}

/** A panel with nothing around it: the heading a row of its own, then the rows. */
function unframed($: EngineInterface, ui: Ui, panel: Sheet) {
  const { Box } = ui

  return <Box flexDirection="column">{panel.head === null ? panel.rows : [headRow($, ui, panel.head), ...panel.rows]}</Box>
}

/** Where a picture is still being made, or has none: a box its size, so nothing moves when it lands. */
function placeholder(ui: Ui, columns: number, rows: number, text: string) {
  const { Box, Text } = ui

  return (
    <Box width={columns} height={rows} justifyContent="center" alignItems="center">
      <Text dimColor wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
}

/** What a press on a transcript thumbnail posts: the gallery, opened at that image. */
const OPEN_PREFIX = 'open:'

/**
 * Beside a transcript row: its last few images, each opening the gallery at itself when pressed,
 * and the count of the rest, which opens it at the first.
 */
async function strip($: EngineInterface, ui: Ui, list: readonly Shot[]) {
  const { Box, Client, Image, Text } = ui
  const recent = list.slice(-ROW_THUMBS)
  const room = budget()
  const pictures = await Promise.all(recent.map(shot => artOf($, shot, 'thumb')))
  const first = list[0]
  const more = list.length - recent.length
  // A picture takes no presses: a target that draws nothing lies over each to take them.
  const pressable = (shot: Shot, columns: number, rows: number, face: RenderElement) => (
    <Box key={`thumb-box-${shot.id}`} width={columns} height={rows}>
      {face}
      <Box position="absolute" left={0} top={0}>
        <Client
          key={`thumb-${shot.id}`}
          module="./hit.tsx"
          props={{ press: `${OPEN_PREFIX}${shot.id}`, columns, rows }}
        />
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="row" gap={1} flexShrink={0} marginLeft={2}>
      {more > 0 && first !== undefined && (
        <Client
          key={`more-${first.id}`}
          module="./chips.tsx"
          props={{
            chips: [{ id: `${OPEN_PREFIX}${first.id}`, pressable: true, runs: [{ text: `+${more}`, color: null, dim: true, bold: false }] }],
            separator: '',
          }}
        />
      )}
      {recent.map((shot, i) => {
        const picture = pictures[i] ?? null
        if (picture === null || !spend(room, picture)) {
          return pressable(shot, 1, 1, <Text dimColor>▣</Text>)
        }
        const size = fit(picture.width, picture.height, 6, 2)

        return pressable(
          shot,
          size.columns,
          size.rows,
          <Image key={`row-${shot.id}`} source={{ png: picture.png }} columns={size.columns} rows={size.rows} alt="▣" />,
        )
      })}
    </Box>
  )
}

/** A transcript row as the engine drew it, its images to the right as the desktop app lays them. */
async function withStrip($: EngineInterface, ui: Ui, drawn: RenderElement, list: readonly Shot[]) {
  const { Box } = ui
  // Thumbnails still being made: the row draws again as each lands.
  await read($, artwork)

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box flexGrow={1} flexShrink={1}>
        {drawn}
      </Box>
      {await strip($, ui, list)}
    </Box>
  )
}

function planSheet(ui: Ui, room: number, steps: readonly PlanStep[], isSpinning: boolean) {
  const { Box, Raster, Text } = ui
  const running = steps.findIndex(one => one.status === 'in_progress')
  // Where they do not all fit in the frame: the running step and those around it.
  const cap = Math.max(1, room - 2)
  const first = Math.min(Math.max(0, running - Math.floor(cap / 2)), Math.max(0, steps.length - cap))

  return sheet(
    null,
    ...steps.slice(first, first + cap).map((one, at) => {
      const i = first + at

      return (
        <Box flexDirection="row">
          {isSpinning && i === running ? (
            <Raster key="spin" columns={1} rows={1} cells={SPIN_CELLS[spinFrame] ?? ''} />
          ) : (
              <Text {...MARK_STYLE[one.status]}>{STEP_GLYPH[one.status]}</Text>
          )}
          <Text> </Text>
          <Text {...STEP_STYLE[one.status]} wrap="truncate-end">
            {one.content}
          </Text>
        </Box>
      )
    }),
  )
}

function cardSheet($: EngineInterface, ui: Ui, steps: readonly PlanStep[], reply: NextStep) {
  const { Box, Markdown, Text } = ui
  const done = steps.filter(one => one.status === 'completed').length
  const close = 'dismiss' as const
  numbered = reply.actions.map(action => () => answer($, action))

  return sheet(
    {
      ...heading(steps.length > 0 ? `✔ ${done} of ${steps.length} steps done` : 'Next step', '', [], close),
      isQuiet: true,
    },
    <Markdown text={reply.recap} />,
    ...(reply.ask === null ? [] : [<Text bold>{reply.ask}</Text>]),
    ...(reply.actions.length === 0
      ? []
      : [
          <Box flexDirection="row" gap={2}>
            {reply.actions.map((action, i) =>
              pill(ui, `action-${i + 1}`, `${i + 1} ${action.label}`, i === 0 ? 'claude' : 'inactive', () => answer($, action)),
            )}
          </Box>,
        ]),
  )
}

function contextPanel(
  $: EngineInterface,
  ui: Ui,
  view: ContextView | null,
  open: string | null,
  asking: string | null,
  width: number,
  room: number,
) {
  const { Box, Button, Text } = ui
  const close = 'close' as const
  if (view === null) {
    return sheet(heading('Context', '', [], close), <Text dimColor>No reading yet: it comes with the first reply.</Text>)
  }
  const percent = view.maxTokens > 0 ? Math.round((view.totalTokens / view.maxTokens) * 100) : 0
  const perRow = width >= 76 ? 2 : 1
  const cell = Math.floor(width / perRow) - (perRow > 1 ? 2 : 0)
  const grid: (typeof view.rows)[] = []
  for (let i = 0; i < view.rows.length; i += perRow) {
    grid.push(view.rows.slice(i, i + perRow))
  }
  const lists = [
    { key: 'mcp', label: 'MCP tools', items: view.mcp, count: view.mcpToolCount },
    { key: 'memory', label: 'Memory files', items: view.memory, count: view.memory.length },
    { key: 'agents', label: 'Custom agents', items: view.agents, count: view.agents.length },
    { key: 'skills', label: 'Skills', items: view.skills, count: view.skills.length },
  ].filter(list => list.count > 0)
  const openList = lists.find(list => list.key === open)
  // Always drawn: the frame (its heading in the top edge), the bar, the auto-compact line, the list toggles, and the
  // buttons, a blank above them where rows allow. An open list comes next, then the categories.
  const isRoomy = room >= 13
  const fixed = 2 + 2 + (lists.length > 0 ? 1 : 0) + (isRoomy ? 2 : 1)
  const spare = Math.max(1, room - fixed)
  const itemCap = openList === undefined ? 0 : Math.min(MAX_LISTED, openList.items.length, Math.max(1, spare - 1))
  const moreItems = openList === undefined ? 0 : openList.items.length - itemCap
  const gridCap = Math.max(1, Math.min(grid.length, spare - itemCap - (moreItems > 0 ? 1 : 0)))

  return sheet(
    heading('Context', `${percent}% used · ${tokens(view.totalTokens)} / ${tokens(view.maxTokens)}`, [], close),
    <Box flexDirection="row">
      {segments(view, width).map(segment => (
        <Text {...(segment.color === null ? { dimColor: true } : { color: segment.color })}>
          {segment.glyph.repeat(segment.cells)}
        </Text>
      ))}
    </Box>,
    ...grid.slice(0, gridCap).map(pair => (
      <Box flexDirection="row" gap={perRow > 1 ? 4 : 0}>
        {pair.map(row => (
          <Box flexDirection="row" width={cell}>
            <Text {...(row.kind === 'free' ? { dimColor: true } : { color: row.color })}>■ </Text>
            <Box flexGrow={1}>
              <Text dimColor={row.kind === 'deferred' || row.kind === 'free'} wrap="truncate-end">
                {row.kind === 'deferred' && !row.name.endsWith('(deferred)') ? `${row.name} (deferred)` : row.name}
              </Text>
            </Box>
            <Box width={8} justifyContent="flex-end">
              <Text dimColor>{tokens(row.tokens)}</Text>
            </Box>
            <Box width={7} justifyContent="flex-end">
              <Text>{share(row.tokens, view.maxTokens)}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    )),
    <Text dimColor>
      {view.autoCompactAt === null
        ? 'Auto-compact is off'
        : `Auto-compacts at ${tokens(view.autoCompactAt)} · ${tokens(Math.max(0, view.autoCompactAt - view.totalTokens))} to go`}
    </Text>,
    <Box flexDirection="row" gap={3}>
      {lists.map(list => (
        <Button
          key={`list-${list.key}`}
          plain
          label={`${open === list.key ? '▾' : '▸'} ${list.label} ${list.count}`}
          onPress={() => update($, expanded, current => (current === list.key ? null : list.key))}
        />
      ))}
    </Box>,
    ...(openList === undefined
      ? []
      : openList.items.slice(0, itemCap).map(item => (
          <Box flexDirection="row" paddingLeft={2}>
            <Box flexGrow={1}>
              <Text wrap="truncate-start">{item.name}</Text>
            </Box>
            <Box width={18} justifyContent="flex-end">
              <Text dimColor wrap="truncate-end">
                {item.detail}
              </Text>
            </Box>
            <Box width={9} justifyContent="flex-end">
              <Text dimColor>{tokens(item.tokens)}</Text>
            </Box>
          </Box>
        ))),
    ...(moreItems > 0 ? [<Text dimColor>{`  … ${moreItems} more`}</Text>] : []),
    <Box flexDirection="row" gap={2} marginTop={isRoomy ? 1 : 0}>
      {asking === 'clear'
        ? [
            <Text color="warning">Clear the conversation and start with an empty context?</Text>,
            pill(ui, 'clear-yes', 'Clear', 'error', () => clearNow($)),
            pill(ui, 'clear-no', 'Cancel', 'inactive', () => update($, confirm, () => null)),
          ]
        : [
            pill(ui, 'compact', '⇣ Compact', 'suggestion', () => compactNow($)),
            pill(ui, 'clear', '✕ Clear', 'error', () => update($, confirm, () => 'clear')),
            pill(ui, 'refresh', '↻ Refresh', 'inactive', () => refreshContext($)),
          ]}
    </Box>,
  )
}

function modelPanel($: EngineInterface, ui: Ui, choices: readonly ModelChoice[], current: string | null, room: number) {
  const { Button, Text } = ui
  const now = current === null ? null : normalizeModel(current)
  // The frame, its heading in the top edge, takes two rows; the current model always shows.
  const cap = Math.max(1, Math.min(9, room - 2))
  const at = choices.findIndex(choice => normalizeModel(choice.model) === now)
  const shown = at >= cap ? [...choices.slice(0, cap - 1), ...choices.slice(at, at + 1)] : choices.slice(0, cap)
  const nameWidth = Math.min(30, Math.max(0, ...shown.map(choice => choice.label.length)) + 2)
  numbered = shown.map(choice => () => chooseModel($, choice))

  return sheet(
    heading('Model', 'switches with /model', [], 'close' as const),
    ...shown.map((choice, i) => {
      const isCurrent = normalizeModel(choice.model) === now

      return (
        <Button key={`model-${i + 1}`} plain onPress={() => chooseModel($, choice)}>
          <Text {...(isCurrent ? { color: 'claude', bold: true } : {})}>
            {`${i + 1} ${isCurrent ? '●' : '○'} ${choice.label.padEnd(nameWidth)}${choice.detail}`}
          </Text>
        </Button>
      )
    }),
  )
}

function effortPanel($: EngineInterface, ui: Ui, current: string | null) {
  const { Box, Button, Text } = ui
  const close = 'close' as const
  if (effortLock !== null) {
    const lock = effortLock

    return sheet(
      heading('Effort', 'held by the environment', [], close),
      <Box flexDirection="row" gap={3}>
        {EFFORTS.map(level =>
          level === lock ? (
            <Text backgroundColor="inactive" color="inverseText" bold>
              {` ${effortName(level)} `}
            </Text>
          ) : (
            <Text dimColor>{effortName(level)}</Text>
          ),
        )}
      </Box>,
      <Text dimColor wrap="wrap">
        {`CLAUDE_CODE_EFFORT_LEVEL=${lock} in settings env overrides /effort for the whole session. Remove it there to switch here.`}
      </Text>,
    )
  }

  numbered = EFFORTS.map(level => () => chooseEffort($, level))

  return sheet(
    heading('Effort', 'switches with /effort', [], close),
    <Box flexDirection="row" gap={2}>
      {EFFORTS.map((level, i) => (
        <Button key={`effort-${level}`} plain onPress={() => chooseEffort($, level)}>
          {level === current ? (
            <Text backgroundColor="claude" color="inverseText" bold>
              {` ${i + 1} ${effortName(level)} `}
            </Text>
          ) : (
            <Text>{` ${i + 1} ${effortName(level)} `}</Text>
          )}
        </Button>
      ))}
    </Box>,
  )
}

/** The git chip's panel: the directory the session runs in, and where its branch stands. */
function gitPanel($: EngineInterface, ui: Ui, info: GitInfo | null) {
  const { Box, Text } = ui
  const close = 'close' as const
  if (info === null) {
    return sheet(heading('Directory', '', [], close), <Text dimColor>Reading the directory…</Text>)
  }
  const isRepo = info.root !== null && info.branch !== null
  const tracking =
    info.upstream === null ? 'no upstream' : `↑${info.ahead} ↓${info.behind} against ${info.upstream}`

  return sheet(
    heading('Directory', isRepo ? `⎇ ${info.branch ?? ''}` : 'not a git repository', [], close),
    <Text bold wrap="truncate-start">
      {tilde(info.cwd)}
    </Text>,
    ...(isRepo
      ? [
          <Text dimColor wrap="truncate-end">
            {`${info.changed === 0 ? 'clean' : `${info.changed} changed`} · ${tracking}`}
          </Text>,
        ]
      : []),
    ...(info.root !== null && info.root !== info.cwd
      ? [<Text dimColor wrap="truncate-start">{`repository  ${tilde(info.root)}`}</Text>]
      : []),
    <Box flexDirection="row" gap={2} marginTop={1}>
      {pill(ui, 'copy-path', 'Copy path', 'suggestion', () => $.ui.copy({ text: info.cwd }))}
      {pill(ui, 'git-refresh', '↻ Refresh', 'inactive', () => refreshGit($))}
    </Box>,
  )
}

/** A thumbnail's rows in the gallery's left column: odd, so its label has a middle row. */
const COLUMN_THUMB_ROWS = 3

/** The widest a thumbnail in the gallery's left column may be: a square picture three rows tall. */
const COLUMN_THUMB_COLUMNS = 7

/**
 * A thumbnail's cells in the gallery's left column: three rows, or one for a wide picture, never two,
 * so the label beside it sits on its middle row.
 */
function columnThumb(width: number | null, height: number | null): { columns: number; rows: number } {
  const size = fit(width, height, COLUMN_THUMB_COLUMNS, COLUMN_THUMB_ROWS)
  if (size.rows !== 2 || width === null || height === null || width <= 0 || height <= 0) {
    return size
  }
  const ratio = height / width / 2.25
  const rows = ratio < 0.36 ? 1 : COLUMN_THUMB_ROWS

  return { columns: Math.max(1, Math.min(COLUMN_THUMB_COLUMNS, Math.round(rows / ratio))), rows }
}

/** What a press on a gallery thumbnail posts: show the image at that place in the list. */
const PICK_PREFIX = 'pick:'

/** One gallery entry: its thumbnail and its number (with its label, in the column), either pressed to show it. */
function galleryEntry(
  $: EngineInterface,
  ui: Ui,
  shot: Shot,
  at: number,
  isCurrent: boolean,
  thumb: Art | null,
  isColumn: boolean,
  labelWidth: number,
) {
  const { Box, Button, Client, Image, Text } = ui
  const width = thumb?.width ?? shot.width
  const height = thumb?.height ?? shot.height
  const size = isColumn ? columnThumb(width, height) : fit(width, height, 4, 2)
  // The whole entry in one look: the current one lit, the rest dim.
  const tone = isCurrent ? { color: 'claude', bold: true } : { dimColor: true }
  const name = shotName(shot)
  const label = name.length > labelWidth ? `${name.slice(0, Math.max(1, labelWidth - 1))}…` : name
  // A picture takes no presses: a target that draws nothing lies over it to take them.
  const picture = (
    <Box key={`pick-box-${shot.id}`} width={size.columns} height={size.rows}>
      {thumb === null ? (
        placeholder(ui, size.columns, size.rows, '▣')
      ) : (
        <Image key={`pick-img-${shot.id}`} source={{ png: thumb.png }} columns={size.columns} rows={size.rows} alt="▣" />
      )}
      <Box position="absolute" left={0} top={0}>
        <Client
          key={`pick-hit-${shot.id}`}
          module="./hit.tsx"
          props={{ press: `${PICK_PREFIX}${at}`, columns: size.columns, rows: size.rows }}
        />
      </Box>
    </Box>
  )
  const button = (
    <Button key={`pick-${at + 1}`} plain onPress={() => update($, shown, () => at)}>
      <Text {...tone}>{isColumn ? `${at + 1} ${label}` : String(at + 1)}</Text>
    </Button>
  )
  // A Button fills the room it is given, its text at the top left: held in a Box of its text's size,
  // the label centres beside the picture, or under it.
  const pick = isColumn ? (
    <Box flexShrink={1}>{button}</Box>
  ) : (
    <Box width={String(at + 1).length} flexShrink={0}>
      {button}
    </Box>
  )

  return isColumn ? (
    <Box flexDirection="row" gap={1} height={COLUMN_THUMB_ROWS} alignItems="center">
      <Box width={COLUMN_THUMB_COLUMNS} justifyContent="center" flexShrink={0}>
        {picture}
      </Box>
      {pick}
    </Box>
  ) : (
    <Box flexDirection="column" width={5} alignItems="center">
      {picture}
      {pick}
    </Box>
  )
}

/** The image large, with the gallery's thumbnails in a column on the left or a strip below. */
async function galleryPanel(
  $: EngineInterface,
  ui: Ui,
  list: readonly Shot[],
  index: number,
  mode: GalleryLayout,
  width: number,
  rows: number,
  isPane: boolean,
) {
  const { Box, Image, Text } = ui
  const close = isPane ? ('big' as const) : ('close' as const)
  const shot = list[index]
  if (shot === undefined) {
    return sheet(heading('Image Viewer', '', [], close), <Text dimColor>No images in this conversation yet.</Text>)
  }
  const isColumn = mode === 'left'
  const listWidth = isColumn ? Math.min(32, Math.max(22, Math.floor(width * 0.3))) : width
  const viewWidth = isColumn ? Math.max(8, width - listWidth - 2) : width
  // A blank row above and below the picture (and the list beside it) sets it off from the heading and buttons.
  // The picture's path takes a row under it, a blank row apart.
  const viewRows = Math.max(3, isColumn ? rows - 4 : rows - 7)
  // In the column, each entry and a blank row after it, but for the last.
  const count = isColumn ? Math.max(1, Math.floor((rows - 1) / (COLUMN_THUMB_ROWS + 1))) : Math.max(1, Math.floor((width + 1) / 6))
  const start = Math.min(Math.max(0, index - Math.floor(count / 2)), Math.max(0, list.length - count))
  const visible = list.slice(start, start + count)
  // The large picture first, in queue and in the drawing's budget; thumbnails take what is left.
  const room = budget()
  // The large pane shows the original when it leaves room for the thumbnails, else the viewing copy.
  const original = isPane ? await originalOf($, shot) : null
  const large =
    original !== null && decodedBytes(original.png) <= TREE_IMAGE_BYTES / 2 ? original : await artOf($, shot, 'view')
  const picture = large !== null && spend(room, large) ? large : null
  const thumbs = await Promise.all(visible.map(one => artOf($, one, 'thumb')))
  const entries = visible.map((one, i) => {
    const thumb = thumbs[i] ?? null

    return galleryEntry(
      $,
      ui,
      one,
      start + i,
      start + i === index,
      thumb !== null && spend(room, thumb) ? thumb : null,
      isColumn,
      listWidth - COLUMN_THUMB_COLUMNS - 6,
    )
  })
  const size = fit(picture?.width ?? shot.width, picture?.height ?? shot.height, viewWidth, viewRows)
  const waiting = failed.has(artKey(shot.id, 'view')) ? `No preview for this ${shot.mime} image` : 'Preparing preview…'
  const view = (
    <Box width={viewWidth} flexDirection="column" alignItems="center">
      {picture === null ? (
        placeholder(ui, size.columns, size.rows, waiting)
      ) : (
        <Image key="view" source={{ png: picture.png }} columns={size.columns} rows={size.rows} alt={shotName(shot)} />
      )}
      <Box width={viewWidth} justifyContent="center" marginTop={1}>
        <Text dimColor wrap="truncate-start">
          {shot.path === null ? shotName(shot) : tilde(shot.path)}
        </Text>
      </Box>
    </Box>
  )
  // The layout mark shows the layout in use: the list on the left (◧) or below (⬓).
  const controls = [
    iconButton(ui, 'layout', isColumn ? '◧' : '⬓', null, () => toggleLayout($)),
    isPane
      ? iconButton(ui, 'smallview', '⤢', 'success', () => shrinkGallery($))
      : iconButton(ui, 'bigview', '⤢', 'success', () => expandGallery($)),
  ]
  const tag = isPane ? 'big-' : ''

  return sheet(
    heading('Image Viewer', `${index + 1} / ${list.length}`, controls, close),
    isColumn ? (
      // The list and the picture start on the same row.
      <Box flexDirection="row" gap={2} alignItems="flex-start" marginY={1}>
        <Box flexDirection="column" width={listWidth} gap={1}>
          {entries}
        </Box>
        {view}
      </Box>
    ) : (
      <Box flexDirection="column" marginTop={1}>
        {view}
        <Box flexDirection="row" gap={1} justifyContent="center" marginTop={1}>
          {entries}
        </Box>
      </Box>
    ),
    <Box flexDirection="row" gap={2}>
      {pill(ui, `${tag}prev`, '‹ Prev', 'suggestion', () => step($, -1))}
      {pill(ui, `${tag}next`, 'Next ›', 'suggestion', () => step($, 1))}
      {pill(ui, `${tag}latest`, 'Latest', 'inactive', () => step($, list.length))}
    </Box>,
  )
}

/** What the band and the status line draw from: every read subscribes the drawing that makes it. */
async function readBandState($: EngineInterface): Promise<BandState> {
  const list = await read($, shots)

  return {
    steps: await read($, plan),
    reply: await read($, card),
    open: await read($, panel),
    gauge: await read($, meter),
    now: await read($, runtime),
    choices: await read($, models),
    shotCount: list.length,
    fresh: await read($, unseen),
    git: await read($, gitInfo),
    spending: await read($, spendLimit),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isActive = e.surface === 'terminal' && e.isInteractive
    if (isActive) {
      await $.tool.register(PLAN_SPEC)
      await $.tool.register(WRAP_SPEC)
      await $.command.register({ name: 'toolbar', description: 'Put the status line above the prompt or under it', argumentHint: '[above|below]' })
      // Each read stands alone: the band draws what it has, and a later request fills the rest in.
      const quietly = () => undefined
      await refreshModel($).catch(quietly)
      await refreshEffort($).catch(quietly)
      await refreshModels($).catch(quietly)
      await refreshLayout($).catch(quietly)
      await refreshUsage($).catch(quietly)
      home = (await $.env.get('HOME').catch(quietly)) ?? null
      await refreshGit($).catch(quietly)
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (isActive && e.reason === 'clear') {
      stopSpinner()
      pending.clear()
      calls.clear()
      await update($, plan, () => [])
      await update($, card, () => null)
      await update($, shots, () => [])
      await update($, shown, () => 0)
      await update($, unseen, () => 0)
      await update($, context, () => null)
      await update($, meter, () => null)
      await update($, panel, () => null)
      await update($, confirm, () => null)
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const isOffered = e.tools.includes(PLAN_TOOL)
    const isDesktop = e.tools.some(tool => tool.startsWith('mcp__ccd_turn__'))
    if (!isOffered || isDesktop) {
      return composed
    }

    return { sections: [...composed.sections, { id: 'cc-hud-lite:workflow', text: WORKFLOW, scope: 'session' as const }] }
  })

  // A new prompt of the person's starts a fresh list and takes the old card and panel away.
  on('turn.start', async ($, e, next) => {
    if (isActive && e.agentId === undefined && e.text !== '') {
      await update($, plan, () => [])
      await update($, card, () => null)
      await update($, panel, () => null)
      await update($, confirm, () => null)
      // After /clear the new session's state starts empty: read the branch again now, not at the turn's end.
      if ((await read($, gitInfo)) === null) {
        void refreshGit($).catch(() => undefined)
      }
    }

    return next(e)
  })

  // Each request names the model and effort it is sent with: what the toolbar shows.
  on('turn.step', async function* ($, e, next) {
    if (isActive && e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      void read($, runtime)
        .then(now => (now.model === e.model && now.effort === effort ? undefined : update($, runtime, () => ({ model: e.model, effort }))))
        .catch(() => undefined)
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      stopSpinner()
      if (isActive) {
        void refreshUsage($).catch(() => undefined)
        void refreshGit($).catch(() => undefined)
      }
    }

    return next(e)
  })

  on('tool.call', { tool: PLAN_TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const current = await read($, plan)
    let steps: PlanStep[]
    if (input.items !== undefined) {
      const parsed = readSteps(input.items)
      if (typeof parsed === 'string') {
        return { deny: parsed }
      }
      steps = parsed
    } else if (input.advance === true || input.done !== undefined || input.start !== undefined) {
      if (current.length === 0) {
        return { deny: 'There is no plan yet: send {"items": [...]} first.' }
      }
      if (input.advance === true) {
        steps = advance(current)
      } else {
        const done = readPositions(input.done, current.length)
        const start = readPositions(input.start, current.length)
        if (typeof done === 'string') {
          return { deny: done }
        }
        if (typeof start === 'string') {
          return { deny: start }
        }
        steps = current.map((one, i) => {
          if (done.includes(i)) {
            return mark(one, 'completed')
          }
          if (start.includes(i)) {
            return mark(one, 'in_progress')
          }

          return start.length > 0 && one.status === 'in_progress' ? mark(one, 'pending') : one
        })
      }
    } else {
      return { deny: 'Pass {"items": [...]} (the whole plan), {"advance": true}, or {"done": [n], "start": m}.' }
    }
    await update($, plan, () => steps)

    return { result: describePlan(steps) }
  }).catch(() => ({ deny: 'cc-hud-lite: update_plan failed; the list is unchanged.' }))

  on('tool.call', { tool: WRAP_TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const recap = typeof input.recap === 'string' ? input.recap.trim() : ''
    if (recap === '') {
      return { deny: 'recap is required: two or three short sentences.' }
    }
    const ask = typeof input.ask === 'string' && input.ask.trim() !== '' ? input.ask.trim() : null
    const actions = ask === null ? [] : readActions(input.actions)
    if (actions.length === 0) {
      // Nothing for the person to press: the closing message says it all, so no card and no list stay up.
      await update($, card, () => null)
      await update($, plan, () => [])

      return {
        result: 'Nothing is drawn: there is no choice to offer. Write your closing message now: your full answer, the last thing you say this turn.',
      }
    }
    await update($, card, () => ({ recap, ask, actions }))
    await update($, plan, steps => steps.map(one => mark(one, 'completed')))

    return {
      result:
        'Shown above the prompt with its question and buttons; do not ask the question again. Write your closing message now: your full answer, the last thing you say this turn.',
    }
  }).catch(() => ({ deny: 'cc-hud-lite: wrap_up failed; nothing is shown.' }))

  // Every image the conversation keeps passes here: pasted, or in a tool's result.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (isActive && e.agentId === undefined) {
      const found = collect(e.message.content, e.door, e.uuid)
      if (found.length > 0) {
        // Each row's thumbnail is made at once, while its bytes are at hand.
        for (const shot of found) {
          queueArt($, shot, 'thumb')
        }
        await update($, shots, list => [...list, ...found].slice(-MAX_SHOTS))
        if ((await read($, panel)) !== 'images') {
          await update($, unseen, n => n + found.length)
        }
      }
    }

    return stored
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    const { tokens: used, percent, window } = e.context
    if (isActive && e.changed.includes('context') && used !== undefined && percent !== undefined) {
      await update($, meter, () => ({ tokens: used, window, percent }))
      if ((await read($, panel)) === 'context') {
        await refreshContext($)
      }
    }
    if (isActive && e.changed.includes('rateLimits')) {
      await update($, spendLimit, () => spendOf(e.rateLimits))
    }

    return measured
  })

  // A model or effort the person switched by typing shows in the toolbar at once.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    if (isActive) {
      const model = await $.session.model()
      await update($, runtime, now => ({ ...now, model }))
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const ran = await next(e)
    const level = e.args.trim().split(/\s+/)[0] ?? ''
    if (isActive && (EFFORTS.some(effort => effort === level) || level === 'auto')) {
      await update($, runtime, now => ({ ...now, effort: effortLock ?? level }))
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'toolbar' }, async ($, e) => {
    const asked = e.args.trim()
    const where: ToolbarPlace =
      asked === 'above' || asked === 'below' ? asked : (await read($, place)) === 'above' ? 'below' : 'above'
    await movePlace($, where)

    return { text: where === 'above' ? 'Status line: above the prompt.' : 'Status line: under the prompt.' }
  })

  // A digit typed at an empty prompt presses the band's numbered choice, as a Button's hotkey would.
  on('prompt.edit', async ($, e, next) => {
    const act = /^[1-9]$/.test(e.inputText) && e.text === '' ? numbered[Number(e.inputText) - 1] : undefined
    if (!isActive || act === undefined) {
      return next(e)
    }
    await act()

    return { text: '', cursor: 0 }
  })

  on('ui.message', async ($, e, next) => {
    const press = typeof e.data === 'object' && e.data !== null ? (e.data as { press?: unknown }).press : undefined
    if (!isActive || typeof press !== 'string') {
      return next(e)
    }
    if (press.startsWith(OPEN_PREFIX)) {
      await openGallery($, press.slice(OPEN_PREFIX.length))

      return {}
    }
    if (press.startsWith(PICK_PREFIX)) {
      const at = Number(press.slice(PICK_PREFIX.length))
      if (Number.isInteger(at) && at >= 0) {
        await update($, shown, () => at)
      }

      return {}
    }
    if ((e.element !== 'chips' && e.element !== 'meter-hit') || !isPanel(press)) {
      return next(e)
    }
    await togglePanel($, press)

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isActive || e.surface !== 'terminal' || e.props.hasSurvey) {
      // Drawn before session.start turned the mod on: reading what it writes draws the band again then.
      await read($, runtime)

      return next(e)
    }
    bandId = e.requestId
    // The panel or card drawn below numbers its own choices again.
    numbered = []
    const ui = $.ui.resolve(e)
    const { Box } = ui
    const list = await read($, shots)
    const state = await readBandState($)
    const isAbove = (await read($, place)) === 'above'
    // Inside the frame: its sides and a cell of padding each way.
    const width = Math.max(20, e.props.bodyColumns - 4)
    // With the status line here: a blank row between the frame and it, as the engine keeps one under
    // it, where rows allow; the rest of the band is the frame's.
    const gap = isAbove && e.props.maxRows >= 16 ? 1 : 0
    const room = Math.max(4, e.props.maxRows - (isAbove ? 1 : 0) - gap)
    const isSpinning =
      e.props.isWorking && state.open === null && state.steps.some(one => one.status === 'in_progress')
    if (isSpinning) {
      startSpinner($)
    } else {
      stopSpinner()
    }

    let body: Sheet | null = null
    if (state.open === 'context') {
      body = contextPanel($, ui, await read($, context), await read($, expanded), await read($, confirm), width, room)
    } else if (state.open === 'model') {
      body = modelPanel($, ui, state.choices, state.now.model, room)
    } else if (state.open === 'effort') {
      body = effortPanel($, ui, state.now.effort)
    } else if (state.open === 'git') {
      body = gitPanel($, ui, state.git)
    } else if (state.open === 'images') {
      await read($, artwork)
      const index = Math.min(Math.max(0, await read($, shown)), Math.max(0, list.length - 1))
      // The frame, its heading in the top edge, and the buttons take three of the panel's rows.
      const rows = Math.min(24, Math.max(3, room - 3))
      body = await galleryPanel($, ui, list, index, await read($, layout), width, rows, false)
    } else if (state.reply !== null && !e.props.isWorking) {
      body = cardSheet($, ui, state.steps, state.reply)
    } else if (state.steps.length > 0) {
      body = planSheet(ui, room, state.steps, isSpinning)
    }

    // With the status line under the prompt and nothing open, the band draws nothing, and so no `[-]`.
    if (body === null && !isAbove) {
      return next(e)
    }

    return (
      <Box flexDirection="column">
        {body !== null && framed($, ui, body, gap)}
        {isAbove && toolbar(ui, state)}
      </Box>
    )
  })

  // The status line under the prompt, in the hint line's place. A tree of the mod's own there hides
  // the engine's line, and the engine sets its permission mode (`⏵⏵ … on`, `⏸ manual mode on`) before
  // it on the same row, with ` · ` between: a `|` drawn over that dot joins them as the items are.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!isActive || e.surface !== 'terminal') {
      // Drawn before session.start turned the mod on: reading what it writes draws the line again then.
      await read($, runtime)

      return next(e)
    }
    if ((await read($, place)) !== 'below') {
      return next(e)
    }
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    return (
      <Box flexDirection="row">
        <Box position="absolute" left={-2} top={0}>
          <Text dimColor>|</Text>
        </Box>
        {toolbar(ui, await readBandState($))}
      </Box>
    )
  })

  // The gallery at full size, where the layout docks panes beside the transcript: all the band's
  // gallery holds, the picture larger.
  on('ui.render', { component: 'Pane', requestId: BIG_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }
    const ui = $.ui.resolve(e)
    await read($, artwork)
    const list = await read($, shots)
    const index = Math.min(Math.max(0, await read($, shown)), Math.max(0, list.length - 1))
    // The heading and the buttons take two of the pane's rows.
    const rows = Math.max(3, e.props.scroll.bodyRows - 2)
    const width = Math.max(20, e.props.bodyColumns)

    return unframed($, ui, await galleryPanel($, ui, list, index, await read($, layout), width, rows, true))
  })

  // The transcript keeps each image beside the row that made it, as the desktop app does.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const drawn = await next(e)
    const group = e.props.calls
    if (!isActive || e.surface !== 'terminal' || e.props.isExpanded || !group.some(call => mayHoldImages(call.tool))) {
      return drawn
    }
    const ids = new Set(group.flatMap(call => (call.tool_use_id === undefined ? [] : [call.tool_use_id])))
    const list = (await read($, shots)).filter(shot => shot.toolUseId !== null && ids.has(shot.toolUseId))

    return list.length === 0 ? drawn : withStrip($, $.ui.resolve(e), drawn, list)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const drawn = await next(e)
    if (!isActive || e.surface !== 'terminal' || !mayHoldImages(e.props.tool)) {
      return drawn
    }
    const list = (await read($, shots)).filter(shot => shot.toolUseId === e.props.tool_use_id)

    return list.length === 0 ? drawn : withStrip($, $.ui.resolve(e), drawn, list)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (!isActive || e.surface !== 'terminal' || !e.props.text.includes('[Image')) {
      return drawn
    }
    const list = (await read($, shots)).filter(shot => shot.messageId === e.requestId)

    return list.length === 0 ? drawn : withStrip($, $.ui.resolve(e), drawn, list)
  })
}

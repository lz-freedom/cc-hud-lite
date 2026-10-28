export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export type PlanStep = { content: string; status: PlanStatus }

export type CardAction = { label: string; message: string }

export type NextStep = { recap: string; ask: string | null; actions: CardAction[] }

/** One image the conversation holds: a tool's result or a pasted one. */
export type Shot = {
  id: string
  label: string
  mime: string
  toolUseId: string | null
  messageId: string | null
  path: string | null
  width: number | null
  height: number | null
}

export type ContextRow = { name: string; tokens: number; color: string; kind: string }

export type ContextItem = { name: string; detail: string; tokens: number }

export type ContextView = {
  totalTokens: number
  maxTokens: number
  rows: ContextRow[]
  mcpToolCount: number
  mcp: ContextItem[]
  memory: ContextItem[]
  agents: ContextItem[]
  skills: ContextItem[]
  autoCompactAt: number | null
}

/** The live window as the last response reported it. */
export type Meter = { tokens: number; window: number; percent: number }

/** Which detail the band shows above its toolbar. */
export type Panel = 'context' | 'model' | 'effort' | 'images' | 'git'

/** The model and effort the main loop last asked with. */
export type Runtime = { model: string | null; effort: string | null }

/** A model the picker offers: settings' modelPicker, or the aliases. */
export type ModelChoice = { model: string; label: string; detail: string }

/** Where the status line sits: in the band above the prompt, or on the hint line under it. */
export type ToolbarPlace = 'above' | 'below'

/** Where the gallery lists its thumbnails: a column on the left, or a strip below. */
export type GalleryLayout = 'left' | 'bottom'

/** One styled run of a toolbar chip's text. */
export type ChipRun = { text: string; color: string | null; dim: boolean; bold: boolean }

/** A toolbar item: its id (the panel a press opens, when it opens one), and its text. */
export type Chip = { id: string; pressable: boolean; runs: ChipRun[] }

/** What the toolbar's surface module draws: its items, and the text set between them. */
export type ChipsProps = { chips: Chip[]; separator: string }

/** A press target over a picture: the panel a press opens, and the cells it covers. */
export type HitProps = { press: string; columns: number; rows: number }

/** Where the session runs, and its git state: a null root outside a repository. */
export type GitInfo = {
  cwd: string
  root: string | null
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changed: number
}

/** The gateway's spend limit as the last response reported it. */
export type SpendLimit = { percent: number; resetsAt: string | null }

declare module 'claude-code' {
  interface PluginState {
    'cc-hud-lite': {
      plan: PlanStep[]
      card: NextStep | null
      shots: Shot[]
      shown: number
      unseen: number
      context: ContextView | null
      expanded: string | null
      meter: Meter | null
      panel: Panel | null
      confirm: string | null
      runtime: Runtime
      models: ModelChoice[]
      layout: GalleryLayout
      git: GitInfo | null
      spend: SpendLimit | null
      place: ToolbarPlace
      /** Counts the scaled pictures that landed, so the drawings that show them draw again. */
      art: number
    }
  }
}

# cc-hud-lite

[中文](README.zh.md)

**The Claude Code desktop app's task list, next-step card, context panel and image viewer, in your terminal.**

![cc-hud-lite at work in Orca's terminal: Claude keeps a task list while it reads four images, thumbnails appear beside the transcript, a next-step card ends the turn, then the image viewer switches between images, opens a large pane, and the context panel opens](docs/images/demo.gif)

cc-hud-lite is a Claude Code mod: one hooks module, no build step, nothing else to install. It adds a clickable status line under the prompt and opens its panels above it. Each panel is a rounded frame with its title and buttons set into the top border, on one row with Claude Code's own `[-]`.

## Install

In a shell (you, or a coding agent that can run commands):

```bash
claude plugin marketplace add lz-freedom/cc-hud-lite
claude plugin install cc-hud-lite@cc-hud-lite
claude plugin list
claude "/cc-hud-lite:setup"
```

`claude plugin list` should show `cc-hud-lite@cc-hud-lite` enabled. The last command opens a Claude Code session and runs the setup: it checks your Claude Code version and whether your terminal can show pictures, and offers the one setting it needs. It is optional: without it everything works, and pictures may show as `▣`.

## What you get

### A status line you can click

Under the prompt: context used (bar and percentage), model, effort, folder and git branch, and the images in the conversation. Click an item to open its panel above the prompt; click it again to close it. Behind a Claude gateway that reports one, the spend limit shows too.

![The status line: auto mode, the context bar at 3%, Sonnet 5.5, Medium, acme-web git:(main), Images(4)](docs/images/status-line.png)

### A live task list, with images beside the steps that made them

While Claude works, its task list stays pinned above the prompt: a green ✔ for done steps, the running one in orange with a spinner, the rest waiting. Every image a tool returns shows as a thumbnail at the right of its transcript row; click one to open it in the image viewer.

![The task list above the prompt: three steps done, one running, two waiting; a thumbnail beside each image Claude read](docs/images/task-list.png)

### A next-step card when there is a choice to make

A turn that leaves you a decision ends with a short recap, the question and reply buttons. Click a button, or type its number at an empty prompt, to send that reply; `[✕]` puts the card away. A turn with nothing to decide draws no card.

![The next-step card: "6 of 6 steps done" in its top border, a recap, a question and two reply buttons](docs/images/next-step-card.png)

### An image viewer

Every image in the conversation, the selected one large with its path under it. Click a thumbnail or its number to show that image, or step with Prev, Next and Latest. `[◧]` puts the list on the left, each thumbnail with its file name beside it; `[⬓]` puts it below, a strip of thumbnails with the number under each. `[⤢]` moves the viewer into a large pane beside the transcript, and back; `[✕]` closes it.

![The image viewer above the prompt: four thumbnails with their file names on the left, the selected image large on the right, its path underneath](docs/images/gallery.png)

![The image viewer in a large pane beside the transcript, its thumbnails in a strip below the picture; the next-step card above the prompt on the left](docs/images/overview.png)

### Context details

The context window by category, where auto-compact starts, and lists of the MCP tools, memory files, agents and skills, with Compact, Clear and Refresh.

![Context details: a bar by category, the categories with their tokens and share, auto-compact, and Compact, Clear and Refresh](docs/images/context.png)

### Model, effort and directory

Pick a model from your `modelPicker` list (or the Opus, Sonnet and Haiku aliases) or an effort level, by click or by number; the mod runs `/model` and `/effort` for you. The directory panel shows the session's folder, branch, upstream and changed files, with Copy path.

![The effort panel with the current level highlighted](docs/images/effort.png)

![The directory panel: the path, changed files and upstream, with Copy path and Refresh](docs/images/directory.png)

## Terminals

| Terminal | Pictures (context bar, thumbnails, viewer) |
| --- | --- |
| kitty, Ghostty | Yes |
| iTerm2 3.5+ | With `"tui": "fullscreen"` in `~/.claude/settings.json` |
| Orca | With fullscreen as above, and `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`: Orca draws pictures, but Claude Code does not recognize it yet. `/cc-hud-lite:setup` offers to add `[ "$TERM_PROGRAM" = "Orca" ] && export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` to your shell profile. |
| Others | Text fallback: the bar as `■···`, thumbnails as `▣` |

Everything else works in any terminal. The screenshots on this page were taken in Orca.

## Use

| Do | To |
| --- | --- |
| Click a status line item | Open or close its panel above the prompt |
| Click a thumbnail beside a transcript row | Open the image viewer at that image |
| Click a thumbnail or number in the image viewer | Show that image |
| Click `[✕]` at a panel's top right | Close the panel, or put the next-step card away |
| A digit at an empty prompt | Pick that numbered choice in the open panel or next-step card |
| `/toolbar above`, `/toolbar below` | Put the status line in the band above the prompt, or under the prompt (the default) |

## Requirements

- Claude Code 2.1.308 or later, in a terminal. The desktop app draws its own task list and card, so the mod stays off there.
- macOS's `sips` for image thumbnails.

## Notes

- The `[-]` at the right of the band above the prompt is Claude Code's own collapse mark: it shows whenever a mod draws there, and no mod can hide it. Panel titles sit on its row, in the frame's top border, so a panel's buttons and `[-]` line up. With the status line under the prompt, the band draws only while a panel, task list or card is open.
- The status line takes the place of Claude Code's hint line (`? for shortcuts`, `esc to interrupt`); the permission mode stays at its left.
- Until the first request the effort reads `Default`: a mod cannot read the session's level before a request names it. A `CLAUDE_CODE_EFFORT_LEVEL` holds the level for the whole session; the status line then shows `(env)` and the effort panel offers no switch.

## Develop

```bash
git clone https://github.com/lz-freedom/cc-hud-lite
claude --plugin-dir ./cc-hud-lite
claude plugin validate ./cc-hud-lite
claude plugin test ./cc-hud-lite
```

`CLAUDE_CODE_PLUGIN_DIRS=/path/to/cc-hud-lite` loads it in every session instead; an interactive session reloads it as you save. When the engine loads the mod it writes the API types to `.claude-plugin/types/`, and `tsc -p .` type-checks against them.

## License

[MIT](LICENSE)

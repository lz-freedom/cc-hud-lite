# Changelog

## 0.1.3 (2026-11-09)

- `wrap_up` takes the task list away even when steps were never ticked off, as the desktop app does: a model that skipped `advance` no longer leaves a step spinning after the turn is done. Work that goes on starts a new list with `update_plan`.

## 0.1.2 (2026-11-07)

- The context bar shows from the first response of a session, also mid-turn: it no longer waits for the turn to end where a plugin seated before this one keeps `session.measure` to itself.
- Starting a session no longer waits on the command list, which could hold up the context, model list and usage reads.
- The speed item goes away for the session once `/fast` answers that fast mode is unavailable (a gateway or an account without it).

## 0.1.1 (2026-11-05)

- The task list stays up while any step is open: a `wrap_up` without buttons, a goal's next round or a background agent's report no longer takes it away. A finished list still goes.
- `update_plan` and `wrap_up` calls and their results are left out of the transcript: the band above the prompt shows them.
- The context bar has cells of its own in the status line, so the line's text no longer wipes the picture.
- A speed item (`Standard` / `Fast`) and panel switch fast mode with `/fast`, where Claude Code offers it.

## 0.1.0 (2026-10-28)

First release.

- Status line under the prompt: context bar and percentage, model, effort, folder and git branch (`my-project git:(main)`), the images in the conversation (`Images(n)`), and the spend limit when a Claude gateway reports one. Each item is one color, and a click opens its panel above the prompt. `/toolbar above|below` moves the line.
- Panels in a rounded frame, their title and buttons set into the top border, on one row with Claude Code's `[-]`; `[✕]` closes each.
- Live task list (`update_plan`): a green ✔ for done steps, the running one orange with a spinner, the rest waiting.
- Next-step card (`wrap_up`): a recap, the question and reply buttons; a digit at an empty prompt picks a button. A turn with nothing to decide draws no card.
- Image thumbnails beside the transcript rows that returned them; a click opens the image viewer at that image.
- Image viewer: the selected image large with its path, the list on the left (thumbnails with file names) or below (a strip with numbers), a click on a thumbnail or number shows that image, Prev, Next and Latest, and `[⤢]` for a large pane beside the transcript.
- Context details by category with Compact, Clear and Refresh; model and effort switchers; a directory panel with Copy path.
- `/cc-hud-lite:setup` checks the plugin, the Claude Code version and picture support (iTerm2 fullscreen, Orca's `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`).

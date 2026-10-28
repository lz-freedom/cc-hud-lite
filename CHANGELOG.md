# Changelog

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

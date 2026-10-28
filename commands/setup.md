---
description: Check that cc-hud-lite is ready in this terminal and finish its setup
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

Set up cc-hud-lite, a mod that draws a HUD in the Claude Code terminal. Work through the steps in order, telling the user in a sentence or two what each one found.

## Step 1: The plugin is loaded

Run `claude plugin list` and find `cc-hud-lite`. If it is missing or not loaded, tell the user to run `claude plugin marketplace add lz-freedom/cc-hud-lite` and `claude plugin install cc-hud-lite@cc-hud-lite` in a shell, then start a new Claude Code session; stop here.

## Step 2: Claude Code is recent enough

Run `claude --version`. cc-hud-lite needs 2.1.308 or later (it is tested on 2.1.308 to 2.1.312). If the version is older, tell the user to update Claude Code, then stop.

## Step 3: Pictures

The context bar and the image previews are pictures where the terminal can draw them: kitty and Ghostty always, iTerm2 3.5 or later and Orca only with Claude Code's fullscreen rendering. Elsewhere they fall back to text.

Run `echo "$TERM_PROGRAM $LC_TERMINAL"` and read `~/.claude/settings.json`. If the terminal is iTerm2 (`iTerm.app` or `iTerm2`) and the settings have no `"tui": "fullscreen"`, ask the user whether to turn fullscreen rendering on. With their yes, back the file up first (`cp ~/.claude/settings.json ~/.claude/settings.json.bak-cc-hud-lite`), then add the top-level key `"tui": "fullscreen"` with the Edit tool, leaving every other key as it is. Tell them it takes effect in new sessions, or at once with `/tui fullscreen`.

If the terminal is Orca (`$TERM_PROGRAM` is `Orca`): Orca's terminal draws pictures, but Claude Code does not recognize it yet, so it needs `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`, and fullscreen rendering as above. Ask the user whether to add this line to their shell profile (`~/.zshrc` for zsh, `~/.bashrc` for bash), so it applies in Orca only:

```
[ "$TERM_PROGRAM" = "Orca" ] && export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1
```

With their yes, back the profile up first, append the line, and tell them it takes effect in a new Orca terminal.

## Step 4: Thumbnails

Image thumbnails are made with macOS's `sips` (`command -v sips`). Where it is missing, say that thumbnails show as `▣` placeholders.

## Step 5: What the user has now

Tell the user, briefly:

- The status line sits under the prompt: the context bar and percentage, model, effort, folder and branch (`my-project git:(main)`), and the spend limit when a Claude gateway reports one. A click on an item opens its panel above the prompt. `/toolbar above` moves the line into the band above the prompt, `/toolbar below` brings it back.
- A click on a thumbnail beside a transcript row, or on `Images(n)`, opens the image viewer at that image.
- In each turn Claude keeps a task list above the prompt and ends with a next-step card; at an empty prompt, a digit picks the numbered choice in the open panel or card.
- If `CLAUDE_CODE_EFFORT_LEVEL` is set, the effort shows `(env)`: the variable holds the level for the whole session, and `/effort` cannot change it.

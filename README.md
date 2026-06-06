# Status Bar Demo

A minimal VS Code extension that adds a **status bar item** showing the word
count of the active editor. The item updates live and is clickable.

![status bar item: "✎ 42 words" in the bottom-right](https://placehold.co/300x40?text=%E2%9C%8E+42+words)

## What it does

- Shows `✎ N words` in the bottom-right status bar.
- Recomputes on editor switch, text edit, and selection change.
- Clicking it runs the `Status Bar Demo: Show Word Count` command, which pops an
  info message with the current count.
- Hides itself when no editor is open.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (tested on 22)
- [VS Code](https://code.visualstudio.com/) 1.85+

## Install dependencies

```bash
npm install
```

## Run it (debug)

1. Open this folder in VS Code.
2. Press **F5** (Run → Start Debugging).
   - This runs the default build task (`npm run watch`) and launches a second
     VS Code window titled **[Extension Development Host]** with the extension
     loaded.
3. In that window, open any text file. The word count appears in the
   bottom-right status bar.
4. Click the item to see the info-message popup.

> No `out/` yet? The F5 build task compiles it automatically. To compile by
> hand, run `npm run compile`.

## Develop with live reload

Run the TypeScript compiler in watch mode so edits recompile on save:

```bash
npm run watch
```

Then press **F5**. After changing `src/extension.ts`, reload the Extension
Development Host with **Ctrl+R** (Cmd+R on macOS) to pick up the new build.

## Test the behavior

Manual checks in the Extension Development Host:

| Action                          | Expected status bar                  |
| ------------------------------- | ------------------------------------ |
| Open a file with text           | `✎ N words` (N = word count)         |
| Type / delete words             | count updates immediately            |
| Close all editors               | item disappears                      |
| Click the item                  | info message `Current word count: N` |
| Run command from palette        | same info message (Ctrl+Shift+P → "Show Word Count") |

## Build a shareable package (.vsix)

```bash
npm install -g @vscode/vsce
vsce package
```

Produces `status-bar-demo-0.0.1.vsix`. Install it in any VS Code via
**Extensions view → ⋯ → Install from VSIX…**, or:

```bash
code --install-extension status-bar-demo-0.0.1.vsix
```

## Project layout

```
package.json          extension manifest: command + activation
tsconfig.json         TypeScript config (src → out, CommonJS, ES2022)
src/extension.ts      activate(): creates the status bar item + listeners
.vscode/launch.json   F5 launch config (Extension Development Host)
.vscode/tasks.json    background tsc watch build task
.vscodeignore         files excluded from the packaged .vsix
```

## Key API notes

- `vscode.window.createStatusBarItem(alignment, priority)` — higher priority
  sits further left on its side of the bar.
- `$(icon-name)` in `.text` embeds a
  [codicon](https://microsoft.github.io/vscode-codicons/) (e.g. `$(pencil)`).
- `.command` makes the item clickable.
- Items are hidden until you call `.show()`.
- Pushing disposables to `context.subscriptions` auto-cleans them on
  `deactivate()`.

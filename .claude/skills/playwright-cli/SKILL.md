---
name: playwright-cli
description: Drive a headless Chromium from the shell to open, inspect, click, and screenshot web pages. Use for checking the running app or the design prototype visually, reading a page's accessibility snapshot, or reproducing a UI bug. In this repo always call it as scripts/pw (never playwright-cli or npx directly).
allowed-tools: Bash(scripts/pw:*) Bash(nix develop:*) Bash(node scripts/design-serve.mjs:*)
---

# Browser automation in this repo: `scripts/pw`

`scripts/pw` wraps Microsoft's `@playwright/cli`, pinned to the version whose Playwright matches the nixpkgs
browsers in the dev shell, and launches the **nixpkgs Chromium** via a generated config. Nothing is downloaded.
Every example below is the upstream skill with `playwright-cli` replaced by `scripts/pw`.

Project rules:

- Run inside the dev shell: direnv does this on `cd`; otherwise `nix develop -c scripts/pw …`.
- `file:` URLs are blocked by the CLI. Serve files over HTTP instead. The design prototype has its own server:
  `node scripts/design-serve.mjs --daemon` → `http://127.0.0.1:8787/` (see the `design-compare` skill).
- Default viewport is 430×932 (phone). Use `scripts/pw resize W H` for other sizes: tablet 820×1180,
  desktop 1920×1080, 4K 3840×2160.
- Use `-s=<name>` sessions when the app and the prototype are open at the same time, e.g. `-s=app`, `-s=design`.
- Screenshots go to the session scratchpad or `.playwright-cli/` (git-ignored). Never commit them. Read a PNG
  with the Read tool to look at it.
- Prefer `snapshot` / `find` for structure and `screenshot` for appearance. Close sessions when done.
- For the running app, sign in through the Auth emulator or load a saved storage state
  (`scripts/pw state-load e2e/.auth/<user>.json`) produced by the Playwright fixtures.

---


# Browser Automation with playwright-cli

## Quick start

```bash
# open new browser
scripts/pw open
# navigate to a page
scripts/pw goto https://playwright.dev
# interact with the page using refs from the snapshot
scripts/pw click e15
scripts/pw type "page.click"
scripts/pw press Enter
# take a screenshot (rarely used, as snapshot is more common)
scripts/pw screenshot
# close the browser
scripts/pw close
```

## Commands

### Core

```bash
scripts/pw open
# open and navigate right away
scripts/pw open https://example.com/
scripts/pw goto https://playwright.dev
scripts/pw type "search query"
scripts/pw click e3
scripts/pw dblclick e7
# --submit presses Enter after filling the element
scripts/pw fill e5 "user@example.com"  --submit
scripts/pw drag e2 e8
# drop files or data onto an element (from outside the page)
scripts/pw drop e4 --path=./image.png
scripts/pw drop e4 --data="text/plain=hello world"
scripts/pw hover e4
scripts/pw select e9 "option-value"
scripts/pw upload ./document.pdf
scripts/pw check e12
scripts/pw uncheck e12
scripts/pw snapshot
scripts/pw eval "document.title"
scripts/pw eval "el => el.textContent" e5
# get element id, class, or any attribute not visible in the snapshot
scripts/pw eval "el => el.id" e5
scripts/pw eval "el => el.getAttribute('data-testid')" e5
scripts/pw dialog-accept
scripts/pw dialog-accept "confirmation text"
scripts/pw dialog-dismiss
scripts/pw resize 1920 1080
scripts/pw close
```

### Navigation

```bash
scripts/pw go-back
scripts/pw go-forward
scripts/pw reload
```

### Keyboard

```bash
scripts/pw press Enter
scripts/pw press ArrowDown
scripts/pw keydown Shift
scripts/pw keyup Shift
```

### Mouse

```bash
scripts/pw mousemove 150 300
scripts/pw mousedown
scripts/pw mousedown right
scripts/pw mouseup
scripts/pw mouseup right
scripts/pw mousewheel 0 100
```

### Save as

```bash
scripts/pw screenshot
scripts/pw screenshot e5
scripts/pw screenshot --filename=page.png
scripts/pw pdf --filename=page.pdf
```

### Tabs

```bash
scripts/pw tab-list
scripts/pw tab-new
scripts/pw tab-new https://example.com/page
scripts/pw tab-close
scripts/pw tab-close 2
scripts/pw tab-select 0
```

### Storage

```bash
scripts/pw state-save
scripts/pw state-save auth.json
scripts/pw state-load auth.json

# Cookies
scripts/pw cookie-list
scripts/pw cookie-list --domain=example.com
scripts/pw cookie-get session_id
scripts/pw cookie-set session_id abc123
scripts/pw cookie-set session_id abc123 --domain=example.com --httpOnly --secure
scripts/pw cookie-delete session_id
scripts/pw cookie-clear

# LocalStorage
scripts/pw localstorage-list
scripts/pw localstorage-get theme
scripts/pw localstorage-set theme dark
scripts/pw localstorage-delete theme
scripts/pw localstorage-clear

# SessionStorage
scripts/pw sessionstorage-list
scripts/pw sessionstorage-get step
scripts/pw sessionstorage-set step 3
scripts/pw sessionstorage-delete step
scripts/pw sessionstorage-clear
```

### Network

```bash
scripts/pw route "**/*.jpg" --status=404
scripts/pw route "https://api.example.com/**" --body='{"mock": true}'
scripts/pw route-list
scripts/pw unroute "**/*.jpg"
scripts/pw unroute
```

### DevTools

```bash
scripts/pw console
scripts/pw console warning
scripts/pw requests
scripts/pw request 5
scripts/pw run-code "async page => await page.context().grantPermissions(['geolocation'])"
scripts/pw run-code --filename=script.js
scripts/pw tracing-start
scripts/pw tracing-stop
scripts/pw video-start video.webm
scripts/pw video-chapter "Chapter Title" --description="Details" --duration=2000
scripts/pw video-stop

# annotate each subsequent action (click, type, ...) with a callout naming the action and highlighting the target
scripts/pw video-show-actions --duration=600 --position=top-right
scripts/pw video-hide-actions

# launch the dashboard for UI review / design feedback — user annotates the page, you receive the annotated screenshot, snapshot, and notes
scripts/pw show --annotate

# generate a Playwright locator for an element from its ref or selector
scripts/pw generate-locator e5 --raw

# show a persistent highlight overlay for an element, optionally with a custom style
scripts/pw highlight e5
scripts/pw highlight e5 --style="outline: 3px dashed red"
# hide a single element highlight, or all page highlights when no target is given
scripts/pw highlight e5 --hide
scripts/pw highlight --hide
```

## Raw output

The global `--raw` option strips page status, generated code, and snapshot sections from the output, returning only the result value. Use it to pipe command output into other tools. Commands that don't produce output return nothing.

```bash
scripts/pw --raw eval "JSON.stringify(performance.timing)" | jq '.loadEventEnd - .navigationStart'
scripts/pw --raw eval "JSON.stringify([...document.querySelectorAll('a')].map(a => a.href))" > links.json
scripts/pw --raw snapshot > before.yml
scripts/pw click e5
scripts/pw --raw snapshot > after.yml
diff before.yml after.yml
TOKEN=$(scripts/pw --raw cookie-get session_id)
scripts/pw --raw localstorage-get theme
```

For structured output wrapping every reply as JSON, pass --json
```bash
scripts/pw list --json
```

## Open parameters
```bash
# Use specific browser when creating session
scripts/pw open --browser=chrome
scripts/pw open --browser=firefox
scripts/pw open --browser=webkit
scripts/pw open --browser=msedge

# Use persistent profile (by default profile is in-memory)
scripts/pw open --persistent
# Use persistent profile with custom directory
scripts/pw open --profile=/path/to/profile

# Connect to browser via Playwright Extension
scripts/pw attach --extension=chrome

# Connect to a running Chrome or Edge by channel name
scripts/pw attach --cdp=chrome
scripts/pw attach --cdp=msedge

# Connect to a running browser via CDP endpoint
scripts/pw attach --cdp=http://localhost:9222

# Start with config file
scripts/pw open --config=my-config.json

# Close the browser
scripts/pw close
# Detach from an attached browser (leaves the external browser running)
scripts/pw -s=msedge detach
# Delete user data for the default session
scripts/pw delete-data
```

## URLs with `&` on Windows

On Windows, `cmd.exe` and PowerShell treat `&` as a command separator, so URLs with multiple query parameters get truncated before `scripts/pw` runs. Escape `&` with `^&` in `cmd.exe`, or use `--%` in PowerShell:

```batch
scripts/pw goto "https://example.com/?a=1^&b=2"
```

```powershell
scripts/pw --% goto "https://example.com/?a=1&b=2"
```

## Snapshots

After each command, scripts/pw provides a snapshot of the current browser state.

```bash
> scripts/pw goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.playwright-cli/page-2026-02-14T19-22-42-679Z.yml)
```

You can also take a snapshot on demand using `scripts/pw snapshot` command. All the options below can be combined as needed.

```bash
# default - save to a file with timestamp-based name
scripts/pw snapshot

# save to file, use when snapshot is a part of the workflow result
scripts/pw snapshot --filename=after-click.yaml

# snapshot an element instead of the whole page
scripts/pw snapshot "#main"

# limit snapshot depth for efficiency, take a partial snapshot afterwards
scripts/pw snapshot --depth=4
scripts/pw snapshot e34

# include each element's bounding box as [box=x,y,width,height]
scripts/pw snapshot --boxes
```

## Targeting elements

By default, use refs from the snapshot to interact with page elements.

```bash
# get snapshot with refs
scripts/pw snapshot

# interact using a ref
scripts/pw click e15
```

You can also use css selectors or Playwright locators.

```bash
# css selector
scripts/pw click "#main > button.submit"

# role locator
scripts/pw click "getByRole('button', { name: 'Submit' })"

# test id
scripts/pw click "getByTestId('submit-button')"
```

## Browser Sessions

```bash
# create new browser session named "mysession" with persistent profile
scripts/pw -s=mysession open example.com --persistent
# same with manually specified profile directory (use when requested explicitly)
scripts/pw -s=mysession open example.com --profile=/path/to/profile
scripts/pw -s=mysession click e6
scripts/pw -s=mysession close  # stop a named browser
scripts/pw -s=mysession delete-data  # delete user data for persistent session

scripts/pw list
# Close all browsers
scripts/pw close-all
# Forcefully kill all browser processes
scripts/pw kill-all
```

## Installation

If global `scripts/pw` command is not available, try a local version via `npx playwright-cli`:

```bash
npx --no-install scripts/pw --version
```

When local version is available, use `npx playwright-cli` in all commands. Otherwise, install `scripts/pw` as a global command:

```bash
npm install -g @playwright/cli@latest
```

## Example: Form submission

```bash
scripts/pw open https://example.com/form
scripts/pw snapshot

scripts/pw fill e1 "user@example.com"
scripts/pw fill e2 "password123"
scripts/pw click e3
scripts/pw snapshot
scripts/pw close
```

## Example: Multi-tab workflow

```bash
scripts/pw open https://example.com
scripts/pw tab-new https://example.com/other
scripts/pw tab-list
scripts/pw tab-select 0
scripts/pw snapshot
scripts/pw close
```

## Example: Debugging with DevTools

```bash
scripts/pw open https://example.com
scripts/pw click e4
scripts/pw fill e7 "test"
scripts/pw console
scripts/pw requests
scripts/pw close
```

```bash
scripts/pw open https://example.com
scripts/pw tracing-start
scripts/pw click e4
scripts/pw fill e7 "test"
scripts/pw tracing-stop
scripts/pw close
```

## Example: Interactive session

Ask the user for UI review or design feedback. The user draws boxes on the live page and types comments; you receive the annotated screenshot, the snapshot of the marked region, and the user's notes. Use this whenever the user asks for "UI review", "design feedback", or to "ask the user what they think / want / mean":

```bash
scripts/pw open https://example.com
scripts/pw show --annotate
```

## Specific tasks

* **Running and Debugging Playwright tests** [references/playwright-tests.md](references/playwright-tests.md)
* **Request mocking** [references/request-mocking.md](references/request-mocking.md)
* **Running Playwright code** [references/running-code.md](references/running-code.md)
* **Browser session management** [references/session-management.md](references/session-management.md)
* **Spec-driven testing (plan / generate / heal)** [references/spec-driven-testing.md](references/spec-driven-testing.md)
* **Storage state (cookies, localStorage)** [references/storage-state.md](references/storage-state.md)
* **Test generation** [references/test-generation.md](references/test-generation.md)
* **Tracing** [references/tracing.md](references/tracing.md)
* **Video recording** [references/video-recording.md](references/video-recording.md)
* **Inspecting element attributes** [references/element-attributes.md](references/element-attributes.md)

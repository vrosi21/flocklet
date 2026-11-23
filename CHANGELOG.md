# Changelog

## 0.4.2

- Fix: "Restart now" shortly after Windows started could quit Flocklet without installing (the silent
  installer failed while security drivers were still loading). The first update check now waits until the PC
  has been up 3 minutes; a "Restart now" that did not install is noticed on the next start, and the retry runs
  the installer visibly.

## 0.4.1

- Fix: a plan or question rejected in Claude (no PostToolUse is sent for a rejection) kept its card
  "waiting" until the turn ended. A new main-thread tool call now clears it; subagent tool calls do not.

## 0.4.0

- First-run tour (own window, 7 pages): sessions, answering from the panel (demo card), style, pets, the
  three views (pictures of the real panel / minimised bar / pet dock), notifications. Reopen: tray menu or
  Settings → Tour. After an update it shows only pages newer than the last tour you finished.
- Style presets: Neutral, Campfire, Marshmallow, Terminal, Arcade, Workshop (palette + look pairs).
- New palette Graphite. New installs start on Neutral (Graphite + Studio) with light/dark following Windows;
  the light/dark choices are now Auto (follows Windows), Light, Dark and Palette's own. Saved themes are kept.

## 0.3.2

- Process name: Task Manager shows "Flocklet" (the exe's description was the long package description).

## 0.3.1

- Old usage reading: the panel and minimised bar say how to refresh it (right-click the Claude tray icon).

## 0.3.0

- Usage meters read Claude desktop's local usage file only. Flocklet no longer reads, refreshes or
  sends your Claude Code login, and never contacts Anthropic — the only network traffic is the
  GitHub update check.
- The Claude Code sign-in prompt is gone (nothing needs it). Reset times are no longer shown:
  the local usage file does not carry them.

## 0.2.2

- Minimised bar: usage refresh button; as tall as the sidebar beside it.
- Update ready: dialog above the panel, Windows notification, tray "Restart to update".

## 0.2.1

- Fix: a copy run from source no longer acts like the installed app (update check, start with Windows).
- The update dialog shows release notes (`RELEASE_NOTES.md`).

## 0.2.0 — first public release

- Installer (per-user, no admin), starts with Windows, in-app "Update ready" dialog.
- Panel: sessions grouped by project with parent/child trees, folding, pins, resizable.
- Answer permissions and questions from the panel; jump into any session.
- Live 5-hour and weekly usage with reset times.
- Sidebar (Sessions, Settings) dockable on any side; minimises on its own.
- Minimised stats bar that snaps to show every session.
- Pet dock: a taskbar of pets with speech bubbles, groups and names.
- Pets and colours per session, palettes and looks.
- Windows notifications with the Flocklet name and icon.

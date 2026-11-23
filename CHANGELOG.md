# Changelog

## 0.5.0

- Drag to reorder (`renderer/carry.js`): cards inside their section, projects / groups among each other,
  in the panel and the pet dock. A parent moves with its children (ghost parents too); children move among
  their siblings. The carried card folds into its pet (dangling, swings with speed), a nest marks the drop
  spot, siblings slide (FLIP), landing squish + dust, unfold. Escape returns it. Order is saved per section
  (`cfg.order`, `cfg.folderOrder`, custom groups reorder `cfg.groups`); unplaced sessions come first in the
  automatic order. Settings → All settings → Order → "Back to automatic order".
- Pet emotes for working / thinking / done pets (hop, heart, note, twirl, stretch, sparkle), about one per pet
  every 40 s, at most two at once; off with "Busy pets do little emotes" (`cfg.emotes`). Paw cursors over pets.
- Pet dock redesign: state bar under each pet, group labels above (only with more than one group), open-panel
  and hide buttons at the end.
- Settings: Simple / All settings. Simple has style presets, curated Shuffle (weighted toward good pairs, with
  locks for colours / font / light-dark), Undo (20 steps), the last 5 styles, Mood / Edges / Glass / Size
  sliders; hovering a style previews it on the real panel.
- Zoom: 90 / 100 / 125 / 150 % for the whole app (window maths in `src/panelSize.js`).
- Edges: Soft float is the default (no border, rounder, soft shadow; 16 px bottom margin so the shadow is not
  cut). Glass setting Off / Light / Medium / Strong (90 / 78 / 64 %) with a gradient rim, sheen and bottom glow.
- Usage meters and `src/usage.js` removed. A StopFailure that looks like a usage limit marks the card
  "Out of usage" and its pet sleeps.
- Debug log setting (off by default, on in the dev copy): event names and timings, never prompts, commands,
  file contents or the token. With it on, a failed update install records the installer's exit code.
- Dev copy beside the installed one: own data folder (`Flocklet Dev`), port 4778, watch-only hooks;
  `npm run dev:bg` runs it invisible for tests. Hooks are scoped per port, so quitting one copy never removes
  the other's hooks.

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

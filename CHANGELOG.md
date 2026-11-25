# Changelog

## 0.6.6

- Magnet on what you see (`insetsOf`, `shown`): stuck panels 6 px apart (windows overlap their clear margins),
  side-joined boards touch, stacked boards 6 px (their 3 px joined margins). Drops within 16 px of lining up line up
  (`alignAlong`); a board within 10 px of being as near as Main wins (`snapBest`, you stack on it).
- `placeStuck`: own side if it fits on the screen, else the first free other side (skips what other boards cover),
  else pulled onto the screen; it keeps its own side for later.
- `cfg.mainHidden`: minimise the main card (header button, the dock's minimise, Home while on it); the window is
  just the sidebar, boards stay and can stick to it. When Main grows back, free boards in its way move aside
  (`pushOut`).
- Pet dock: a click on a pet hops it and opens its chat (`hopToChat`; double-click is gone). Its details card opens from
  the arrow shown on hover (`.dinfo`) or the right-click menu ("Details", also in Windows' own menu via `fx`
  `details:<key>`). A pet with no chat to open shows its details on click.
- Cursors per action: chat (pointer + speech bubble) on cards, dock pets and session rows that open a chat; details
  (pointer + card) on the arrow; paw on what you pick up; text / default inside a card's answer box.
- Dev copy tests: `test:op` `moveMain`; with `FLOCKLET_FAKE` a jump is only logged (fake sessions have no chat).

## 0.6.5

- News on sidebar tabs and window toggles for boards you are not looking at (`news()`): amber = waiting, red =
  stopped, green with a count = finished since you last looked (`lookedAt`, set for what is in front of you: Main's
  card view and visible board windows). The tab or toggle the chime came from pulses (`pings`, 2.7 s); a visible
  board window pulses its own panel (`panelPing`).
- Fix: every window ran `detectTransitions` and chimed; only Main chimes now.
- The pet dock keeps the sidebar (and the side card): `railSide()` is always the rail; tabs switch what the dock
  shows. A side sidebar's window is at least as tall as the measured sidebar.
- Fix: a sidebar above / below wider than a narrow deck made the grid widen every column and push the deck off
  the window. The rail no longer takes width in the grid (`min-width: 0`), the last column takes any extra
  (`minmax(0, 1fr)`), and main makes the window at least as wide as the sidebar's buttons.
- Updates: the installer always shows (`quitAndInstall(false, true)`); silent installs failed soon after boot
  (2026-11-23, 2026-11-25) and Flocklet just looked gone.
- Dev copy tests: `test:op` `fakeState` changes a fake session's state.

## 0.6.4

- A board emptied by a move (`ui:board` move / new, a drop on a board or Main) is removed: `Boards.withContent`
  before and after the move; a visible board window plays a short shrink (`fx` 'vanish') first. Main never goes; an
  empty board made with + stays until something empties it.

## 0.6.3

- Crash fix: notifications were released on 'close' (they leave the screen but stay clickable in the notification
  center), so a later click called into a freed object (0xc000041d, twice on 2026-11-24). Now kept until Flocklet
  closes them (oldest closed past 30), all closed at quit, leftovers cleared at start
  (`ToastNotificationManager.History.Clear`). Local crash dumps (`crashReporter`, no upload), crashed processes and
  main-process errors go to the log.
- Sidebar: never hides (`railMin` gone). Eye button = `cfg.panelsHidden` (hides Main's card, the side card and every
  board window; the window becomes just the sidebar, sized from its measured length; same boards come back).
  Minimise-to-tray moved here and hides every board too. Top / bottom sidebar spans the deck and the side card.
- Side card: left or right only; its top strip is a drag region.
- Boards: icons (`ICONS`), own pet dock (`b.dock`), magnet to other boards (`stuck.to`, `snapBest`, followers move
  along); side by side they join (no margin, square corners, `joins`) and take the target's type; stacked ones keep a
  3 px gap. A board window let go over Main folds into a tab (`fx` 'into-main'). Dragging all of a board out moves the
  board instead of making an empty twin. Names unique; group/project boards no longer get folder names ("Board N",
  name field opens).
- Sessions: right-click menu in the window's style (native menu in small windows), pin on every card.
- Names: `cfg.projectNames` (pencil on project headers), dock project names off by default (`dockGroupNames`),
  session names under pets on (`dockNames`).
- Themed tooltips (native ones only where a themed one would not fit). Dock spacing: a label never widens its group.

## 0.6.2

- `src/hookPolicy.js`: a read-only check of whether Claude Code will run Flocklet's hooks. It reads the managed
  policy (HKLM / HKCU `SOFTWARE\Policies\ClaudeCode` "Settings", `C:\Program Files\ClaudeCode\managed-settings.json`
  and `managed-settings.d\*.json`) and `~/.claude/settings.json`. Hooks count as off when `allowManagedHooksOnly`,
  `disableAllHooks` or `strictPluginOnlyCustomization: ["hooks"]` is set, or when an `allowedHttpHookUrls` list does
  not cover `http://127.0.0.1:<port>/hook` (a localhost pattern counts as covering it). The panel banner and tray
  then say why. Checked at start, on Reconnect and every 10 minutes. Server-managed policy is not visible on disk.

## 0.6.1

- Sessions + Settings are one card beside the deck (tabs), docked on its own side by its dots (`cfg.drawerSide`;
  `shellExtras` / `shellRect` take the card's side; the shell is a 5 x 5 CSS grid with the deck in the middle).
  The separate Settings window from 0.6.0 is removed (`settingsOpen` / `settingsPos` dropped from the config).
- Sidebar in parts: the main card's tabs (Main, boards that live on it, + new board), toggles for boards in their
  own windows (with the all-boards menu), Settings. Tabs and toggles are drop targets (`[data-drop]`): drop a
  session to move it, on + for a new board. Drag a tab out of the window = its own window at that point; a toggle
  onto the tabs = on the main card; a board window let go over Main = on the main card; "Move into Main" button.
- Scroll bars always visible (rounded thumb on a faint track, accent while dragged).
- Fix: `--quit` with no running copy started one; now it only closes a running copy.

## 0.6.0

- Boards (`src/boards.js`): workspaces made by dragging a project, group or session out of a window. Projects and
  groups move as rules (their new sessions follow); single sessions are placed one by one
  (`cfg.sessionBoard`, beats the rules); a child follows its parent. Board windows (`index.html?board=<id>`) with
  their own name, style, width and height; a board can also live inside Main (`cfg.view`).
- Drag between windows: the page keeps the pointer and reports its screen position (`ui:carry`); main moves a
  click-through carry window with the pet and lights up the window under it. Drop on a board or Main = move there,
  on the desktop = new board.
- Magnet: a board released near Main sticks to that side (`stuck: {side, along}`) and follows Main's window,
  hides with it.
- Sidebar: a button per board (show / hide, right-click menu), all-boards menu (hide all, bring back the ones you
  hid, show all). Main's header shows the board on its card with "Back to Main" and pop out.
- Theme per board (`board.theme`, null = same as Main); Main, the sidebar and Settings follow the board you view.
- Settings moved out of the drawer into its own window (`cfg.settingsOpen`, `cfg.settingsPos`); hover previews are
  relayed to the panel it styles. The drawer is Sessions only.
- The sidebar is a drag region (moves Main). Scroll bars restyled (slim, no track, brighter on hover, accent while
  dragged).
- Dev only: `FLOCKLET_FAKE=<json>` feeds fake sessions to every window of the dev copy (tests).

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

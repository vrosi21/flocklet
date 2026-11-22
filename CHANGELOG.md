# Changelog

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

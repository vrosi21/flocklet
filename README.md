# Flocklet

A floating flock of pets for your **Claude Code desktop** sessions. Each session is a little character
that shows what its agent is doing, so you can keep working elsewhere and still see who needs you.

- **See every session at a glance**: working, thinking, waiting for you, done, error. Grouped by project
  (like Claude's sidebar), with parent and child sessions nested.
- **Answer from the panel**: permission requests (Allow / Always / Deny) and multiple-choice questions,
  without switching windows. One click jumps into the session in Claude.
- **Usage meters**: your 5-hour and weekly limits, read from Claude's own local usage file.
- **Three views**: the full panel with a dockable sidebar, a minimised stats bar, or a **pet dock** (a slim
  taskbar of pets with speech bubbles: `?` question, `!` permission, `✓` done).
- **Notifications** when a session finishes or needs you; per-session mute.
- **Make it yours**: ready-made styles or your own palette + look, light/dark following Windows, pets and
  colours per session; resize, fold groups, pin sessions.
- **A one-minute tour** on first start (reopen it from the tray or Settings).

## Install

Download `Flocklet-Setup-x.y.z.exe` from [Releases](https://github.com/vrosi21/flocklet/releases) and run it.
Flocklet installs for your user (no admin), starts with Windows (switch it off in Settings or the tray
menu) and tells you when an update is ready.

Windows may show a SmartScreen warning the first time, because the installer is not code-signed yet:
**More info → Run anyway**.

Requires Windows 10/11 and the Claude desktop app with Claude Code.

## How it works and what it touches

Everything stays on your computer.

- On start, Flocklet adds HTTP hooks to `~/.claude/settings.json` (a backup is made first) that send
  session events to `127.0.0.1:4777` with a random token; on quit it removes them again.
- It reads Claude's local session files to list your sessions and their parent/child links.
- Usage meters read Claude desktop's local usage history file. Flocklet never reads your Claude login
  and never contacts Anthropic; its only network traffic is the GitHub update check.
- Answers you give in the panel go back only to the waiting Claude Code session.

Flocklet is an independent project. It is not made by, affiliated with or endorsed by Anthropic.
"Claude" is a trademark of Anthropic.

## Build from source

```bash
npm install
npm test
npm start          # run from source (or double-click Flocklet.vbs)
npm run dist       # build the installer into dist/
```

## Releasing

```bash
# 1. write what changed into RELEASE_NOTES.md (and CHANGELOG.md)
npm version patch     # or minor; makes the commit and the tag
git push --follow-tags
```

The **Release** workflow tests, builds the installer and publishes it to GitHub Releases. Installed copies
check every 6 hours (and on start) and show an "Update ready · Restart now / Later" dialog.

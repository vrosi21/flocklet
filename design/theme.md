# Flocklet — visual theme

Decided with the user on 2026-11-17 over five rounds. Tokens live in [`renderer/theme.css`](../renderer/theme.css) (moved there when the theme shipped into the app).
No app code has changed yet. Wiring this into `renderer/` is a separate task.

## 1. The big idea: Colour and Look are separate

Like VS Code, where the colour theme and the font are separate settings:

- **Palette** = colours only (7 options, each with a light and a dark twin).
- **Look** = fonts, corner radius, density, background pattern and title prefix (6 options).
- Any palette works with any look. **Starter themes** are saved palette + look combos.
- Everything can be tweaked later (accent colour, pattern on or off, and so on).

Set them on `<html>`: `data-palette`, `data-mode` (optional, `light` or `dark`) and `data-look`.

**Defaults:** palette **Campfire** (dark) + look **Pocket**.
**Favourite looks:** Pocket (main), Puff and Studio. Shell, Arcade and Tube stay as extra options.

## 2. Palettes

Native mode first, then its twin. `g1..g6` keep hue order (red, orange, yellow, green, blue, violet/pink) so group colours stay familiar across palettes. Pets take their body colour from `g1..g6`.

| Palette | Who picked it | Mood | Native mode |
|---|---|---|---|
| **Crimson hour** | user | deep crimson with teal and gold accents | dark |
| **Midnight plum** | user | violet glowing in near-black | dark |
| **Lagoon** | user | ink teal with coral pops | dark |
| **Concrete** | user | urban grey with taxi yellow, graffiti accents | dark |
| **Campfire** | Claude (default) | current Flocklet coral, warmer | dark |
| **Marshmallow** | Claude | pastel sticker-book | **light** |
| **Phosphor** | Claude | green CRT; the mascot turns mono green | dark |

### Hex values

| Palette · mode | bg | card | card-hi | text | muted | accent | warn | ok | err |
|---|---|---|---|---|---|---|---|---|---|
| Campfire · dark | `#17151a` | `#221e25` | `#2b262f` | `#f3ede8` | `#a39aa4` | `#ef7d52` | `#f5b942` | `#63d68f` | `#ef6464` |
| Campfire · light | `#faf5f1` | `#ffffff` | `#fbede5` | `#2a2125` | `#7d6f74` | `#d9622f` | `#c98a12` | `#2f9e62` | `#d6434d` |
| Crimson hour · dark | `#1a1013` | `#27161c` | `#331d25` | `#f7e9ec` | `#b89aa3` | `#e8364f` | `#ffb547` | `#5fd39a` | `#ff8a5c` |
| Crimson hour · light | `#fbf2f3` | `#ffffff` | `#fbe3e7` | `#2b1419` | `#85636b` | `#c81e3a` | `#c47f0f` | `#2a9a69` | `#d9542a` |
| Midnight plum · dark | `#15111f` | `#211a31` | `#2a223e` | `#efeaff` | `#a198c4` | `#9d6bff` | `#ffcc66` | `#6ee7b7` | `#ff6b8a` |
| Midnight plum · light | `#f6f3fc` | `#ffffff` | `#ece5fb` | `#221a38` | `#6f6690` | `#7440e0` | `#c48a10` | `#1f9e74` | `#d83c62` |
| Lagoon · dark | `#0e1a1c` | `#152629` | `#1c3236` | `#e4f5f3` | `#86a9a6` | `#2ec4b6` | `#ffb85c` | `#9be36d` | `#ff6b6b` |
| Lagoon · light | `#f0f8f7` | `#ffffff` | `#dff1ee` | `#0f2a2c` | `#5c7f7c` | `#138f84` | `#c77a1a` | `#4c9a2a` | `#d64545` |
| Concrete · dark | `#18191b` | `#232427` | `#2c2d31` | `#ececec` | `#9a9ca1` | `#ffd23f` | `#ff8c42` | `#4fd1a5` | `#ff5555` |
| Concrete · light | `#f2f2f0` | `#ffffff` | `#e7e7e4` | `#1b1c1e` | `#6b6d72` | `#c99a00` | `#d9661a` | `#1f9e76` | `#d63a3a` |
| Marshmallow · light | `#fbf3ec` | `#ffffff` | `#fff0e6` | `#3b2e3a` | `#8f7e8a` | `#f2765e` | `#e09a1c` | `#3fbf82` | `#e85a67` |
| Marshmallow · dark | `#221b22` | `#2d242d` | `#382c37` | `#fbefef` | `#b9a3b0` | `#ff9a85` | `#f7bf55` | `#6fd6a0` | `#ff7a86` |
| Phosphor · dark | `#0a0f0b` | `#0f1811` | `#15221a` | `#b8f5c4` | `#5f9a6b` | `#5cff8a` | `#ffd35c` | `#9dffb5` | `#ff6b5c` |
| Phosphor · light | `#eef5ec` | `#f8fcf6` | `#e0eedc` | `#0f3a1a` | `#4d7a58` | `#138a3a` | `#a87a00` | `#1f9e4a` | `#c8402f` |

`--line`, `--accent-ink` (text on an accent fill) and `--g1..--g6` for each palette are in `renderer/theme.css`.

## 3. Looks (fonts, shapes, patterns)

| Look | Title font | Body font | Corners (control / card / panel) | Pattern | Prefix |
|---|---|---|---|---|---|
| **Pocket** ★ default | Pixelify Sans 700 | Nunito | 6 / 6 / 10 px | dotted grid, 14 px | — |
| **Puff** ★ | Fredoka 600 | Nunito | 10 / 10 / 16 px | soft pixel checker, 20 px | — |
| **Studio** ★ | Inter 600 | Inter | 6 / 6 / 10 px | none | — |
| Shell | JetBrains Mono 700 | JetBrains Mono | 4 / 4 / 6 px | flock birds | `› ` |
| Arcade | Silkscreen | Space Mono | 6 / 6 / 10 px | paper grain | — |
| Tube | VT323 (×1.35) | JetBrains Mono | 2 / 2 / 4 px | scanlines | `$ ` |

★ = the user's favourites. The user chose **crisp 6 px** as the base radius; Puff is the only rounder look.

**Mono font, everywhere:** JetBrains Mono → Cascadia Mono → Consolas.
**Fallbacks:** Segoe UI Variable (Windows-safe). All other fonts are Google Fonts. Bundle them locally as woff2 before shipping, so the tray app works offline.

### Pattern notes
- Every pattern is a **mask** painted with `--pattern-ink`, which is mixed from the palette's accent (or text, for grain). One pattern therefore recolours itself in every palette.
- Keep patterns faint: 7–35 % ink. They sit behind the panel, never behind card text.
- The future **infinite canvas** uses the same look's pattern at canvas scale. Dots and checker scale up cleanly. Birds can drift slowly as a parallax layer. Grain and scanlines stay screen-fixed.
- Each look sets its own pattern. Users can switch it off or swap it.

## 4. Characters (agent pets)

Four original pets, all ours. Nothing from Adventure Time, BMO or any other franchise. Each agent picks one, and its body colour comes from the palette's `g1..g6`.

| Pet | Shape | Notes |
|---|---|---|
| **Puffball** (Flock chick) ★ mascot | perfect circle, cream belly, orange curl tuft, tiny rounded beak, wing nubs, little feet | big glossy eyes, each with 2 white highlights; pink blush |
| Mochi blob | soft dome, flat bottom | the easiest to animate (squash and stretch) |
| Chip bot | rounded microchip body, pins on the sides, dark screen face, leaf sprout antenna | the most "coding agent" |
| Ghost puff | floating sheet, wavy hem | good for the asleep and error states |

Two more chick variants were sketched and can stay as extra pets: **Dango** (sitting dumpling with a three-leaf sprout) and **Eggshell** (peeking out of a cracked shell).

**Mascot colours:** body `#ffd23f`, shade `#f5c400`, belly `#ffe68a`, beak/tuft/feet `#ff8c42`, eyes `#2a1f1a`, blush `#ff7eb6` at 55 %. The chick stays yellow in every palette except Phosphor, where it goes mono green.

**Angles:** front, 3/4 and side were sketched for all three chicks. In 3/4 view the far eye gets narrower and the face shifts toward it. In side view there is one eye, the beak sticks out and a small tail feather shows.

### States (all pets)
| State | Expression and motion | Colour cue |
|---|---|---|
| idle | eyes open, calm smile, occasional blink, gentle bob, no Zzz | `--state-idle` |
| thinking | eyes look up, small "…" bubble, tuft wiggles | `--state-thinking` (g5) |
| working | determined eyes, fast little bounce, wings flap | `--state-working` (accent) |
| waiting | big eyes, raises a wing, "!" bubble, pulses | `--state-waiting` (warn) |
| done | ^ ^ happy eyes, hop, sparkle | `--state-done` (ok) |
| error | dizzy swirl eyes, wobble | `--state-error` (err) |
| asleep | squished lower and wider, tuft droops, closed eyes, sleep bubble, Zzz | `--state-asleep` |

Motion is soft and bouncy (`--ease-bounce`), loops about 1.6 s, and respects `prefers-reduced-motion`.
Users can also pick a pet's colour or import their own art.

## 5. Logo

- **Mark:** the **Puffball chick face**. A circle, a curl tuft, two eyes and a tiny beak. It must read at 16 px, so drop the blush and highlights below 24 px.
- **Wordmark:** **Flocklet**, with a capital F. It **follows the active look's title font**: Pixelify in Pocket, Fredoka in Puff, Inter in Studio, and so on. Its master version is Pocket (Pixelify Sans 700).
- **Tray icon (16 px):** the chick face on a transparent background. It stays yellow on Windows light and dark taskbars. A small dot could show "agent waiting" later.
- The chick turns mono green in Phosphor. Otherwise it stays yellow.

## 6. Concept art prompt

**Approved references:**
- [`concept/puffball-v2.jpg`](concept/puffball-v2.jpg) is the **main reference** (chick, angles, expressions, pixel logo, side pets).
- From [`concept/puffball-v1.jpg`](concept/puffball-v1.jpg), take the **Chip bot**. Its microchip body with side pins matches the "Chip bot" direction better than the v2 robot.

**Known gap, fixed in code rather than art:** in both versions, idle and asleep look the same (closed eyes). In the app, idle = the front pose with eyes open, a calm smile and an occasional blink. Asleep = squished lower, tuft drooping, Zzz.

**Prompt safety note:** a v2 prompt was rejected by the image tool as "unsafe". It was most likely a false positive from words like "baby", "body" and "squished" together. The prompt below (v3) avoids those words. Use it only if you want to regenerate.

```
Original kawaii mascot character sheet for a desktop app called "Flocklet".
Hero character: "Puffball", a little round chick, perfectly spherical shape in warm yellow (#ffd23f) with a soft cream belly (#ffe68a), small darker-yellow wing nubs (#f5c400), a single curly orange tuft on top (#ff8c42), a tiny rounded orange beak, two tiny orange feet, very large glossy dark-brown eyes (#2a1f1a) each with two white sparkle highlights, soft pink blush cheeks (#ff7eb6). Soft, round, cute proportions.
Show Puffball from three angles (front, three-quarter, side) and in seven clearly different expressions in a row: idle (eyes open, calm smile, standing), thinking (looking up, small dots bubble), working (determined, bouncing), waiting (big eyes, one wing raised, exclamation bubble), done (happy ^ ^ eyes, sparkles), error (dizzy swirl eyes), asleep (sitting down, flatter rounder shape, tuft drooping, eyes closed, Zzz).
Small side cast at the bottom, same style: a violet mochi blob, a teal square microchip robot with metal pins along its sides, a tiny leaf sprout antenna and a screen face, and a pale pink floating ghost with a wavy hem.
Style: clean flat vector illustration, soft shapes, thin warm-brown outline, minimal one-tone cel shading, cozy and playful, very light warm background, generous spacing, character-sheet layout.
Fully original design. Not based on any existing character, game, show or franchise. No text, labels, hex codes or UI anywhere in the image; only the title "Puffball" top left.
```

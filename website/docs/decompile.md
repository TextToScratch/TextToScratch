---
title: Blocks to text
---

# Converting blocks to text

Already have a project made with blocks? TextToScratch can turn it into TypeScript so you can keep going in text.

## How to use it

- Open the editor on a project that has **no TextToScratch code yet** (the **Text Code** button in Scratch, or **Open .sb3** in the web editor): its blocks are converted automatically and open as one tab per sprite, plus `Stage.ts`.
- Or press **Convert blocks to text** in the editor's toolbar at any time. It asks before replacing code you already have.
- Anything that couldn't be converted exactly is listed in the problems area (in orange) and marked in the code with an `// unsupported: ...` comment.
- Press **Build & Run** to replace the blocks with the compiled code.

## What converts

| Blocks | Code |
|---|---|
| Hat blocks | `whenFlag(() => { })`, `whenKey`, `whenClicked`, `whenBackdrop`, `whenGreater`, `onMessage`, `onClone` |
| if / else, repeat, forever | `if (...) { } else if ...`, `repeat(n, () => { })`, `forever(() => { })` |
| repeat until, wait until, stop | `while (!cond) { }`, `waitUntil(() => cond)`, `stopAll()` / `stopThis()` / `stopOthers()` |
| Operators | `+ - * / %`, `< > === <= >= !==`, `&& \|\| !` with the right brackets; join becomes a template string |
| Motion / looks / sound / pen / sensing | the [API](./reference.md) functions and `me.x`, `me.size`, `me.visible = false`, ... |
| "For this sprite only" variables and lists | `let score = 0;` / `let items: string[] = [];` at the top of the sprite file |
| "For all sprites" variables and lists | properties of `export const game = { ... }` in `Stage.ts`, used as `game.score` (cloud variables go in `/** @cloud */ export const cloud`) |
| List blocks | `push`, `insert`, `remove`, `pop`, `list[i]`, `length`, `indexOf`, `includes` — Scratch's 1-based positions become 0-based indexes |
| Custom blocks | functions with typed parameters (`number`, `string`, `boolean`); "run without screen refresh" becomes `/** @warp */` |
| Comments attached to blocks | `//` comments |

Scratch names that aren't valid identifiers are renamed (`my score` becomes `myScore`) and the original name is kept in a comment.
Variable types are inferred from how each variable is used; one that holds both numbers and text is declared `any`.

## What doesn't (or changes)

- **Extension blocks other than pen** (music, video, text to speech, ...) and a few rarely used blocks become `// unsupported: <opcode>` comments.
- **Unknown hat blocks** (like *when touching*) keep their script as a function that nothing calls.
- **Loose blocks** that aren't under a hat are dropped (they never run).
- **Clean-up**: block positions and the exact shape of some blocks (e.g. `Math.round` of a mod) are rebuilt by the compiler, so the blocks you get back look a little different but behave the same. Variable monitors (position, slider range, visibility, slider mode) are now preserved.
- Projects made with TextToScratch convert too, but constants are inlined, `cond ? a : b` shows up as an `if` into a temporary variable, and function return values show up as the hidden `__ret` variable.

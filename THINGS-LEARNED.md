# THINGS-LEARNED.md — Heartline

> **What this is:** the lessons this project taught about *how to build software*: planning, structure, testing, shipping, and working with Joseph. Not a bug list. When the project wraps up, these get harvested into [`LESSONS.md`](https://github.com/JPLuker/InternalDesignGuidelines/blob/main/LESSONS.md) in InternalDesignGuidelines, so every future project starts smarter.
>
> **How to use it:** see "Rules for agents" at the bottom. Copied from `templates/THINGS-LEARNED.md` in InternalDesignGuidelines.

---

## Entries

Newest first. Copy the block below for each new lesson.

<!--
### YYYY-MM-DD · <short title, a few words>
- **What happened:** what went wrong (or right), with the version and file if it helps. Two or three lines.
- **Lesson:** one sentence, written so it makes sense outside this project.
- **Applies to:** this project only | every project
- **What we changed:** the test, rule, doc or code change that keeps it from happening again (or "nothing yet").
- **Harvested:** no
-->

### 2026-11-23 · Learn API details from the page's own traffic
- **What happened:** the heart needs Spotify's private library API, whose persisted query hashes change without notice. Hard-coding them (as other extensions do) breaks every time Spotify ships.
- **Lesson:** when you ride on someone else's private API, read the values from the requests their own client sends, keep a known default, and fall back to their UI when it fails.
- **Applies to:** every project
- **What we changed:** `learnHash` in `extension/heartline.js`, with a test that the learned hash is used.
- **Harvested:** no

### 2026-11-23 · Prove injection timing with a page that moves first
- **What happened:** the page script has to wrap `fetch` before Spotify's first request or the token is missed. Whether a preload's `webFrame.executeJavaScript` runs early enough isn't documented.
- **Lesson:** when order matters, make the test page do the thing first (an inline `fetch` at the top of `<head>`) and assert the hook saw it, instead of trusting docs.
- **Applies to:** every project
- **What we changed:** `test/fixtures/player.html` and the `status.auth` check in `test/smoke/run.js`.
- **Harvested:** no

---

## Rules for agents

**What counts as a lesson.** Something that would change how you build the *next* project. Examples:
- "Our tests checked that UI nodes existed, never what they looked like. 27 passing scripts sat on an unplayable UI." (how to test)
- "A new signing key per build meant every install wiped Joseph's save, so he stopped testing." (how to ship)
- "Joseph had to write EVERYTHING IS AUTHORIZED to stop permission questions." (how to work with him)
- Things that went *right* and should be copied count too.

**What doesn't.** One-off bugs, API quirks only this project hits, and routine changes. Those go in the changelog, the project's "things that have bitten" list, or its API notes.

**Before you write one,** check whether [`CODING.md`](https://github.com/JPLuker/InternalDesignGuidelines/blob/main/CODING.md) already teaches it. If it does, the entry is one line: what happened here, and the lesson number (`CODING 4.1`). A second project hitting the same lesson is worth recording; it makes it a pattern.

**When to add an entry:**
- In the **same commit** as the work that taught it (SOP.md Part 8).
- At the end of every session, ask: "did anything today change how I'd build the next project?" If yes, add it before you stop.
- When Joseph says "remember this for next time" or similar about how something was built.

**Writing an entry:**
- Plain and short (VOICE.md). Say what happened in numbers and names, not adjectives.
- The **Lesson** line must make sense to someone who has never seen this project.
- Mark **Applies to: every project** only when it really would. When unsure, mark it and let the harvest decide.
- Never edit or delete an old entry's story. If a lesson turns out wrong, add a new entry saying so.

**Harvesting into LESSONS.md** (full steps in InternalDesignGuidelines `LESSONS.md`, "How to harvest"):
- **When:** the project reaches 1.0, moves to maintenance mode, is retired, or Joseph says it's done. Also early, any time an "every project" entry is serious enough that other projects should know now.
- **How:** if you can push to InternalDesignGuidelines, add the lessons to `LESSONS.md` yourself. If you can't, open an issue there titled `Lessons from <Project> (v<version>)` with the unharvested "every project" entries pasted in, and link it here.
- Then set each harvested entry's **Harvested** line to `L-<number> (<date>)` or `issue #<n> (<date>)`.
- Keep this file in the project after harvesting. It's the project's own record.
- Lessons about code (a bug's mechanism and how to check for it) also become a lesson in `CODING.md`, in the chapter they fit.

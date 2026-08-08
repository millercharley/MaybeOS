# Project Operating System — README

This folder is the project's memory and operating protocol. **You (the AI) maintain all of it; every write or modification requires my explicit approval before commit.**

## The files

| File | Role | When you read it |
|---|---|---|
| `STATE.md` | Current state: built vs. planned, active work, open questions, blockers | **First, every boot** |
| `SESSIONS.md` | Rolling session summaries (short-term memory) | Top 1–2 entries at boot |
| `ARCHITECTURE.md` | Living map + **Module Index** (long-term memory of *what/where*) | Relevant slice, on demand |
| `DECISIONS.md` | Immutable log of decisions (long-term memory of *why*) | Before changing any established decision |

## Boot protocol (start of every session)
1. Read `STATE.md`.
2. Read the top 1–2 entries of `SESSIONS.md`.
3. Read only the relevant slice(s) of the `ARCHITECTURE.md` Module Index for today's task.
4. **Do not read the whole codebase.** Read actual code only in the located module slice.
5. State back your understanding of where we are and your plan, before writing code.

## Shutdown protocol (end of every session)
1. Append a new `SESSIONS.md` entry (newest at top).
2. Propose **promotions** of durable facts into DECISIONS / ARCHITECTURE / STATE.
3. On my approval, commit the updates.

## Drift control
Before any code change, confirm it against `DECISIONS.md` and `ARCHITECTURE.md`. If it requires deviating from a committed decision, **stop** and propose a new `DECISIONS.md` entry for approval — never diverge silently.

## Monitoring & maintenance loop (human-in-the-loop)
Production emits a **structured log** (JSON lines: `timestamp`, `severity`, `module`, `error_code`, `context`). Loop: issue surfaces → I capture the log → you map `module` → Module Index → load only that slice → read its code → propose a fix.

## Token-efficiency rules (standing)
- Never load the whole codebase; resolve location via the Module Index, then read only that slice.
- Prefer targeted edits over regenerating whole files.
- Don't re-explain established context back to me; the canonical model is shared ground.
- Keep session summaries short; push durable detail into the layered docs.

## Note on location
These five files live at `project-os/` in the `maybeos-suite` repo (not repo root) because the repo already has a technical `README.md` (setup/quick-start docs) at its root — that one stays as-is.

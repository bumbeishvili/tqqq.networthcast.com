---
name: playwright-repro
description: Reproduce, diagnose, fix and verify web bugs using throwaway Playwright scripts — write a script that makes the bug happen before touching any code, measure real values against ground truth instead of assuming, apply the smallest fix, then re-run the same script to prove it. Use whenever a user reports a bug in a running web app, asks "why is X happening in the browser", asks you to verify a UI change actually works, or when you are about to claim something is fixed without having seen it fixed. Covers auth reuse, console/network capture, reading in-page state, pixel checks, and the measurement traps that make a script lie to you. Start from template.cjs; playbook.md has the recipes.
---
# Playwright Repro

A discipline for browser bug work. You write a `.cjs` file, run it with `node`, learn
something, and delete it. These are throwaway scripts, not a suite you maintain —
nothing here gets committed.

**Start every investigation by copying [`template.cjs`](template.cjs)** into a
scratch directory. It already wires up console/error/network capture, auth reuse,
and artifact output — you only write the part that reproduces the bug.

- **[`playbook.md`](playbook.md)** — the recipes: auth, waiting, reading state, measuring, soak loops, ground truth.

## The loop

```
1. Reproduce  → script makes the bug happen, on demand, every run
2. Measure    → get real numbers; compare against a source of truth
3. Fix        → smallest change that addresses what you measured
4. Re-verify  → re-run THE SAME script; bug gone, nothing else broken
5. Clean up   → remove debug hooks from app source, delete the script
```

Each step gates the next. Step 1 produces the evidence your theory has to explain, and
step 4 produces the evidence that the fix worked. Without step 1 you have a theory
with nothing to explain; without step 4 you have a claim with nothing behind it.

## The four rules

### 1. No repro, no fix

Before you form a theory about the cause, have a script that makes the bug happen.
Once you have exhausted the conditions you can control — data, route, viewport,
account state, timing — report what you tried, name the conditions you could not set,
and ask for them.

### 2. Your measurement is a suspect too

When a script reports something surprising, the script is at least as likely to be
wrong as the app. **Validate the measuring code against a case with a known answer
before trusting it on the unknown one.** A measurement bug produces a consistent,
convincing, entirely fake signal.

### 3. Ground truth comes from outside the app

To check that the app shows the right value, fetch the same value straight from its
source — the API response, the file, the database — in plain Node, and compare the
two. Checking the app against your own expectation tests your expectation.

### 4. Re-run the same script

Re-run the exact file that produced the failure. It is the only thing that can prove
the failure is gone. Then run it against an unrelated area to confirm the rest of the
app still behaves.

## Practices

- **Run headed.** Every investigation runs with a visible browser window
  (`headless: false`) so you watch the bug happen. The window shows layout jumps,
  flashes of stale data, swallowed clicks and stuck spinners that a log reporting
  `rows: 0` leaves out. Reserve headless for long soak loops, once you already know
  what you are looking at (playbook §0).
- **Read the console.** Capture `console`, `pageerror` and failed requests from the
  first run, including when the bug "is only visual". An error names the failing
  module and line; a failed request names the URL and status.
- **Wait on an observable condition** — `until()`, `waitForSelector`,
  `waitForResponse`. A condition still holds on a slower machine; a fixed sleep passes
  on yours and hides the race (playbook §3).
- **Remove every debug hook you add to app source.** `grep` for the hook name before
  you finish, along with `.only`, forced states and hardcoded coordinates (playbook §4).
- **One script per investigation**, named for the bug.
- **Keep scripts in a scratch directory outside the repo**, or delete them before you
  finish.
- **Capture artifacts** (screenshots, JSON dumps) to a folder so you can diff runs.
- **Prefer `getByRole` and visible text over CSS paths.** A selector tied to DOM
  structure breaks on the next refactor and costs the next investigation.

## Reporting a result

State what you ran, what you observed, and what remains unverified:

> Reproduced with `repro.cjs`: 3 of 5 rows render stale totals after the filter
> change. Root cause: the memo key omits `filterId` (`useTotals.ts:42`). After the
> fix the same script shows 5 of 5 correct, console clean. I could not reproduce
> the reported crash on mobile viewport — needs the real device.

Name the parts you could not reproduce. An explicit "unverified" tells the reader what
still needs checking; leaving it out reads as verified.

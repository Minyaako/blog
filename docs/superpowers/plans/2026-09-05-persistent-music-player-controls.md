# Persistent Music Player Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the music player alive across internal navigation and make its compact controls visually regular, with a larger primary play button and an upward in-card volume control.

**Architecture:** Astro's client router performs document swaps while `transition:persist` retains the single player DOM and APlayer audio instance. Page-specific enhancements re-run on `astro:page-load`; player initialization remains idempotent. CSS uses one control size and grid centering, with only the play button promoted.

**Tech Stack:** Astro 7, TypeScript, APlayer, CSS Grid, Playwright, Vitest

**Spec:** Approved in chat on 2026-09-05.

## Global Constraints

- Do not deploy before manual approval.
- Do not add a second audio/player instance.
- Keep the existing three player states and visual language.
- Volume opens upward and remains inside the card.

---

### Task 1: Persistent internal navigation

**Files:**
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/components/MusicPlayerEnabled.astro`
- Test: `tests/e2e/music-player.spec.ts`

- [x] Add a failing browser test that marks the real APlayer audio element, navigates through an internal link, and verifies the same element, selected track, and playback position remain.
- [x] Run the focused desktop test and confirm it fails because navigation reloads the document.
- [x] Add Astro `ClientRouter`, persist the player aside, and initialize page-scoped enhancements on `astro:page-load` without reinitializing the retained player.
- [x] Run the focused test and existing music-player browser tests.

### Task 2: Regular controls and upward volume

**Files:**
- Modify: `src/styles/music-player.css`
- Test: `tests/e2e/music-player.spec.ts`

- [x] Change the existing geometry test to require equal 36px secondary controls, a larger play control, and an upward volume popover contained by the card.
- [x] Run the focused test and confirm it fails against the current horizontal popover.
- [x] Apply the minimal CSS grid and popover changes.
- [x] Run unit tests, all player browser projects, Astro checks/build, and `git diff --check`.

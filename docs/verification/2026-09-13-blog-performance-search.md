# Blog scrolling, navigation and search repair — 2026-09-13

## Scope and acceptance

Based on production commit `008cd39f0aaf505eecdd40aab3168f1efe98258a`, branch `codex/blog-performance-search`.

- Scrolling must never wait for content to become opaque; server-rendered and appended content stays readable.
- Navigation must not hide the old page while loading, scale the full page, or show the domain color veil.
- Dark theme must survive DOM replacement before the new snapshot; theme controls must work after navigation and back.
- Search must initialize on direct entry and repeated client navigation, returning real Pagefind results.
- Preserve the music player instance and playback during navigation.

## Findings and changes

Production browser inspection found below-fold modules at opacity 0, with 420 ms entry animations and up to 270 ms stagger. Reveal initialization now only marks content visible; no observer, opacity gate or stagger is used.

Page navigation previously combined 320 ms outgoing and 520 ms incoming animations, translation/scale, and a full-screen domain color veil. It now uses complementary 160 ms linear snapshot fades with isolated plus-lighter blending. Browsers without view transitions use Astro's immediate swap fallback. Navigation requests are never delayed by a custom exit handler.

Astro's incoming HTML defaults to light. The current theme is copied in `astro:before-swap`; the theme button uses delegated events and refreshes its icon on page load. Blocked localStorage no longer prevents initial theme selection.

Search is a static Pagefind index generated during `pnpm build`, not an independent daemon. The previous DOMContentLoaded-only initializer missed client navigation. It now initializes on Astro page load, guards each current container against duplicate initialization, and hides the fallback once successfully mounted.

## Verification

- Astro check: 0 errors, warnings or hints.
- Unit tests: 28 files / 197 tests passed.
- Astro build and Pagefind succeeded with fixture content (8 indexed pages). The first sandboxed build could not fetch existing public lyrics; the network-enabled rerun succeeded.
- Browser computed styles: all four homepage modules are opacity 1 with no animation duration or delay, including modules below the viewport.
- Initial desktop shell/player checks passed, including retained player instance and playback position.
- Search's initial browser failure was traced to dist generated two seconds before the final fallback fix. Rebuilt assets pass repeated navigation and real queries.
- Independent review caught a transparent-snapshot ghosting risk; complementary fades corrected it. No other actionable implementation findings.
- Final multi-device checks: 45 initial motion/search cases passed; three ambiguous test locators were corrected. The 9 focused reduced-motion/offscreen/theme checks and 3 native snapshot checks then passed across desktop/mobile/tablet. Desktop shell and music-player checks passed. Final implementation has no failing focused checks. Release evidence is recorded after the pipeline completes.

## Release and rollback

Use the existing GitHub PR/CI and production immutable-image pipeline. Do not deploy fixture builds. The pre-change production image is `ghcr.io/minyaako/blog:008cd39f0aaf505eecdd40aab3168f1efe98258a`; rollback is the existing `/usr/local/sbin/blog-release deploy <sha>` interface. No schema, persistent data, gateway or music library changes are needed.

# Navigation, initial loading, and persistent player

## Behavior

- Hide the outgoing page snapshot immediately. Only the incoming page fades and slides up 48 px over 320 ms; reduced motion remains immediate.
- Use native Chinese UI fonts instead of downloading Noto Sans SC subsets. Keep Manrope for display text. Chinese glyph appearance now follows the operating system.
- Load KaTeX CSS with articles and moment cards instead of every page.
- Keep only the first hero image in the initial request set. Decode the second image before the 60-second rotation, preserve the current image on failure, and stop timers when leaving the page or hiding the document.
- Set APlayer audio preload to `none`. Persistent player icons contain their own SVG paths, so navigation cannot remove a page-owned symbol and leave a blank play/pause button.
- Change only the site's friend-exchange avatar link and copied template to the user-supplied `pic.minyako.top` WebP. The favicon and other friends' avatars are unchanged.

## Verification before publication

- Full build: 492 unit tests passed; Astro reported no errors, warnings, or hints.
- Focused home, motion, friends, and article suite: 120 passed initially. Six initial failures were an insecure browser origin for clipboard access and a test that advanced time before Astro page initialization. After using the localhost proxy and waiting for hero initialization, all six cases passed in a nine-case rerun across desktop/mobile/tablet.
- Player: 24 browser cases passed across three viewports, including actual play/pause after navigation, nonzero SVG path bounds, and no audio request before interaction. The corresponding old build reproduced zero path bounds after leaving Moments.
- Supplemental SPA typography test: homepage → formula article → About → Moments passed in all three viewports. It verifies a persistent document, actual KaTeX font loading, and unchanged body font family.
- Visual baseline update: 78 cases passed. Representative light/dark desktop/mobile/tablet homepage, article, personal home, friends, moments, and player screenshots were inspected. Global font changes account for the baseline refresh.
- Independent review found no P1/P2 issues. No publishing, database, or reaction API behavior changed.

## Production baseline

Measured against production `dd7e94c98639a26646d6f9fdd2fa0e84f23fc4cc` with three fresh Chromium contexts, cache disabled, 390 x 844 viewport, 60 ms simulated latency, 750,000 bytes/s download, 4x CPU slowdown, and a five-second observation after `load`. All non-GET comment-service requests were blocked to avoid test visits or reactions.

- Completed transfer totals: 1,481,688 / 1,481,676 / 1,481,688 bytes.
- Font transfers: 977,367 bytes across 19 requests in each sample.
- LCP: 1,256 / 1,264 / 868 ms. These are synthetic samples, not field percentiles.
- The old page initiated audio loading; unfinished transfers are not included in the byte totals. Do not interpret these totals as the full audio download size.

Post-deployment results belong in the release handoff after the same live measurement is repeated. Source changes alone are not evidence of a production speedup.

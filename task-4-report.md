# Task 4 report: stabilize route visual capture

## Result

- Changed `tests/e2e/visual.spec.ts` only.
- Added `stabilizePageScreenshot(page)`, which hides the asynchronously initialized global music player in route-level screenshots and asserts that boundary.
- The player remains covered by its dedicated desktop and mobile component screenshots.
- No product CSS, screenshot baseline, diff threshold, sleep, or article coverage was changed.

## Evidence

- RED: GitHub Actions run `33951588140` alternated between a route screenshot before and after the music player appeared, producing heights `1280x3644` and `1280x3641` and failing screenshot stability.
- The diff artifact localized the changed pixels to the global music player. Forcing root scrollbar state was rejected because it changed existing baselines without addressing that asynchronous boundary.
- GREEN: `pnpm exec playwright test tests/e2e/visual.spec.ts --project=desktop --grep "article light" --repeat-each=3` passed 3/3 with the player excluded from the route baseline.
- GitHub Actions run `33951588140` showed the Linux failure alternating between `1280x3644` and `1280x3641`, ending with `Failed to take two consecutive stable screenshots`.
- The baseline refresh run `33951372145` generated the Linux article-light desktop baseline at `1280x3644` from the same head.
- `git diff --check` passed. `pnpm exec tsc --noEmit` is blocked by the existing `tsconfig.json(4,5)` TypeScript 6 deprecation error for `baseUrl` (`TS5101`), unrelated to this test-only change.

Linux CI remains the authoritative cross-platform verification environment. Linux route baselines must be regenerated once for the newly explicit boundary before the production gate is rerun.

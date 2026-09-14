# Personal theme refresh — 2026-09-14

Base: 372a1e5 origin/main. Isolated branch codex/blog-personal-theme.
Scope R3: public routes, persistent pageview integration, public contacts/profile update, normal CI deployment.

Acceptance:
- Header: archives/projects/academic/about/friends; brand still returns blog /. Search becomes accessible icon; Ctrl+K and Cmd+K open lazy local Pagefind modal, focus/escape/navigation cleanup.
- /academic/: SNN + MARL interests, no invented publications.
- /friends/: Axi404 verified friend; RSS/Atom latest items fetched bounded and displayed safely. Copyable site information: Minyako的幻想乡 / 真希望能悠闲度日.
- White cat-ear SVG favicon and header mark; reuse tokens, responsive/dark/reduced motion, no heavy decoration.
- Real article view counts using existing Waline service. No local/preview writes, no duplicate navigation listeners, errors distinct from 0.
- /home/: personal intro, research/project/blog links, QQ810225302 and emails funni8034@gmail.com +1411854675@qq.com. GitHub Minyaako Website and public profile README point there, explicitly authorized.
- Preserve content, current ranking/music/comment behaviors, prior animation performance fixes.

Ownership: root navigation/search/profile/icon/config/SEO; friends_circle new friends files; article_views article stats + ArticleLayout. Independent final reviewer required.
Verification: targeted unit+browser navigation/keyboard/empty-feed/failure/viewcount, Astro full build, desktop/mobile visual pass, appropriate existing regression tests, independent review. CI/deploy uses immutable SHA and previous image rollback. Update GitHub profile only after /home/ works in production.

Implementation evidence:
- 415 unit tests passed; final Astro check: 0 errors/warnings/hints; Astro build + Pagefind passed with real public RSS/lyrics.
- Independent review: no P1/P2. Browser-found icon/router competition fixed using capture-phase prevention; keyboard/click/navigation/fallback retest 15/15.
- Accessibility checks passed at desktop/mobile/tablet (33 checks). Linux visual matrix 78 generated successfully; new personal home light desktop, dark mobile, friends desktop and academic mobile inspected.
- New RSS source is Axi's Blog, verified official rel=alternate https://axi404.top/rss.xml. 30 titles/links/dates, ~4.5KB static JSON, failed=0. Updates on blog rebuild (not a live polling service).
- Existing home domain locator narrowed after new academic nav caused ambiguity. Container browser test origin changed to loopback for normal clipboard support; preview restarted after rebuilding SSR chunks. No unrelated production changes required.
- Final selected browser matrix: all 153 scenarios covered successfully after targeted corrections/retests (144 initial passes, 60 rerun passes plus final3 article assertions). New count shares the article key, so legacy comment locator explicitly scopes [data-comment-slot] and separately verifies the disabled local counter.
- Visual baselines updated only for intentional new shell/layout surfaces; standard REFRESH_VISUAL_BASELINES remains false.
- Pre-release production image is ccr.ccs.tencentyun.com/minyako-blog/blog:372a1e5c713677bd6241a11f661c91d707980ae0. Existing latest main CI was green.

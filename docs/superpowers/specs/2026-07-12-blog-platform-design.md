# Minyako Blog Platform Design

Status: approved in brainstorming; awaiting written-spec review
Date: 2026-07-12

## Purpose

Build a deeply customized personal blog on Astro for `minyakogsk.icu`. The site
is a personal digital home and a long-lived content archive. Academic and
engineering writing are the primary focus, while life and games are maintained
as equally deliberate content domains rather than miscellaneous posts.

The first release uses Git and Markdown/MDX for authoring. Its content model
must remain stable enough for a later graphical publishing tool to write the
same files and metadata without migrating the site.

## Reference and Design Position

The primary reference is Axi's Blog at `https://axi404.github.io/`. We borrow
its content-rich personal-site structure, static Astro delivery, Pagefind
search, and independently hosted comment service. We do not copy its visual
identity or information hierarchy.

The Minyako design uses a panoramic image as the visual top bar, followed by a
restrained reading interface. A compact identity block, four domain entrances,
and recent long-form writing make the homepage a gateway. Detailed biography
and site explanation live on the About page.

## Goals

- Publish a fast, accessible, responsive Astro site at `minyakogsk.icu`.
- Support academic, engineering, life, and games as first-class domains.
- Allow every domain to define extensible subcategories.
- Provide tags, collections, archives, static full-text search, RSS, Sitemap,
  SEO metadata, light/dark/system themes, and a useful 404 page.
- Support long-form technical and academic writing, image-led game content,
  galleries, math, code, footnotes, citations, and callouts.
- Protect spoilers and sensitive content in lists, search, feeds, previews, and
  article bodies.
- Provide guest comments, GitHub login, page views, and comment administration
  through an independently hosted Waline service.
- Automatically validate, build, deploy, health-check, and roll back releases.
- Keep the comment provider, media storage, and future authoring interface
  replaceable.

## Non-Goals for the First Release

- A browser-based content management or graphical publishing interface.
- English articles or a visible language switcher.
- A custom comment backend.
- A complex comment trust system, approval queue, or email verification flow.
- Direct object-storage integration.
- Guest avatar file uploads.

## Repository and Ownership

The blog lives in the standalone public GitHub repository
`https://github.com/Minyaako/blog`. Its local checkout is
`D:\seRver\apps\blog`, inside the umbrella server workspace but outside the Git
ownership of the root `server-infra` repository.

"Standalone repository" means independent Git history and application
ownership; it does not require placing the checkout outside `D:\seRver`.
Application code, content, design documentation, deployment configuration, and
operational notes belong in the nested blog repository. The shared
`server-infra` repository records only the blog's local and remote paths,
domains, deployment state, backup expectations, release state, and Caddy
ownership.

The parent workspace's shared files must not be modified during ordinary blog
implementation. Coordinated changes to the server index or shared conventions
are separate infrastructure changes and must be committed in the parent
repository.

Because the repository is public:

- secrets, tokens, OAuth credentials, comment data, deployment credentials, and
  private drafts never enter Git;
- `draft: true` prevents publication but does not provide confidentiality;
- genuinely private drafts stay outside the public repository;
- third-party images may only be committed when their license permits it.

## System Architecture

```text
Public GitHub blog repository
  Markdown / MDX content
  Astro components and design system
  GitHub Actions
            |
            v
Tencent Cloud Ubuntu server
  Caddy gateway
    minyakogsk.icu
      immutable static-site container
    comments.minyakogsk.icu
      Waline container
        SQLite persistent volume
    media.minyakogsk.icu
      read-only media-serving container
        server media directory
```

Astro produces static output. The production blog has no Astro server-rendering
runtime. Pagefind indexes the generated HTML after the Astro build.

Waline is deployed as a separate service. The blog accesses it through a stable
domain and an application-level `CommentProvider` boundary. Only the Waline
adapter knows Waline-specific configuration and data. A future provider can
replace it without changing article or page components.

The site, comments, and media services share Caddy's proxy network but keep
their storage and failure domains separate. Replacing or redeploying the site
must not modify comments or media.

## Content Model

All publishable posts use one Astro Content Collection named `posts`. A domain
and optional subcategory determine where each post appears. Components and
routes do not hard-code the available subcategories.

The four initial domains are:

- `academic`: papers, research notes, and academic reflection;
- `engineering`: technical notes, engineering practice, tutorials, and tools;
- `life`: journals, travel, and observations;
- `games`: visual-novel reviews, reflections, and galleries.

Illustrative initial subcategories include:

```text
academic/paper-reading
academic/research-notes
engineering/tutorials
engineering/devlogs
engineering/tools
life/journals
life/travel
games/reviews
games/reflections
games/gallery
```

The taxonomy is configuration-driven. Adding a subcategory requires a taxonomy
entry and valid post metadata, not a new page implementation.

Categories express stable hierarchy. Tags create cross-domain relationships
such as a work, studio, character, research topic, or technology. Collections
represent ordered or curated series.

### Post Schema

The schema validates at least these concepts:

```yaml
id: stable-permanent-id
title: Article title
description: Safe public summary
publishedAt: 2026-07-12
updatedAt: 2026-07-12
domain: engineering
subcategory: devlogs
tags: []
collections: []
cover:
  url: https://media.minyakogsk.icu/example.webp
  alt: Descriptive alternative text
  credit: Author or source
  sourceUrl: https://example.com/source
authors: [Minyako]
draft: false
featured: false
lang: zh-CN
translationKey: stable-translation-key
license: CC-BY-4.0
contentWarning:
  type: none
  message: ""
  scope: none
```

Real validation distinguishes required fields, optional fields, and enumerated
warning values. The example is explanatory rather than a literal final schema.

Each post has a permanent `id` independent of its slug and URL. Comments and
page views use this ID as `pageKey`, so renaming a post or changing its taxonomy
does not detach its dynamic data.

### Media Metadata

Content images store a URL, alternative text, dimensions when known, source,
credit, license note, and spoiler/sensitive flags. Social cards, RSS, search
summaries, and archive cards never expose protected images or protected text.

## URL and Information Architecture

Post URLs are stable and taxonomy-independent:

```text
/posts/<slug>/
```

Domain and subcategory pages filter the collection instead of owning the post
URL. Moving an article between categories does not break its permanent link.

The first release contains:

- homepage;
- four domain landing pages;
- subcategory, tag, collection, and yearly archive pages;
- post pages;
- projects;
- About;
- search;
- RSS and Sitemap;
- 404.

Chinese is the default language and has no `/zh/` prefix. The data model and UI
copy system reserve `lang` and `translationKey`. Future English pages use
`/en/`; search, feeds, and metadata can then be generated per language.

## Homepage and Visual System

The homepage order is:

1. compact global navigation;
2. panoramic image top bar;
3. avatar, ID, one-line introduction, and external platform links;
4. entrances to academic, engineering, life, and games;
5. one emphasized long-form article and a short recent-article list;
6. footer with RSS, licensing, and essential links.

The full biography, site purpose, distribution notes, platform list, and
licensing explanation belong on About.

The base design uses a neutral background, fine separators, readable type, and
generous whitespace. Each domain has a restrained accent color used for small
icons, tags, links, focus states, and selected borders. Accent colors do not
become large page backgrounds.

The panoramic image provides the primary visual personality. It may change by
season or current interest. Every image has a source and credit. Text does not
depend on uncontrolled image contrast.

Icons are local SVG components included at build time. Functional icons have
accessible names; decorative icons are hidden from assistive technology. The
system keeps icon size, stroke weight, alignment, hover behavior, and focus
behavior consistent.

## Archive and Listing Cards

Archive and rich listing pages use wide cards inspired by the reference layout:

- date, title, description, reading time, and tags on the left;
- cover artwork on the right;
- a gradient transition between text and image;
- the entire card acts as a discoverable link with a visible keyboard focus;
- missing covers use a domain-colored geometric pattern;
- sensitive and spoiler covers remain obscured;
- mobile layouts become vertical or compact instead of compressing the text.

Images used only as card atmosphere have empty alternative text because the
semantic article summary already communicates the destination.

## Article Experience

Article pages prioritize long-form reading:

- bounded line length and responsive typography;
- sticky table of contents on wide screens and a collapsible equivalent on
  small screens;
- syntax highlighting, code-copy controls, math, footnotes, citations, quotes,
  and callouts;
- publication date, update date, estimated reading time, and reading progress;
- responsive galleries with captions, lazy loading, keyboard navigation, and
  a lightbox;
- previous/next and related-content navigation based on explicit metadata and
  taxonomy;
- delayed comment loading below the article.

Light, dark, and system themes are supported. Theme selection persists locally.
Motion respects `prefers-reduced-motion`.

## Spoilers and Sensitive Content

Ordinary tags communicate labels to readers. Structured `contentWarning`
metadata controls behavior.

- Spoilers are blurred by default and may be revealed per block or image.
- Sensitive pages show a clear confirmation dialog before revealing content.
- Consent may be remembered for the current browser session.
- Dialog focus is trapped correctly and returned to the triggering control.
- Protected material is excluded from public summaries, feeds, search snippets,
  archive covers, and social preview cards.

## Comments and Page Views

The first implementation uses a self-hosted Waline server behind
`comments.minyakogsk.icu`.

```ts
interface CommentProvider {
  mount(target: HTMLElement, pageKey: string): Promise<void>
  getPageViews(pageKey: string): Promise<number>
  dispose(): void
}
```

This interface is the application boundary, not a promise to mirror every
Waline HTTP endpoint. The Waline adapter is the only module that imports the
Waline client or understands its options.

First-release behavior:

- guest comments with nickname and avatar information;
- a stable generated avatar when no usable avatar is provided;
- GitHub OAuth login;
- immediate publication;
- basic rate limiting, bot protection, administrative deletion, and the Waline
  management interface;
- page views keyed by permanent post ID;
- lazy client loading when the comment section approaches the viewport.

Guest avatar file uploads, approval queues, trusted visitors, and email
verification are deferred. A later custom service can take over the stable
comment domain after data export and migration.

## Media Storage

Repository-managed assets include the logo, avatar, icons, default banners,
small design textures, and other versioned presentation assets.

Article images and galleries live in a persistent server directory exposed at
`media.minyakogsk.icu`. They are not committed to Git, copied into a site image,
or deleted during deploy and rollback.

Markdown stores stable media URLs and metadata. Builds do not download every
remote original, so a temporary media outage does not prevent publishing. A
documented upload procedure produces normalized filenames and web-friendly
derivatives.

When storage grows, the media domain may move behind Tencent COS and a CDN.
Keeping stable public URLs or Caddy redirects prevents content migration from
rewriting every article.

## Copyright

Original blog writing defaults to CC BY 4.0. Reuse is permitted with attribution,
a source link, license notice, and disclosure of modifications.

Third-party illustrations, screenshots, game assets, quotations, trademarks,
and other copyrighted material retain their original ownership and licensing.
The blog's CC BY 4.0 notice does not relicense them. About, the footer, and post
metadata communicate this distinction.

## Continuous Integration and Deployment

Pull requests and non-main branches run validation without publishing. A push
to `main` runs:

1. dependency installation from a locked package graph;
2. content schema validation;
3. Astro type checking and linting;
4. unit and component tests;
5. Astro static build;
6. Pagefind indexing;
7. generated-link, feed, Sitemap, and asset checks;
8. browser smoke tests and accessibility checks;
9. visual regression checks;
10. immutable site image creation and publication;
11. authenticated remote deployment;
12. health check and success switch, or rollback.

GitHub Actions credentials live in repository Secrets. Runtime configuration
and OAuth credentials live under `/srv/secrets/blog`. The public repository
contains only examples of configuration keys, never live values.

## Testing and Visual Verification

### Content and Unit Checks

- Validate required frontmatter, permanent IDs, taxonomy references, image
  credits, warning metadata, and language metadata.
- Reject duplicate permanent IDs and duplicate production slugs.
- Test route generation, reading-time calculation, safe summaries, feeds, and
  comment-provider failure behavior.

### Component and Browser Checks

- Test navigation, theme switching, spoiler reveal, sensitive-content dialogs,
  galleries, search, and comment fallback states.
- Exercise homepage, domain, archive, post, search, About, and 404 routes.
- Verify guest comments and the GitHub callback in a controlled test
  environment without writing to production data.
- Check keyboard navigation, focus order, dialog focus management, headings,
  contrast, and image alternatives.

### Frontend Visual Checks

Visual inspection is an explicit release gate, not an informal final glance.

- Playwright captures deterministic screenshots for representative pages.
- Baselines cover homepage, archive, text-heavy post, code/math post, gallery,
  warning dialog, search, About, and 404.
- Each representative page is captured at phone, tablet, and desktop widths in
  both light and dark themes where applicable.
- CI uploads current, baseline, and difference images for review.
- Unexpected pixel differences block publication until accepted or corrected.
- A human checklist covers banner cropping, cover gradients, icon completeness,
  font loading, line wrapping, overflow, focus rings, empty states, reduced
  motion, and protected-image leakage.
- Intentional changes update baselines in the same reviewed change.

Dynamic dates, page views, animations, and comments are frozen or mocked in
visual tests so snapshots remain stable.

## Failure Handling

- Waline outage: articles remain available; comments show a compact failure
  message and retry action.
- Page-view failure: omit the number rather than showing an error or spinner
  indefinitely.
- Pagefind failure: search explains that it is unavailable; archives and domain
  navigation remain usable.
- Media failure: show alternative text, credit/source when useful, and a
  consistent fallback surface.
- GitHub login failure: retain the guest-comment path and show an understandable
  error.
- Content or build validation failure: block deployment and retain the current
  production release.
- Deployment health-check failure: restore the previous immutable site image.
- Dynamic-service data remains on persistent volumes throughout rollback.

## Backup and Recovery

The Waline SQLite database and server media directory are backed up independently
of application deploys. The application runbook documents backup frequency,
retention, restoration, ownership, and permission checks. A backup is not
considered valid until a restoration procedure has been tested.

## First-Release Acceptance Criteria

- `minyakogsk.icu` serves the site over HTTPS through Caddy.
- Homepage, About, projects, domain pages, subcategory pages, archives, tags,
  collections, search, RSS, Sitemap, and 404 are complete.
- Each of the four domains contains at least one polished example post that
  demonstrates the relevant blog capabilities.
- Every domain can add subcategories through configuration and content metadata.
- Archive cards use the approved left-text/right-image design.
- The panoramic image top bar, avatar, ID, platform icons, restrained domain
  colors, and complete SVG icon system are implemented.
- Responsive light/dark/system themes work across supported page types.
- Code, math, citations, galleries, and long-form reading features work.
- Spoiler and sensitive-content protection covers bodies, listings, search,
  feeds, and previews.
- Guest comments, GitHub login, page views, and administration work through the
  isolated Waline service.
- Comment failure cannot prevent article reading.
- Repository assets and server-hosted content media follow their defined storage
  boundaries.
- Main-branch pushes publish automatically; failed releases preserve the prior
  version.
- Automated accessibility, browser, and visual regression checks pass.
- A human visual review confirms image crops, icons, typography, responsive
  layout, and protected-content behavior.
- Backup and restoration instructions exist for comments and media.
- About and the footer state CC BY 4.0 while preserving third-party rights.

## Deferred Evolution

- Graphical publishing that writes the same Markdown and schema.
- English content and visible language switching.
- Rich comment moderation and visitor trust.
- A custom comment service behind the existing provider boundary and domain.
- Migration of media storage to Tencent COS and CDN delivery.
- More domains, subcategories, content formats, and authoring workflows without
  changing permanent post identity.

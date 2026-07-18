# Media CDN cutover evidence

Verified on 2026-07-18 after the production blog switched from repository-served
WebP files to immutable COS objects delivered through EdgeOne.

## Release and deployment state

- Cutover pull request: <https://github.com/Minyaako/blog/pull/9>
- Production commit: `e08438f73a216de8495d051c26d69eaebbdb7703`
- Production workflow: <https://github.com/Minyaako/blog/actions/runs/29591006288>
- Known-good rollback commit: `b836b19bfe750836edf7a6f37cd822ca06dea5b0`
- Production origin: `https://gsk.minyako.top`
- Media origin: `https://pic.minyako.top`

The workflow's `verify`, `publish-media`, and `publish-image` jobs succeeded.
`publish-media` reported `uploaded 0; skipped 7`, followed by `verified 7`,
which proves that all locked immutable objects were already present. The first
automated deployment attempt failed because a deployment lock from an earlier
interrupted image pull remained on the server; it was not a source, image, OIDC,
COS, or CDN failure.

Before removing that stale lock, the administrator verified that its lock file
and token contained the same deployment identifier, shared the same inode with
link count two, its recorded PID no longer existed, and `fuser` reported no
holder. Only those two verified files were removed. Deployment was then run
through `blog-release`; no release state file was edited manually.

Final server state after the complete rollback exercise was:

```text
current=e08438f73a216de8495d051c26d69eaebbdb7703
previous=b836b19bfe750836edf7a6f37cd822ca06dea5b0
ghcr.io/minyaako/blog:e08438f73a216de8495d051c26d69eaebbdb7703 Up (healthy)
```

The deployment lock was absent after deployment completed.

## Production route and page verification

The following final URLs returned HTTP 200:

- `/`
- `/archives/`
- `/about/`
- `/posts/embodied-ai-reading/`
- `/posts/astro-content-architecture/`
- `/posts/visual-novel-memory/`
- `/posts/july-field-notes/`
- `/rss.xml`
- `/sitemap-index.xml`
- `/healthz`

The extensionless HTML routes return a permanent redirect to their trailing
slash form at the production gateway. This is the expected static-file
canonicalization behavior.

The homepage, archive, and four article pages each contained a locked
`https://pic.minyako.top/blog/` URL and contained no legacy
`/images/home/*.webp`, `/images/posts/*.webp`, or
`/images/profile/*.webp` reference. Non-sensitive article social-image metadata
uses the same locked CDN URL as the visible cover. The sensitive visual-novel
article keeps its existing confirmation behavior and omits `og:image`; cover
visibility remains controlled by the exact `hide-cover` tag rather than by its
category.

## Object integrity

All seven URLs in `media/media.lock.json` were downloaded again after the final
restore. Every response was HTTP 200 with `Content-Type: image/webp` and
`Cache-Control: public, max-age=31536000, immutable`. Each byte count and
SHA-256 matched the lock file:

| Logical ID | Bytes | SHA-256 |
| --- | ---: | --- |
| `home-hero-01` | 122524 | `faf4361e6b8c0276daaab9c0f0190d4362968dc6958e61bb6ebd5441cf230329` |
| `home-hero-02` | 91392 | `809007593f410aba1886c15eab6df61c239c6314f12b1ddb3835995706f18f3b` |
| `post-academic-cover` | 265796 | `f03e8a61960275abdd4255138e3e8a5fd471251cefb47024dba6313b04ae5fe2` |
| `post-engineering-cover` | 246712 | `619fe237155b1700a886e06d1da193f81f9c7041c38f101422562cf59547eadc` |
| `post-games-cover` | 220918 | `25ca0d1e0bb72d75603f7f42a50cfb48df6d4e9cd6bd055a7891ca40b89e274d` |
| `post-life-cover` | 94818 | `ff5fbec3339faa8a135d735b170515fd0f10313428c29eeb81121ac0205b57ae` |
| `profile-avatar` | 32284 | `6f5db833ad02f4d0c0db3eef6fe866d4dfb9c44791a11c41cd32a87ad7268bf1` |

No COS object was deleted or overwritten during cutover verification.

## Rollback and restore exercise

The administrator deployed the previous known-good commit exclusively through
the release tool:

```text
blog-release deploy b836b19bfe750836edf7a6f37cd822ca06dea5b0
```

The container became healthy and the public homepage again referenced
`/images/home/hero-01.webp`, `/images/home/hero-02.webp`, and
`/images/profile/avatar.webp`. The engineering article referenced
`/images/posts/engineering-cover.webp`; neither page contained a CDN URL.

The administrator then restored the cutover commit through the same tool:

```text
blog-release deploy e08438f73a216de8495d051c26d69eaebbdb7703
```

After restoration, all ten routes, all six media-bearing pages, and all seven
locked objects passed the checks above again. This proves that application
rollback does not depend on deleting CDN objects and that the cutover can be
reversed by immutable image SHA alone.

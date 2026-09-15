# Production runtime image

Astro bundles the server JavaScript during the build. The production image copies
that bundle, the ranking database CLI and server wrapper, and only the two Sharp
native packages required by the pinned Linux x64 Alpine runtime. Pagefind still
builds the search index; its executable and other build tools are not shipped.

`scripts/prepare-runtime.mjs` checks the emitted runtime imports and resolves the
installed native packages through Node's package resolver. It verifies package
identity, platform and libvips version before copying complete package directories
(including licenses), with symlinks dereferenced. Unknown dependencies or a changed
platform fail the build. Custom Astro loggers require an explicit runtime contract
update; the default bundled logger is supported.

The final Docker stage runs `scripts/runtime-smoke.mjs` as the non-root service
user with only shipped dependencies. It checks temporary SQLite initialization,
schema validation and backup, static and SSR routes, ranking API responses, and
an actual PNG-to-WebP conversion. The smoke script is mounted for the build step
and does not remain in the image. Its database is isolated and removed afterward.

Validate with `docker build --progress=plain -t minyako-blog:runtime-check .`.
The immutable SHA publication, provenance verification and production health/
rollback checks remain unchanged. A smaller image reduces transfer volume; it
does not establish that registry network failures have been eliminated.

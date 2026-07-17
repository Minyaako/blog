# Media OIDC bootstrap evidence

Verified on 2026-07-17 before the live blog switched away from its local
`public/images` files.

## Workflow identity and result

- Main commit: `e8d7624db590608c23bf2e8637463d4f858fe5be`
- Workflow run: <https://github.com/Minyaako/blog/actions/runs/29588573785>
- Media job: `87912160626` (`success`)
- Media result: `uploaded 7; skipped 0`, followed by `verified 7`
- Issuer: `https://token.actions.githubusercontent.com`
- Audience: `sts.tencentcloudapi.com`
- Subject: `repo:Minyaako/blog:environment:production`
- Region: `ap-shanghai`
- Public media domain: `https://pic.minyako.top`
- Allowed object prefix: `blog/*`

The complete workflow concluded with a later, unrelated `publish-image`
failure. The prerequisite `verify` job and the OIDC-backed `publish-media` job
both completed successfully. No OIDC JWT, temporary Tencent credential, or
permanent Tencent credential appeared in the logs.

The GitHub `production` Environment accepts only `main`. Its media settings are
non-secret variables; the pre-existing deployment SSH secrets remain separate.
No permanent Tencent `SecretId` or `SecretKey` was created or stored.

## CAM boundary

The OIDC role is
`qcs::cam::uin/100050544585:roleName/github-actions-minyako-blog`. COS object
resources use the bucket APPID, not the account UIN:

```text
qcs::cos:ap-shanghai:uid/1451980311:minyako-media-1451980311/blog/*
```

The role permits only the object operations required by immutable publication:
`HeadObject`, `PutObject`, `InitiateMultipartUpload`,
`ListMultipartUploads`, `ListParts`, `UploadPart`,
`CompleteMultipartUpload`, and `AbortMultipartUpload`. The policy does not
grant object deletion, ACL mutation, bucket configuration, wildcard actions,
or access outside `blog/*`.

The CAM simulator boundary supplied during setup was:

- `blog/*` `PutObject`: allowed
- `other-app/*` `PutObject`: denied
- `blog/*` `DeleteObject`: denied
- bucket ACL mutation: denied

The successful media job additionally proves that the exact production OIDC
subject can assume the role and perform `HeadObject` and `PutObject` under the
bounded `blog/*` resource.

## Independently verified public objects

After the job completed, every URL was downloaded independently to a temporary
file. Each response was HTTP 200 with `Content-Type: image/webp`; the byte count
and SHA-256 matched `media/media.lock.json`.

| Logical ID | Bytes | SHA-256 | Verified URL |
| --- | ---: | --- | --- |
| `home-hero-01` | 122524 | `faf4361e6b8c0276daaab9c0f0190d4362968dc6958e61bb6ebd5441cf230329` | <https://pic.minyako.top/blog/site/home/hero-01-faf4361e6b8c0276daaab9c0f0190d4362968dc6958e61bb6ebd5441cf230329.webp> |
| `home-hero-02` | 91392 | `809007593f410aba1886c15eab6df61c239c6314f12b1ddb3835995706f18f3b` | <https://pic.minyako.top/blog/site/home/hero-02-809007593f410aba1886c15eab6df61c239c6314f12b1ddb3835995706f18f3b.webp> |
| `post-academic-cover` | 265796 | `f03e8a61960275abdd4255138e3e8a5fd471251cefb47024dba6313b04ae5fe2` | <https://pic.minyako.top/blog/posts/embodied-ai-reading/cover-f03e8a61960275abdd4255138e3e8a5fd471251cefb47024dba6313b04ae5fe2.webp> |
| `post-engineering-cover` | 246712 | `619fe237155b1700a886e06d1da193f81f9c7041c38f101422562cf59547eadc` | <https://pic.minyako.top/blog/posts/astro-content-architecture/cover-619fe237155b1700a886e06d1da193f81f9c7041c38f101422562cf59547eadc.webp> |
| `post-games-cover` | 220918 | `25ca0d1e0bb72d75603f7f42a50cfb48df6d4e9cd6bd055a7891ca40b89e274d` | <https://pic.minyako.top/blog/posts/visual-novel-memory/cover-25ca0d1e0bb72d75603f7f42a50cfb48df6d4e9cd6bd055a7891ca40b89e274d.webp> |
| `post-life-cover` | 94818 | `ff5fbec3339faa8a135d735b170515fd0f10313428c29eeb81121ac0205b57ae` | <https://pic.minyako.top/blog/posts/july-field-notes/cover-ff5fbec3339faa8a135d735b170515fd0f10313428c29eeb81121ac0205b57ae.webp> |
| `profile-avatar` | 32284 | `6f5db833ad02f4d0c0db3eef6fe866d4dfb9c44791a11c41cd32a87ad7268bf1` | <https://pic.minyako.top/blog/site/profile/avatar-6f5db833ad02f4d0c0db3eef6fe866d4dfb9c44791a11c41cd32a87ad7268bf1.webp> |

All seven responses returned
`Cache-Control: public, immutable, max-age=31536000`. A second independent
request for `home-hero-01` returned the same SHA-256 and a positive cache age.
No COS object was deleted during verification.

At this bootstrap checkpoint the live blog still referenced the local WebP
files. The CDN cutover is a separate change and can be rolled back independently.

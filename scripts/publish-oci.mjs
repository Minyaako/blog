import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const IMAGE_PATTERN = /^ccr\.ccs\.tencentyun\.com\/minyako-blog\/blog:[a-f0-9]{40}$/
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const INDEX_TYPE = 'application/vnd.oci.image.index.v1+json'
const MANIFEST_TYPE = 'application/vnd.oci.image.manifest.v1+json'
const MAX_JSON = 8 * 1024 * 1024
const digestOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/** Never print child error objects: registry/helper diagnostics may contain credentials. */
export function runCommand(file, args, { timeout = 30_000, maxBuffer = MAX_JSON, onProgress } = {}) {
  return new Promise((done) => {
    const child = execFile(file, args, { timeout, maxBuffer, encoding: 'buffer', killSignal: 'SIGKILL', windowsHide: true }, (error, stdout, stderr) => {
      done({ code: error ? (error.code ?? 1) : 0, stdout, stderr, killed: Boolean(error?.killed) })
    })
    if (onProgress) {
      let pending = ''
      child.stdout?.on('data', (chunk) => {
        pending += chunk.toString('utf8')
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (/^Copying (?:blob|config) sha256:[a-f0-9]+$/.test(line) || line === 'Writing manifest to image destination') onProgress(line)
        }
      })
    }
  })
}

const defaults = { run: runCommand, readFile, mkdtemp, rm, log: console.log }

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`Invalid ${label} JSON`) }
}

function validateDescriptor(descriptor) {
  if (!descriptor || !DIGEST_PATTERN.test(descriptor.digest) || !Number.isSafeInteger(descriptor.size)
    || descriptor.size < 0 || descriptor.size > MAX_JSON) throw new Error('Invalid OCI JSON descriptor')
}

export async function inspectArchive(archive, run = runCommand) {
  const member = async (name) => {
    const result = await run('tar', ['-xOf', archive, name], { timeout: 60_000, maxBuffer: MAX_JSON })
    if (result.code !== 0) throw new Error('Cannot read OCI archive member')
    return Buffer.from(result.stdout)
  }
  const blob = async (descriptor) => {
    validateDescriptor(descriptor)
    const bytes = await member(`blobs/sha256/${descriptor.digest.slice(7)}`)
    if (bytes.length !== descriptor.size || digestOf(bytes) !== descriptor.digest) throw new Error('OCI blob digest or size mismatch')
    return parseJson(bytes, 'OCI blob')
  }
  const layout = parseJson(await member('index.json'), 'OCI layout index')
  if (layout.schemaVersion !== 2 || layout.manifests?.length !== 1 || layout.manifests[0].mediaType !== INDEX_TYPE) {
    throw new Error('OCI archive must contain one complete image index')
  }
  const root = layout.manifests[0]
  const index = await blob(root)
  if (index.schemaVersion !== 2 || index.mediaType !== INDEX_TYPE || !Array.isArray(index.manifests)) throw new Error('Invalid image index')
  const platforms = index.manifests.filter((item) => item.platform?.os === 'linux' && item.platform?.architecture === 'amd64'
    && item.annotations?.['vnd.docker.reference.type'] !== 'attestation-manifest')
  if (platforms.length !== 1) throw new Error('OCI archive requires exactly one linux/amd64 image')
  const platform = platforms[0]
  const platformManifest = await blob(platform)
  if (platform.mediaType !== MANIFEST_TYPE || platformManifest.schemaVersion !== 2 || platformManifest.mediaType !== MANIFEST_TYPE) throw new Error('Invalid platform manifest')
  const attestations = index.manifests.filter((item) => item.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest'
    && item.annotations?.['vnd.docker.reference.digest'] === platform.digest)
  let hasProvenance = false
  for (const descriptor of attestations) {
    const manifest = await blob(descriptor)
    if (descriptor.mediaType !== MANIFEST_TYPE || manifest.mediaType !== MANIFEST_TYPE || !Array.isArray(manifest.layers)) continue
    for (const layer of manifest.layers.filter((item) => item.mediaType === 'application/vnd.in-toto+json')) {
      const statement = await blob(layer)
      if (typeof statement._type === 'string' && /^https:\/\/in-toto\.io\/Statement\/v(?:0\.1|1)$/.test(statement._type)
        && typeof statement.predicateType === 'string' && /^https:\/\/slsa\.dev\/provenance\/v(?:0\.2|1)$/.test(statement.predicateType)
        && Array.isArray(statement.subject) && statement.subject.some((subject) => subject.digest?.sha256 === platform.digest.slice(7))
        && statement.predicate && typeof statement.predicate === 'object') hasProvenance = true
    }
  }
  if (!hasProvenance) throw new Error('OCI archive is missing linked in-toto provenance')
  return root.digest
}

function isManifestUnknown(result) {
  const message = Buffer.from(result.stderr ?? '').toString('utf8')
  return !result.killed && /\bmanifest[ _]unknown\b/i.test(message)
    && !/unauthorized|denied|forbidden|authentication|timed? ?out|timeout|tls|x509|connection|dial tcp|too many requests|\b(?:401|403|429|5\d{2})\b/i.test(message)
}

export async function publishOci({ archive, image, dockerConfig = process.env.DOCKER_CONFIG }, dependencies = {}) {
  const deps = { ...defaults, ...dependencies }
  if (typeof image !== 'string' || !IMAGE_PATTERN.test(image)) throw new Error('Expected the approved CCR repository and a full lowercase commit SHA')
  if (typeof archive !== 'string' || !isAbsolute(archive)) throw new Error('BLOG_OCI_ARCHIVE must be an absolute path')
  const authfile = join(dockerConfig ? resolve(dockerConfig) : join(homedir(), '.docker'), 'config.json')
  const version = await deps.run('skopeo', ['--version'])
  const match = Buffer.from(version.stdout ?? '').toString('utf8').match(/\bskopeo version (\d+)\.(\d+)\.(\d+)\b/)
  if (version.code !== 0 || !match || Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 9)) throw new Error('Skopeo >= 1.9.0 is required')
  const expected = await inspectArchive(archive, deps.run)
  const remote = () => deps.run('skopeo', ['inspect', '--raw', '--authfile', authfile, `docker://${image}`])
  const before = await remote()
  if (before.code === 0) {
    if (digestOf(before.stdout) !== expected) throw new Error('Refusing to overwrite an existing image tag with a different digest')
    deps.log(`Image already published with matching digest ${expected}`)
    return { digest: expected, skipped: true }
  }
  if (!isManifestUnknown(before)) throw new Error('Cannot establish that the destination manifest is absent; publication stopped')

  const temporary = await deps.mkdtemp(join(tmpdir(), 'blog-oci-publish-'))
  try {
    const digestfile = join(temporary, 'digest')
    deps.log(`Publishing verified OCI image ${expected}`)
    const copy = await deps.run('skopeo', ['copy', '--all', '--preserve-digests', '--retry-times', '2',
      '--authfile', authfile, '--digestfile', digestfile, `oci-archive:${archive}`, `docker://${image}`],
    { timeout: 660_000, maxBuffer: MAX_JSON, onProgress: deps.log })
    if (copy.code !== 0) throw new Error(copy.killed ? 'OCI publication exceeded its time limit' : 'OCI publication failed; no deployment allowed')
    const copied = (await deps.readFile(digestfile, 'utf8')).trim()
    if (copied !== expected) throw new Error('Published digest differs from the verified OCI archive')
    const after = await remote()
    if (after.code !== 0 || digestOf(after.stdout) !== expected) throw new Error('Remote manifest verification failed; no deployment allowed')
    deps.log(`Published and verified ${image} at ${expected}`)
    return { digest: expected, skipped: false }
  } finally {
    await deps.rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  publishOci({ archive: process.env.BLOG_OCI_ARCHIVE, image: process.env.BLOG_IMAGE }).catch((error) => {
    // Only our controlled messages reach logs, never a child process error object.
    console.error(`OCI publication stopped: ${error instanceof Error ? error.message : 'unexpected error'}`)
    process.exitCode = 1
  })
}

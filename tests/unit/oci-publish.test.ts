import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { inspectArchive, publishOci } from '../../scripts/publish-oci.mjs'

const archive = resolve('artifacts/test-blog-image.tar')
const image = `ccr.ccs.tencentyun.com/minyako-blog/blog:${'a'.repeat(40)}`
const indexType = 'application/vnd.oci.image.index.v1+json'
const manifestType = 'application/vnd.oci.image.manifest.v1+json'
const hash = (value: Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const result = (stdout = '', code = 0, stderr = '') => ({ stdout: Buffer.from(stdout), stderr: Buffer.from(stderr), code, killed: false })

function fixture({ attestation = true, linkedSubject = true } = {}) {
  const members = new Map<string, Buffer>()
  const blob = (value: object, mediaType: string) => {
    const bytes = Buffer.from(JSON.stringify(value))
    const digest = hash(bytes)
    members.set(`blobs/sha256/${digest.slice(7)}`, bytes)
    return { digest, size: bytes.length, mediaType }
  }
  const platform = { ...blob({ schemaVersion: 2, mediaType: manifestType, config: {}, layers: [] }, manifestType), platform: { os: 'linux', architecture: 'amd64' } }
  const proof = blob({ _type: 'https://in-toto.io/Statement/v0.1', predicateType: 'https://slsa.dev/provenance/v0.2',
    subject: [{ digest: { sha256: linkedSubject ? platform.digest.slice(7) : '0'.repeat(64) } }], predicate: { builder: { id: 'test-builder' } },
  }, 'application/vnd.in-toto+json')
  const attest = { ...blob({ schemaVersion: 2, mediaType: manifestType, config: {}, layers: [proof] }, manifestType),
    platform: { os: 'unknown', architecture: 'unknown' }, annotations: { 'vnd.docker.reference.type': 'attestation-manifest', 'vnd.docker.reference.digest': platform.digest } }
  const root = blob({ schemaVersion: 2, mediaType: indexType, manifests: attestation ? [platform, attest] : [platform] }, indexType)
  members.set('index.json', Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: [root] })))
  const manifest = members.get(`blobs/sha256/${root.digest.slice(7)}`)!
  const remoteResults = [result('', 1, 'reading manifest: manifest unknown'), result(manifest.toString())]
  const copyResult = result('')
  const run = vi.fn(async (file: string, args: string[], _options?: object) => {
    if (file === 'tar') {
      const bytes = members.get(args[2]!)
      return bytes ? { ...result(''), stdout: bytes } : result('', 1, 'not found')
    }
    if (args[0] === '--version') return result('skopeo version 1.13.3')
    if (args[0] === 'inspect') return remoteResults.shift()!
    if (args[0] === 'copy') return copyResult
    throw new Error('Unexpected command')
  })
  const temporary = resolve('artifacts/temporary-digest-only')
  const readFile = vi.fn(async () => `${root.digest}\n`)
  const mkdtemp = vi.fn(async () => temporary)
  const rm = vi.fn(async () => {})
  const log = vi.fn()
  const deps = { run, readFile, mkdtemp, rm, log }
  const publish = () => publishOci({ archive, image, dockerConfig: resolve('artifacts/auth-path-only') }, deps)
  return { members, root, platform, manifest, remoteResults, copyResult, run, deps, temporary, publish }
}

describe('OCI publication safety and identity', () => {
  it('copies the complete verified archive once, preserves digest, and verifies the remote index', async () => {
    const f = fixture()
    expect(await f.publish()).toEqual({ digest: f.root.digest, skipped: false })
    const copies = f.run.mock.calls.filter(([, args]) => args[0] === 'copy')
    expect(copies).toHaveLength(1)
    expect(copies[0]).toEqual(['skopeo', ['copy', '--all', '--preserve-digests', '--retry-times', '2',
      '--authfile', join(resolve('artifacts/auth-path-only'), 'config.json'), '--digestfile', join(f.temporary, 'digest'),
      `oci-archive:${archive}`, `docker://${image}`], { timeout: 1_440_000, maxBuffer: 8 * 1024 * 1024, onProgress: f.deps.log }])
    expect(f.deps.readFile).toHaveBeenCalledExactlyOnceWith(join(f.temporary, 'digest'), 'utf8')
    expect(f.deps.rm).toHaveBeenCalledWith(f.temporary, { recursive: true, force: true })
  })
  it.each([image.replace('minyako-blog/blog', 'other/blog'), image.replace(/a{40}$/, 'latest'), image.replace(/a{40}$/, 'A'.repeat(40)), ''])('rejects unapproved repository or mutable tag: %s', async (unsafeImage) => {
    const f = fixture()
    await expect(publishOci({ archive, image: unsafeImage }, f.deps)).rejects.toThrow('approved CCR')
    expect(f.run).not.toHaveBeenCalled()
  })
  it('requires a full absolute archive path', async () => {
    const f = fixture()
    await expect(publishOci({ archive: 'image.tar', image }, f.deps)).rejects.toThrow('absolute path')
    expect(f.run).not.toHaveBeenCalled()
  })
  it('rejects Skopeo versions that cannot reliably preserve attestations', async () => {
    const f = fixture()
    f.run.mockResolvedValueOnce(result('skopeo version 1.8.0'))
    await expect(f.publish()).rejects.toThrow('Skopeo >= 1.9.0')
    expect(f.run).toHaveBeenCalledOnce()
  })
  it.each([{ attestation: false }, { linkedSubject: false }])('refuses an archive without linked provenance: %j', async (options) => {
    const f = fixture(options)
    await expect(f.publish()).rejects.toThrow('missing linked in-toto provenance')
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'copy' || args[0] === 'inspect')).toBe(false)
  })
  it('detects tampered blobs before contacting the registry', async () => {
    const f = fixture()
    f.members.set(`blobs/sha256/${f.root.digest.slice(7)}`, Buffer.from('{}'))
    await expect(f.publish()).rejects.toThrow('digest or size mismatch')
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'inspect')).toBe(false)
  })
  it('refuses multiple top-level archive images instead of selecting an ambiguous image', async () => {
    const f = fixture()
    f.members.set('index.json', Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: [f.root, f.root] })))
    await expect(inspectArchive(archive, f.run)).rejects.toThrow('one complete image index')
  })
  it('skips an existing exact digest without copy or temporary files', async () => {
    const f = fixture()
    f.remoteResults.unshift(result(f.manifest.toString()))
    expect(await f.publish()).toEqual({ digest: f.root.digest, skipped: true })
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'copy')).toBe(false)
    expect(f.deps.mkdtemp).not.toHaveBeenCalled()
  })
  it('refuses to overwrite an existing tag with different content', async () => {
    const f = fixture()
    f.remoteResults.unshift(result('{}'))
    await expect(f.publish()).rejects.toThrow('Refusing to overwrite')
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'copy')).toBe(false)
  })
  it.each(['unauthorized: authentication required', 'TLS handshake timeout', 'connection reset by peer', 'repository name unknown', 'manifest unknown: unauthorized', 'manifest unknown (HTTP 503)'])('does not interpret an uncertain preflight as absence: %s', async (message) => {
    const f = fixture()
    f.remoteResults.unshift(result('', 1, message))
    await expect(f.publish()).rejects.toThrow('Cannot establish')
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'copy')).toBe(false)
  })
  it('fails closed when copying fails and never emits raw process credentials', async () => {
    const f = fixture()
    f.copyResult.code = 1
    f.copyResult.stderr = Buffer.from('authentication bearer PRIVATE_TEST_VALUE')
    await expect(f.publish()).rejects.toThrow('OCI publication failed')
    expect(JSON.stringify(f.deps.log.mock.calls)).not.toContain('PRIVATE_TEST_VALUE')
    expect(f.deps.rm).toHaveBeenCalledOnce()
  })
  it('rejects an unexpected digest reported by the copy command', async () => {
    const f = fixture()
    f.deps.readFile.mockResolvedValue('sha256:' + '0'.repeat(64))
    await expect(f.publish()).rejects.toThrow('Published digest differs')
    expect(f.deps.rm).toHaveBeenCalledOnce()
  })
  it('fails closed after the copy process is terminated by its timeout', async () => {
    const f = fixture()
    f.copyResult.code = 1
    f.copyResult.killed = true
    await expect(f.publish()).rejects.toThrow('exceeded its time limit')
    expect(f.deps.readFile).not.toHaveBeenCalled()
    expect(f.deps.rm).toHaveBeenCalledOnce()
  })
  it('rejects a post-copy remote digest mismatch', async () => {
    const f = fixture()
    f.remoteResults[1] = result('{}')
    await expect(f.publish()).rejects.toThrow('Remote manifest verification failed')
    expect(f.deps.rm).toHaveBeenCalledOnce()
  })
})

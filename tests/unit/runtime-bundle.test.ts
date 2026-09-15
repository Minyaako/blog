import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { assertNativePackage, assertRuntimeImports, prepareRuntime, RUNTIME_PACKAGES } from '../../scripts/prepare-runtime.mjs'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const manifest = (name: string) => ({ name, version: name.includes('libvips') ? '1.3.2' : '0.35.3', os: ['linux'], cpu: ['x64'], libc: ['musl'],
  ...(name.includes('libvips') ? {} : { optionalDependencies: { '@img/sharp-libvips-linuxmusl-x64': '1.3.2' } }) })

describe('runtime import guard', () => {
  it('permits bundled local modules, Node builtins, and type-only imports', () => {
    expect(() => assertRuntimeImports(`import fs from 'node:fs'; import type { AstroCookies } from 'astro';
      import { type Other } from 'another-type-package'; export { type Third } from 'third-type-package';
      export * from './chunk.mjs'; import('./lazy.mjs'); require('fs');`, 'runtime.ts')).not.toThrow()
  })
  it('does not treat text or comments as imports', () => {
    expect(() => assertRuntimeImports(`const example = "import x from 'fake-package'"; // require('other-package')
      /* import('third-package') */`)).not.toThrow()
  })
  it.each([
    `import value from 'new-dependency';`, `export * from 'new-dependency';`, `import('new-dependency');`,
    `require('new-dependency');`, `__require('new-dependency');`, 'require(`new-dependency`);',
    `import {createRequire as makeRequire} from 'node:module'; const load = makeRequire(import.meta.url); load('new-dependency');`,
    `require.resolve('new-dependency');`,
  ])('rejects untracked external packages: %s', (source) => {
    expect(() => assertRuntimeImports(source)).toThrow('new-dependency')
  })
  it('allows optional debug colors only inside a caught try', () => {
    expect(() => assertRuntimeImports(`try { require('supports-color') } catch {}`)).not.toThrow()
    expect(() => assertRuntimeImports(`require('supports-color')`)).toThrow('supports-color')
  })
  it('rejects unknown dynamic dependency selection', () => {
    expect(() => assertRuntimeImports(`import(packageName)`)).toThrow('dynamic packageName')
    expect(() => assertRuntimeImports(`import(config.entrypoint)`)).toThrow('dynamic config.entrypoint')
  })
  it('accepts the audited Sharp native branches only in a bundled Sharp module', () => {
    const sharp = `//#region node_modules/.pnpm/sharp@0.35.3/node_modules/sharp/dist/sharp.mjs\n`
    const fallback = `require('@img/sharp-win32-x64/sharp.node');`
    expect(() => assertRuntimeImports(fallback)).toThrow('Untracked runtime imports')
    expect(() => assertRuntimeImports(sharp + fallback)).not.toThrow()
    expect(() => assertRuntimeImports(sharp + `require('new-native-library')`)).toThrow('new-native-library')
  })
  it('refuses invalid generated JavaScript instead of accepting an incomplete parse', () => {
    expect(() => assertRuntimeImports('import {')).toThrow('Invalid runtime syntax')
  })
})

describe('native runtime package validation', () => {
  it('requires the target name, platform, and musl ABI', () => {
    const name = RUNTIME_PACKAGES[0]!
    for (const changes of [{ name: 'other' }, { os: ['darwin'] }, { cpu: ['arm64'] }, { libc: ['glibc'] }, { libc: undefined }, { version: undefined }]) {
      expect(() => assertNativePackage({ ...manifest(name), ...changes }, name)).toThrow('Unexpected native')
    }
  })
  it('fails when a native package gains an untracked dependency', () => {
    const name = RUNTIME_PACKAGES[0]!
    expect(() => assertNativePackage({ ...manifest(name), dependencies: { unexpected: '1.0.0' } }, name)).toThrow('Untracked native dependency')
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'blog-runtime-test-'))
  roots.push(root)
  for (const path of ['dist/server/entry.mjs', 'scripts/blog-server.mjs', 'scripts/ranking-db.ts', 'src/lib/ranking.ts', 'src/server/ranking/store.ts']) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), `import 'node:fs';`)
  }
  const locations = new Map<string, string>()
  for (const name of RUNTIME_PACKAGES) {
    const source = join(root, 'package-store', name)
    await mkdir(join(source, 'lib'), { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify(manifest(name)))
    await writeFile(join(source, 'LICENSE'), 'License kept intact')
    await writeFile(join(source, 'lib', 'native-binary.node'), Buffer.from([0, 1, 2, 3]))
    const alias = join(root, 'aliases', name)
    await mkdir(dirname(alias), { recursive: true })
    await symlink(source, alias, 'junction')
    locations.set(name, join(alias, 'package.json'))
  }
  const options = { target: { platform: 'linux', arch: 'x64', musl: true }, locatePackage: (name: string) => locations.get(name)! }
  return { root, options, locations }
}

async function exportedPackageFixture() {
  const f = await fixture()
  const astro = join(f.root, 'node_modules', 'astro')
  const sharp = join(astro, 'node_modules', 'sharp')
  for (const [directory, name] of [[astro, 'astro'], [sharp, 'sharp']]) {
    await mkdir(join(directory!, 'dist'), { recursive: true })
    await writeFile(join(directory!, 'package.json'), JSON.stringify({ name, exports: { '.': './dist/index.cjs' } }))
    await writeFile(join(directory!, 'dist/index.cjs'), '')
  }
  for (const name of RUNTIME_PACKAGES) {
    const source = dirname(f.locations.get(name)!)
    await writeFile(join(source, 'package.json'), JSON.stringify({ ...manifest(name), exports: { './package': './package.json' } }))
    const alias = join(sharp, 'node_modules', name)
    await mkdir(dirname(alias), { recursive: true })
    await symlink(source, alias, 'junction')
  }
  return { ...f, astro, sharp }
}

describe('runtime preparation', () => {
  it('resolves the installed graph through public entries when package metadata is not exported', async () => {
    const f = await exportedPackageFixture()
    const astroRequire = createRequire(join(f.astro, 'dist/index.cjs'))
    expect(() => astroRequire.resolve('sharp/package.json')).toThrow(expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }))
    const result = await prepareRuntime(f.root, { target: f.options.target })
    expect(result.packages).toEqual(['@img/sharp-linuxmusl-x64@0.35.3', '@img/sharp-libvips-linuxmusl-x64@1.3.2'])
    expect(await readFile(join(result.output, RUNTIME_PACKAGES[0]!, 'LICENSE'), 'utf8')).toBe('License kept intact')
  })
  it('checks package identity after resolving a public entry', async () => {
    const f = await exportedPackageFixture()
    await writeFile(join(f.sharp, 'package.json'), JSON.stringify({ name: 'unexpected-sharp', exports: { '.': './dist/index.cjs' } }))
    await expect(prepareRuntime(f.root, { target: f.options.target })).rejects.toThrow('expected sharp, found unexpected-sharp')
    expect(await readdir(f.root)).not.toContain('.runtime-node_modules')
  })
  it('copies just the two resolved native packages, dereferencing package links and keeping licenses', async () => {
    const f = await fixture()
    const result = await prepareRuntime(f.root, f.options)
    expect(result.checkedFiles).toBe(5)
    expect(result.packages).toEqual(['@img/sharp-linuxmusl-x64@0.35.3', '@img/sharp-libvips-linuxmusl-x64@1.3.2'])
    expect(await readdir(result.output)).toEqual(['@img'])
    expect((await readdir(join(result.output, '@img'))).sort()).toEqual(['sharp-libvips-linuxmusl-x64', 'sharp-linuxmusl-x64'])
    for (const name of RUNTIME_PACKAGES) {
      expect((await lstat(join(result.output, name))).isSymbolicLink()).toBe(false)
      expect(await readFile(join(result.output, name, 'LICENSE'), 'utf8')).toBe('License kept intact')
      expect(await readFile(join(result.output, name, 'lib', 'native-binary.node'))).toEqual(Buffer.from([0, 1, 2, 3]))
    }
  })
  it('does not replace an existing runtime directory', async () => {
    const f = await fixture()
    await mkdir(join(f.root, '.runtime-node_modules'))
    await writeFile(join(f.root, '.runtime-node_modules', 'sentinel'), 'preserve')
    await expect(prepareRuntime(f.root, f.options)).rejects.toThrow('already exists')
    expect(await readFile(join(f.root, '.runtime-node_modules', 'sentinel'), 'utf8')).toBe('preserve')
  })
  it('stops before copying when the server gains an external dependency', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'dist/server/entry.mjs'), `import 'new-runtime-dependency';`)
    await expect(prepareRuntime(f.root, f.options)).rejects.toThrow('new-runtime-dependency')
    expect(await readdir(f.root)).not.toContain('.runtime-node_modules')
  })
  it('requires matching Sharp and libvips versions from the installed dependency graph', async () => {
    const f = await fixture()
    const name = RUNTIME_PACKAGES[1]!
    await writeFile(f.locations.get(name)!, JSON.stringify({ ...manifest(name), version: '9.9.9' }))
    await expect(prepareRuntime(f.root, f.options)).rejects.toThrow('versions do not match')
  })
  it('refuses to prepare a host-native package set for a different target', async () => {
    const f = await fixture()
    await expect(prepareRuntime(f.root, { ...f.options, target: { platform: 'linux', arch: 'arm64', musl: true } })).rejects.toThrow('linux/amd64 with musl')
  })
})

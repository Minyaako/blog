import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { createRequire, isBuiltin } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

export const RUNTIME_PACKAGES = ['@img/sharp-linuxmusl-x64', '@img/sharp-libvips-linuxmusl-x64']
const nativePlatforms = ['darwin-arm64', 'darwin-x64', 'linux-arm', 'linux-arm64', 'linux-ppc64', 'linux-riscv64', 'linux-s390x', 'linux-x64', 'linuxmusl-arm64', 'linuxmusl-x64', 'win32-arm64', 'win32-ia32', 'win32-x64', 'freebsd-wasm32', 'webcontainers-wasm32', 'wasm32']
const sharpFallbacks = new Set([
  ...nativePlatforms.map((platform) => `@img/sharp-${platform}/sharp.node`),
  '@img/sharp-wasm32/versions', '@img/sharp-libvips-dev/include', '@img/sharp-libvips-dev/cplusplus',
])

function inCaughtTry(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTryStatement(parent) && parent.catchClause && node.pos >= parent.tryBlock.pos && node.end <= parent.tryBlock.end) return true
  }
  return false
}

/** Check syntax, never regex-match arbitrary strings/comments as imports. */
export function assertRuntimeImports(source, filename = 'runtime.mjs') {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS)
  if (ast.parseDiagnostics.length) throw new Error(`Invalid runtime syntax in ${filename}`)
  const requireNames = new Set(['require', '__require'])
  const createRequireNames = new Set()
  const issues = []
  // Rolldown preserves the original module's region comment. Only this audited
  // Sharp chunk may use platform-selecting native imports/build-only fallbacks.
  const sharpChunk = /\/\/#region node_modules\/[^\r\n]*\/sharp\/(?:dist|lib)\//.test(source)
  function checkLiteral(value, node) {
    if (value.startsWith('./') || value.startsWith('../') || isBuiltin(value)) return
    if (value === 'supports-color' && inCaughtTry(node)) return // Optional debug terminal colors.
    if (sharpChunk && sharpFallbacks.has(value)) return
    if (RUNTIME_PACKAGES.some((name) => value === name || value.startsWith(`${name}/`))) return
    issues.push(value)
  }
  function checkDynamic(arg, node) {
    const expression = arg.getText(ast).replace(/\s/g, '')
    if (sharpChunk && [
      /^`@img\/sharp-libvips-dev-\$\{buildPlatformArch\(\)\}\/(?:include|lib)`$/,
      /^`@img\/sharp-libvips-\$\{buildPlatformArch\(\)\}\/lib`$/,
      /^`@img\/sharp(?:-libvips)?-\$\{runtimePlatform(?:\$\d+)?\}\/(?:package|versions)`$/,
      /^`\.\.\/src\/build\/Release\/sharp-\$\{runtimePlatform(?:\$\d+)?\}-\$\{version\}\.node`$/,
      /^`\.\.\/src\/build\/Release\/sharp-wasm32-\$\{version\}\.node`$/,
    ].some((pattern) => pattern.test(expression))) return
    // Astro's bundled default logger is selected by switch before these fallback
    // imports. A custom logger must be explicitly added to the runtime contract.
    if (['config.entrypoint', 'loggerConfig.entrypoint'].includes(expression)) {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isFunctionDeclaration(parent) && parent.name?.text === 'loadLogger') return
      }
    }
    issues.push(`dynamic ${expression}`)
  }
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const specifier = statement.moduleSpecifier.text
    if (specifier === 'node:module') {
      for (const binding of statement.importClause?.namedBindings?.elements ?? []) {
        if ((binding.propertyName?.text ?? binding.name.text) === 'createRequire') createRequireNames.add(binding.name.text)
      }
    }
  }
  function findRequireNames(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression) && createRequireNames.has(node.initializer.expression.text)) requireNames.add(node.name.text)
    ts.forEachChild(node, findRequireNames)
  }
  findRequireNames(ast)
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const clause = node.importClause
      const typeOnly = node.isTypeOnly || clause?.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every((item) => item.isTypeOnly)) || (!clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((item) => item.isTypeOnly))
      if (node.moduleSpecifier && !typeOnly) checkLiteral(node.moduleSpecifier.text, node)
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const dependencyCall = callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && requireNames.has(callee.text))
        || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && requireNames.has(callee.expression.text) && callee.name.text === 'resolve')
      if (dependencyCall) {
        const arg = node.arguments[0]
        if (!arg) issues.push('dependency call without a module')
        else if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) checkLiteral(arg.text, node)
        else checkDynamic(arg, node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (issues.length) throw new Error(`Untracked runtime imports in ${filename}: ${[...new Set(issues)].join(', ')}`)
}

async function filesBelow(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await filesBelow(path))
    else if (/\.(?:mjs|cjs|js|ts)$/.test(entry.name)) output.push(path)
  }
  return output
}

export async function assertRuntimeBundle(root) {
  const files = [
    ...await filesBelow(join(root, 'dist/server')),
    ...await filesBelow(join(root, 'src/server/ranking')),
    join(root, 'src/lib/ranking.ts'), join(root, 'scripts/ranking-db.ts'), join(root, 'scripts/blog-server.mjs'),
  ]
  for (const file of files) assertRuntimeImports(await readFile(file, 'utf8'), file)
  return files.length
}

export function assertNativePackage(manifest, name) {
  if (manifest.name !== name || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(manifest.version ?? '')
    || !Array.isArray(manifest.os) || manifest.os.length !== 1 || manifest.os[0] !== 'linux'
    || !Array.isArray(manifest.cpu) || manifest.cpu.length !== 1 || manifest.cpu[0] !== 'x64'
    || !Array.isArray(manifest.libc) || manifest.libc.length !== 1 || manifest.libc[0] !== 'musl') {
    throw new Error(`Unexpected native runtime package: ${name}`)
  }
  // Prevent future package updates from silently introducing uncopied dependencies.
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies }
  if (Object.keys(dependencies).some((dependency) => !RUNTIME_PACKAGES.includes(dependency))) throw new Error(`Untracked native dependency in ${name}`)
}

async function verifiedPackageRoot(entry, expectedName) {
  let directory = dirname(await realpath(entry))
  while (true) {
    let manifest
    try { manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (manifest?.name) {
      if (manifest.name !== expectedName) throw new Error(`Unexpected package identity: expected ${expectedName}, found ${manifest.name}`)
      return directory
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`Cannot locate package root for ${expectedName}`)
    directory = parent
  }
}

export async function packageLocator(root) {
  const projectRequire = createRequire(join(root, 'package.json'))
  // Resolve public entry points: Sharp 0.35 does not export ./package.json.
  // Walk their real paths to verified roots instead of assuming pnpm's layout.
  const astroRoot = await verifiedPackageRoot(projectRequire.resolve('astro'), 'astro')
  const astroRequire = createRequire(join(astroRoot, 'package.json'))
  const sharpRoot = await verifiedPackageRoot(astroRequire.resolve('sharp'), 'sharp')
  const sharpRequire = createRequire(join(sharpRoot, 'package.json'))
  return (name) => sharpRequire.resolve(`${name}/package`)
}

export async function prepareRuntime(root = process.cwd(), options = {}) {
  root = resolve(root)
  const target = options.target ?? { platform: process.platform, arch: process.arch, musl: process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime }
  if (target.platform !== 'linux' || target.arch !== 'x64' || !target.musl) throw new Error('Runtime preparation requires linux/amd64 with musl')
  const checkedFiles = await assertRuntimeBundle(root)
  const locatePackage = options.locatePackage ?? await packageLocator(root)
  const packages = []
  for (const name of RUNTIME_PACKAGES) {
    const source = await realpath(dirname(locatePackage(name)))
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    assertNativePackage(manifest, name)
    packages.push({ name, source, manifest })
  }
  const requiredVips = packages[0].manifest.optionalDependencies?.[RUNTIME_PACKAGES[1]]
  if (requiredVips !== packages[1].manifest.version) throw new Error('Sharp and libvips runtime versions do not match')
  const output = join(root, '.runtime-node_modules')
  try {
    await lstat(output)
    throw new Error('Runtime output already exists; refusing to replace it')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const stage = await mkdtemp(join(root, '.runtime-node_modules-'))
  try {
    for (const item of packages) {
      const destination = join(stage, item.name)
      await mkdir(dirname(destination), { recursive: true })
      await cp(item.source, destination, { recursive: true, dereference: true, errorOnExist: true, force: false })
    }
    await rename(stage, output)
  } catch (error) {
    // stage is generated by mkdtemp directly within this build root, never input.
    if (stage.startsWith(`${root}${sep}.runtime-node_modules-`)) await rm(stage, { recursive: true, force: true })
    throw error
  }
  return { checkedFiles, packages: packages.map(({ name, manifest }) => `${name}@${manifest.version}`), output }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareRuntime().then((result) => console.log(`Prepared native runtime: ${result.packages.join(', ')}; checked ${result.checkedFiles} files`), (error) => {
    console.error(`Runtime preparation failed: ${error.message}`)
    process.exitCode = 1
  })
}

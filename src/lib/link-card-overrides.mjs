import { isIP } from 'node:net'

const MAX_SOURCE_BYTES = 8 * 1024
const LIMITS = { title: 240, description: 420, author: 100, image: 2048 }
const KEYS = new Set(Object.keys(LIMITS))
const BLOCKED_HOST_SUFFIXES = ['localhost', 'local', 'internal', 'test', 'invalid', 'example']
const encoder = new TextEncoder()

function hasControl(value) {
  return /[\u0000-\u001f\u007f]/u.test(value)
}

function isTokenSpace(value) {
  return value === ' ' || value === '\t'
}

function skipTokenSpace(source, index) {
  while (index < source.length && isTokenSpace(source[index])) index += 1
  return index
}

function decodeQuoted(source, start) {
  const quote = source[start]
  if (quote !== '"' && quote !== "'") return null
  let value = ''
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]
    if (character === quote) return { value, index: index + 1 }
    if (character === '\\') {
      const escaped = source[index + 1]
      if (escaped !== '"' && escaped !== "'" && escaped !== '\\') return null
      value += escaped
      index += 1
      continue
    }
    if (hasControl(character)) return null
    value += character
  }
  return null
}

function hasExplicitPort(value) {
  const authority = /^https:\/\/([^/?#]*)/iu.exec(value)?.[1]
  if (!authority) return true
  return authority.includes(':')
}

function isBlockedHost(hostname) {
  const host = hostname.replace(/\.$/u, '').toLowerCase()
  if (!host || !host.includes('.') || isIP(host.replace(/^\[|\]$/gu, ''))) return true
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

function isSafeRootImage(value) {
  if (!value.startsWith('/') || value.startsWith('//')) return false
  const path = value.split(/[?#]/u, 1)[0]
  for (const segment of path.split('/')) {
    let decoded
    try { decoded = decodeURIComponent(segment) } catch { return false }
    if (decoded === '.' || decoded === '..' || /[\\/\u0000-\u001f\u007f]/u.test(decoded)) return false
  }
  return true
}

function isSafeImage(value) {
  if (value === '') return true
  if (hasControl(value) || value.includes('\\')) return false
  if (value.startsWith('/')) return isSafeRootImage(value)
  if (!/^https:\/\//iu.test(value)) return false
  let parsed
  try { parsed = new URL(value) } catch { return false }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || hasExplicitPort(value)) return false
  return !isBlockedHost(parsed.hostname)
}

function validateValue(key, value) {
  if (value.length > LIMITS[key] || hasControl(value)) return false
  if (key === 'title' && value.trim() === '') return false
  return key !== 'image' || isSafeImage(value)
}

function parseOverrides(body) {
  const overrides = {}
  const seen = new Set()
  let index = 0
  let pairs = 0

  while (true) {
    index = skipTokenSpace(body, index)
    if (index >= body.length) return pairs ? overrides : null
    if (body[index] === ',') return null

    const keyStart = index
    if (!/[A-Za-z]/u.test(body[index])) return null
    index += 1
    while (index < body.length && /[A-Za-z0-9_-]/u.test(body[index])) index += 1
    const key = body.slice(keyStart, index)
    if (!KEYS.has(key) || seen.has(key)) return null

    index = skipTokenSpace(body, index)
    if (body[index] !== '=') return null
    index = skipTokenSpace(body, index + 1)
    const parsed = decodeQuoted(body, index)
    if (!parsed || !validateValue(key, parsed.value)) return null
    overrides[key] = parsed.value
    seen.add(key)
    pairs += 1
    index = parsed.index

    const spaceStart = index
    index = skipTokenSpace(body, index)
    const hadSpace = index !== spaceStart
    if (index >= body.length) return overrides
    if (body[index] === ',') {
      index = skipTokenSpace(body, index + 1)
      if (index >= body.length || body[index] === ',') return null
    } else if (!hadSpace) {
      return null
    }
  }
}

function validSourceUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || hasControl(value) || /[\\ \t]/u.test(value)) return false
  let parsed
  try { parsed = new URL(value) } catch { return false }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false
  return true
}

/**
 * Parse one standalone URL and an optional, strictly validated override block.
 * @param {unknown} source
 * @returns {{url: string, overrides: Partial<Record<'title'|'description'|'image'|'author', string>>}|null}
 */
export function parseLinkCardSource(source) {
  if (typeof source !== 'string' || encoder.encode(source).byteLength > MAX_SOURCE_BYTES) return null
  source = source.trim()
  if (!source) return null

  let malformedOverride = false
  if (source.endsWith(']')) {
    for (let open = 0; open < source.length; open += 1) {
      if (source[open] !== '[') continue
      const prefix = source.slice(0, open)
      const url = prefix.replace(/[ \t]+$/u, '')
      if (!validSourceUrl(url)) continue
      const overrides = parseOverrides(source.slice(open + 1, -1))
      if (overrides) return { url, overrides }
      const queryOrFragment = url.search(/[?#]/u)
      const body = source.slice(open + 1, -1)
      if (queryOrFragment < 0 || /^[ \t]*[A-Za-z][A-Za-z0-9_-]*\s*=/u.test(body)) malformedOverride = true
    }
  }

  if (malformedOverride || /\[[ \t]*[A-Za-z][A-Za-z0-9_-]*\s*=/u.test(source)) return null
  return validSourceUrl(source) ? { url: source, overrides: {} } : null
}

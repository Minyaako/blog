import { tagSchema, type Tag } from '../schemas/tag'

export type { Tag } from '../schemas/tag'

export interface TagSource {
  filename: string
  data: unknown
}

const normalizeName = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
const filenameId = (filename: string) => (filename.split(/[\\/]/).at(-1) ?? filename).replace(/\.json$/i, '')

export function buildTagRegistry(sources: TagSource[]) {
  const tags = sources.map(({ filename, data }) => {
    const tag = tagSchema.parse(data)
    const expectedId = filenameId(filename)

    if (expectedId !== tag.id) {
      throw new Error(`Tag filename must equal id: expected ${tag.id}.json, received ${filenameId(filename)}.json`)
    }

    return Object.freeze({ ...tag, aliases: Object.freeze([...tag.aliases]) }) as Tag
  })

  const ids = new Set<string>()
  const displayNames = new Map<string, string>()

  for (const tag of tags) {
    if (ids.has(tag.id)) throw new Error(`Duplicate tag id: ${tag.id}`)
    ids.add(tag.id)

    const normalizedLabel = normalizeName(tag.label)
    const existingLabel = displayNames.get(normalizedLabel)
    if (existingLabel) throw new Error(`Duplicate tag label: ${tag.label} (${existingLabel}, ${tag.id})`)
    displayNames.set(normalizedLabel, tag.id)

    for (const alias of tag.aliases) {
      const normalizedAlias = normalizeName(alias)
      const existingName = displayNames.get(normalizedAlias)
      if (existingName) throw new Error(`Duplicate tag label or alias: ${alias} (${existingName}, ${tag.id})`)
      displayNames.set(normalizedAlias, tag.id)
    }
  }

  const ordered = Object.freeze([...tags].sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')))
  const byId = new Map(ordered.map((tag) => [tag.id, tag]))

  return { ordered, byId }
}

const modules = import.meta.glob('../content/tags/*.json', { eager: true, import: 'default' }) as Record<string, unknown>
const registry = buildTagRegistry(Object.entries(modules).map(([filename, data]) => ({ filename, data })))

export function getTag(id: string): Tag {
  const tag = registry.byId.get(id)
  if (!tag) throw new Error(`Unknown tag: ${id}`)
  return tag
}

export function getAllTags(): Tag[] {
  return [...registry.ordered]
}

export function getPostTags(post: { tags: string[] } | { data: { tags: string[] } }): Tag[] {
  const ids = 'data' in post ? post.data.tags : post.tags
  return ids.map(getTag)
}

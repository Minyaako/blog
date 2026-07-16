export const DOMAINS = {
  academic: {
    label: '学术',
    englishLabel: 'Academic',
    color: 'sage',
    description: '论文阅读、研究记录与学术思考。',
    subcategories: {
      'paper-reading': { label: '论文阅读' },
      'research-notes': { label: '研究记录' }
    }
  },
  engineering: {
    label: '技术',
    englishLabel: 'Engineering',
    color: 'amber',
    description: '工程实践、技术笔记与工具记录。',
    subcategories: {
      tutorials: { label: '教程' },
      devlogs: { label: '开发日志' },
      tools: { label: '工具' }
    }
  },
  life: {
    label: '生活',
    englishLabel: 'Life',
    color: 'violet',
    description: '日常、月记、旅行与生活观察。',
    subcategories: {
      journals: { label: '生活札记' },
      travel: { label: '旅行' }
    }
  },
  games: {
    label: '游戏',
    englishLabel: 'Games',
    color: 'rose',
    description: '视觉小说评测、随想与图像收藏。',
    subcategories: {
      reviews: { label: '评测' },
      reflections: { label: '随想' },
      gallery: { label: '图集' }
    }
  }
} as const

export type DomainKey = keyof typeof DOMAINS
export type SubcategoryKey<D extends DomainKey = DomainKey> =
  keyof (typeof DOMAINS)[D]['subcategories'] & string

export function getDomain(domain: string) {
  if (!(domain in DOMAINS)) {
    throw new Error(`Unknown domain: ${domain}`)
  }

  return DOMAINS[domain as DomainKey]
}

export function getSubcategory(domain: DomainKey, subcategory: string) {
  const subcategories = DOMAINS[domain].subcategories as Record<string, { label: string }>
  const result = subcategories[subcategory]

  if (!result) {
    throw new Error(`Unknown subcategory: ${domain}/${subcategory}`)
  }

  return result
}

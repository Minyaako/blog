export interface RankingItem {
  rank: number
  name: string
  category: string
  note: string
}

export interface RankingDefinition {
  id: string
  title: string
  description: string
  updatedLabel: string
  items: RankingItem[]
}

export const rankings: RankingDefinition[] = [
  {
    id: 'visual-novels',
    title: '视觉小说榜',
    description: '记录近期最想重读的叙事作品，关注节奏、人物与余韵。',
    updatedLabel: '2026年8月试排',
    items: [
      { rank: 1, name: '示例作品 A', category: '视觉小说', note: '以叙事节奏与余韵见长。' },
      { rank: 2, name: '示例作品 B', category: '视觉小说', note: '角色之间的沉默很有分量。' },
      { rank: 3, name: '示例作品 C', category: '视觉小说', note: '适合在安静的周末完整读完。' }
    ]
  },
  {
    id: 'restaurants',
    title: '近期餐馆榜',
    description: '一份轻量的近期用餐备忘，排序来自当下体验而非长期评分。',
    updatedLabel: '2026年8月试排',
    items: [
      { rank: 1, name: '示例餐馆 A', category: '日常料理', note: '适合安静地吃一顿晚饭。' },
      { rank: 2, name: '示例餐馆 B', category: '面食', note: '菜单很短，出品节奏稳定。' },
      { rank: 3, name: '示例餐馆 C', category: '咖啡与甜点', note: '下午靠窗的位置光线很好。' }
    ]
  }
]

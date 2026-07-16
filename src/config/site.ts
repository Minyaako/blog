export const SITE = {
  origin: 'https://gsk.minyako.top',
  title: 'Minyako',
  id: '@minyako',
  description: '研究、技术、生活与视觉小说的个人记录。',
  lang: 'zh-CN',
  navigation: [
    { label: '首页', href: '/' },
    { label: '归档', href: '/archives' },
    { label: '项目', href: '/projects' },
    { label: '关于', href: '/about' },
    { label: '搜索', href: '/search' }
  ],
  socials: [
    { label: 'GitHub', href: 'https://github.com/Minyaako', icon: 'simple-icons:github' },
    { label: 'RSS', href: '/rss.xml', icon: 'lucide:rss' }
  ]
} as const

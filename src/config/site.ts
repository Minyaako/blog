export const SITE = {
  origin: 'https://gsk.minyako.top',
  title: 'Minyako',
  id: '@minyako',
  description: '研究、技术、生活与视觉小说的个人记录。',
  lang: 'zh-CN',
  navigation: [
    { label: '归档', href: '/archives/' },
    { label: '项目', href: '/projects/' },
    { label: '学术', href: '/academic/' },
    { label: '关于', href: '/about/' },
    { label: '朋友们', href: '/friends/' }
  ],
  socials: [
    { label: 'GitHub', href: 'https://github.com/Minyaako', icon: 'simple-icons:github' },
    { label: 'QQ：810225302', href: '/home/#contact', icon: 'lucide:message-circle' },
    { label: 'RSS', href: '/rss.xml', icon: 'lucide:rss' }
  ]
} as const

export const CONTACT = {
  qq: '810225302',
  emails: ['funni8034@gmail.com', '1411854675@qq.com'],
} as const

export const MUSIC_UI = {
  fallbackCoverUrl: 'https://pic.minyako.top/blog/33/33186e9fb044ed536211db6dd15c694898e6792f7b0bb8762872a82acb5d51fb.webp'
} as const

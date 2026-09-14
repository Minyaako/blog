export interface Friend {
  name: string
  url: string
  description: string
  avatar?: string
  feed?: string
}

// Only add friends and feed addresses that you have reviewed. See docs/friends.md.
export const friends: Friend[] = [{
  name: "Axi's Blog",
  url: 'https://axi404.top/',
  description: '一只可爱小猫',
  avatar: 'https://axi404.top/avatar/avatar.png',
  feed: 'https://axi404.top/rss.xml'
}]

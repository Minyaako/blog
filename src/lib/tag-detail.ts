import type { MomentView } from './moments'
import type { PostCardData } from './posts'
import type { Tag } from './tags'

export interface TagDetailSections {
  posts: PostCardData[]
  moments: MomentView[]
  hasPosts: boolean
  hasMoments: boolean
}

export function buildTagDetailSections(
  tag: Pick<Tag, 'id'>,
  posts: readonly PostCardData[],
  moments: readonly MomentView[],
): TagDetailSections {
  const filteredPosts = posts.filter((post) => post.tags.some((item) => item.id === tag.id))
  const filteredMoments = moments.filter((moment) => moment.tags.some((item) => item.id === tag.id))

  return {
    posts: filteredPosts,
    moments: filteredMoments,
    hasPosts: filteredPosts.length > 0,
    hasMoments: filteredMoments.length > 0,
  }
}

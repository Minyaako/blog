# 正文链接卡片

在 Markdown / MDX 正文中，把受支持的网址独立成段（上下留空行），发布构建时会自动生成卡片。支持 GitHub 仓库、Bilibili / YouTube 视频及知乎专栏文章、回答。行内链接、命名链接、代码块、列表和引用保持原样。

```md
https://github.com/withastro/astro
```

## 自定义标题、图片等信息

在网址后紧跟一组中括号，写入 `字段="内容"`。字段之间用空格分隔，值需使用英文单引号或双引号；不需要 JSON 花括号。

```md
https://github.com/withastro/astro [title="我使用的 Astro 框架" description="用来构建个人博客。"]

https://zhuanlan.zhihu.com/p/19819851 [title="我的文章标题" description="手动补充简介。" image="/images/posts/life-cover.svg" author="文章作者"]
```

| 字段 | 用途 |
| --- | --- |
| `title` | 自定义标题，不能为空 |
| `description` | 自定义简介；`description=""` 隐藏简介 |
| `image` | 封面地址；`image=""` 隐藏自动封面 |
| `author` | 作者/项目维护者名称；`author=""` 隐藏作者 |

只覆盖填写的字段，其他信息（包括可获取的统计）继续自动获取。平台抓取失败时，自定义内容仍然有效。自定义内容只作用于这一处引用，不改写抓取缓存，也不改变点击后打开的网址。

图片支持站点根路径（例如 `public/images/cover.jpg` 对应 `/images/cover.jpg`），或公开 CDN 的 HTTPS 图片地址。图片由浏览器按需加载，构建时不会请求自定义图片地址。

双引号内可以包含空格；要写入双引号，可改用单引号包围整个值：

```md
https://github.com/withastro/astro [title='我眼中的 "Astro"']
```

字段名拼写错误、重复字段、不完整的括号或不合法的图片地址，会让整段保留为原始文本，便于发现并修正，不会静默丢掉作者填写的内容。

## 显示与更新

卡片左侧显示平台标志和文字，右侧封面向左渐变；没有封面时保留平台标志。Stars / Forks / 播放 / 点赞以图标和数字显示。

自动元数据在构建时获取并缓存；访客阅读时不请求平台接口。统计是抓取时的快照，卡片标注更新时间。YouTube 统计需在构建环境配置 `YOUTUBE_DATA_API_KEY`；知乎等平台拒绝访问时，只能显示回退内容或作者手动补充的元数据。

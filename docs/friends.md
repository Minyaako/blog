# 朋友们与朋友圈

`/friends/` 包含友链、RSS / Atom 朋友圈和交换友链信息。首批友链是用户指定的 Axi's Blog；RSS 地址来自其页面公开的 `rel="alternate"` 声明。移除所有配置时显示友好空态，不展示虚构文章。

在 `src/config/friends.ts` 的 `friends` 数组中添加经过确认的站点：

```ts
{
  name: '朋友的名字',
  url: 'https://friend.example.com/',
  description: '朋友的小站简介',
  avatar: 'https://friend.example.com/avatar.webp', // 可选
  feed: 'https://friend.example.com/rss.xml' // 可选，RSS 2.0 或 Atom
}
```

仅使用自己审核过的公网 HTTPS 地址，不接受访客提交的地址直接进入配置。站点、头像、订阅和文章地址拒绝本机地址、IP、凭证和非标准端口。RSS 源应使用最终地址，抓取不跟随重定向；域名解析由构建环境处理，因此不要配置指向内网的域名。

每次博客构建时抓取前 12 个已配置订阅源，每源最多 5 秒、2 MiB（兼容全文 RSS）。抓取失败单独记为不可用，不阻断发布。下一次构建会自动重试；没有后台定时刷新服务。新增订阅或需要更新文章时，重新构建博客即可。

构建时复用已有开发依赖 jsdom 的 XML DOMParser（不执行脚本、不加载子资源），禁用 DTD / 实体声明，仅保留标题、链接、作者站点名称与日期。构建产物 `/friends/feeds.json` 是最多 30 篇的纯文本摘要快照，不包含原始 XML 或全文。浏览器仅请求该快照，不向朋友的站点跨域抓取；以 DOM 文本节点展示，不渲染 RSS 中的 HTML。文章按日期倒序、按链接去重，无日期的文章排在最后。

朋友圈标注更新时间；源无效 / 暂时不可用会显示状态，零文章会显示空态。禁用 JavaScript 时友链仍可使用，朋友圈会提示开启 JavaScript 查看动态。

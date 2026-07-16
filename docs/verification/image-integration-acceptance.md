# Image Integration Acceptance

验收日期：2026-07-12（Asia/Shanghai）  
验收分支：`codex/static-blog-core`

## 结论

首批头像、首页横幅和文章页首图已经完成“服务器保存 PNG 原图、博客仓库保存 WebP 派生图”的分层接入。首页每 60 秒交叉淡入淡出一次，在减少动态效果时固定首图；四张文章图片映射到四篇既有示例文章，没有作为新的正文图片插入。

## 服务器源图

公共素材库位置：

`/srv/shared-assets/source-images/minyako/blog/2026-initial/`

目录包含：

- `profile/avatar.png`
- `home/hero-01.png`
- `home/hero-02.png`
- `posts/academic.png`
- `posts/engineering.png`
- `posts/life.png`
- `posts/games.png`
- `SHA256SUMS`

七张远端 PNG 已逐一与本地输入进行 SHA-256 对比，7/7 匹配；远端执行 `sha256sum -c SHA256SUMS` 全部返回 `OK`。集合目录权限为 `ubuntu:ubuntu`、`0750`。该路径没有加入 Caddy，也没有公共 URL。

## 仓库派生图

| WebP | 尺寸 | 字节 | 相对 PNG 减少 |
| --- | ---: | ---: | ---: |
| `profile/avatar.webp` | 335 × 348 | 32,284 | 86.2% |
| `home/hero-01.webp` | 2559 × 1130 | 122,524 | 95.7% |
| `home/hero-02.webp` | 2559 × 1439 | 91,392 | 97.6% |
| `posts/academic-cover.webp` | 2559 × 1439 | 265,796 | 95.0% |
| `posts/engineering-cover.webp` | 3084 × 1727 | 246,712 | 96.0% |
| `posts/life-cover.webp` | 1272 × 708 | 94,818 | 92.5% |
| `posts/games-cover.webp` | 2559 × 1439 | 220,918 | 94.6% |

七张文件均经 `ffprobe` 验证为 WebP 且保留原始宽高比。临时 `pics/` 已在远端与派生图双重校验后从博客 worktree 删除，没有 PNG 源文件进入博客 Git 历史。

## 页面行为

- 首页首图初始显示 `hero-01.webp`，两张图片均预加载且不引发布局变化。
- 计时达到 60,000 ms 后切换到第二张，透明度过渡为 1.2 秒。
- 页面进入后台时停止计时；返回可见状态后重新开始。
- `prefers-reduced-motion: reduce` 时保持第一张，不执行自动轮换。
- 头像继续使用圆形裁切、负边距和既有边框。
- 学术、技术、生活文章分别使用对应 WebP 页首图。
- 游戏文章由内容提示 dialog 阻挡；确认后可见页首图。
- 敏感文章的归档卡、RSS、Pagefind 和社交元数据仍不输出受保护封面。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 56 个文件，0 errors / 0 warnings / 0 hints |
| `pnpm test:unit` | 6 个测试文件，11 项通过 |
| `pnpm build` | 36 个静态页面；Pagefind 仅索引 3 篇非敏感文章 |
| `pnpm test:e2e` | desktop、mobile、tablet 共 93 项通过 |
| 视觉回归 | 42 张基线更新后复跑，42/42 无差异 |

人工检查覆盖桌面首页、移动首页、平板归档、技术文章与敏感游戏文章。头像和主要人物没有被不合理裁断；明暗主题可读；敏感文章当前视口仍由模糊遮罩和确认 dialog 覆盖。

## 权利边界

图片由用户提供，当前 frontmatter 使用 `credit: 用户提供图片`。这些第三方图像不适用本站原创文字的 CC BY 4.0 许可。作品名、作者、权利方和来源 URL 在信息齐全后补录；公共素材库与未来的图像资源管理应用将保存相应元数据。

## 延期事项

1. 修复归档卡片悬浮缩放时渐变左侧露出原图色彩的问题。
2. 为归档加入领域、子类和标签组合筛选。
3. 统一全站动效与减少动态效果策略。
4. 按时间或季节选择首页横幅。
5. 实现服务器图像资源管理 Web 应用。

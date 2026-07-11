# Static Core Acceptance

验收日期：2026-07-12（Asia/Shanghai）  
验收实现提交：`0fde48b` (`test: add frontend release gates`)  
验收分支：`codex/static-blog-core`

## 结论

Minyako Blog 的静态核心已经达到进入评论、媒体和部署子项目的条件。当前版本可从锁文件复现安装，能生成完整静态站点、Pagefind 搜索索引、RSS 与 sitemap，并通过桌面、手机和平板的功能、无障碍和视觉回归门禁。

## 自动验证证据

在独立 worktree `D:\seRver\apps\blog\.worktrees\static-blog-core` 对上述提交执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过；pnpm 11.7.0，锁文件无变化 |
| `pnpm check` | 通过；56 个文件，0 errors / 0 warnings / 0 hints |
| `pnpm test:unit` | 通过；6 个测试文件，11 项测试 |
| `pnpm build` | 通过；Astro 生成 36 个页面，Pagefind 索引 3 篇非敏感文章 |
| `pnpm test:e2e` | 通过；desktop、mobile、tablet 共 84 项测试 |
| `git diff --check` | 通过；无空白错误 |

RSS 安全测试确认敏感文章只输出“此内容需要确认后查看。”，不输出原始摘要和封面。Pagefind 同样排除整页敏感正文。

## 前端验收

- 浏览器项目：Desktop Chrome、Pixel 7 mobile、834 × 1112 tablet。
- 视觉基线：7 个代表路由 × 2 个主题 × 3 个视口，共 42 张；生成后再次执行为 42/42 无像素差异。
- 无障碍：首页、归档、技术文章、About、404 在三档视口共 15 次 axe 扫描，无 serious / critical 违规。
- 修复记录：将 Shiki 明暗代码主题切换为 GitHub high-contrast，解决浅色代码标识符 3.48:1 的对比度问题。

人工抽查确认：

- 首页横幅裁切、头像与 ID、四领域入口及最新长文层级正常；
- 移动导航完整显示，无页面横向溢出；
- 归档页在桌面和平板保留左侧文本、右侧氛围图及对比渐变；
- 长文目录、代码、公式、图注与前后篇导航可读；
- 敏感页首屏由原生 dialog 阻挡，确认状态只在当前 session 保存，受保护封面不进入列表/RSS/搜索；
- 明暗主题、平台图标和焦点样式均有稳定基线。

## 已接受的首版范围

- Astro 7 静态输出，Git + MDX 写作，配置驱动的四领域及可扩展子类；
- 首页、归档、领域/子类、标签、合集、文章、搜索、About、项目、404；
- 四篇可发布的领域示例文章与仓库自有几何视觉素材；
- 稳定文章 ID、评论插槽、内容警告、RSS、SEO、Pagefind、sitemap；
- GitHub Actions 构建与浏览器发布门禁。

## 后续计划与非本次范围

1. **Waline 集成**：在独立 API 后封装 Waline；博客只使用稳定 `pageKey`。先接基础评论，再规划免登录昵称/头像与 GitHub 快捷登录，保持未来整体替换能力。
2. **服务器媒体工作流**：为博客在 `server` 共用目录下使用自己的私有远端工作目录；文章媒体先由服务器存储并通过可迁移 URL 引用，容量增长后迁移腾讯 COS。
3. **生产部署**：为 `minyakogsk.icu` 增加独立部署配置、自动发布、HTTPS、缓存与回滚验证。不得修改 `server` 文件夹的共用部分。
4. **内容与品牌替换**：当前头像、封面和横幅是仓库自有几何占位素材；真实头像、更多平台链接和后续文章可沿现有接口补充。

本验收不执行远端推送或生产发布；这些操作会触发外部状态变化，应在确认集成方式后单独进行。

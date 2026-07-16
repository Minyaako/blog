# Minyako Blog

面向 `gsk.minyako.top` 的 Astro 静态博客；`minyakogsk.icu` 是保留重定向的旧域名。站点以技术与学术写作为首要方向，同时把生活与游戏作为同等稳定的一级领域；视觉小说评测、随想和图集通过可扩展子类组织。

## 环境与启动

- Node.js 24（最低支持 22.12）
- pnpm 11.7.0

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

开发服务器启动后，按终端显示的本地地址访问。生产构建使用：

```powershell
pnpm build
pnpm preview
```

`pnpm build` 会依次执行 Astro 类型检查、Vitest、静态页面构建和 Pagefind 索引生成。

## 写作与分类

文章位于 `src/content/posts/<domain>/`，使用 MDX 和 YAML frontmatter。每篇文章必须提供永久 `id`；文件名生成可读 URL，`id` 则供评论、翻译和未来外部数据关联，移动分类时不应修改。

四个领域及全部子类集中定义在 `src/config/taxonomy.ts`。新增子类时先修改此配置，再创建相应文章；领域页与子类页会自动生成。Schema 位于 `src/schemas/post.ts`，不合法的领域、子类、资源 URL 或内容提示会让构建失败。

> 仓库是公开的。`draft: true` 只会阻止文章进入构建结果，不能保密；草稿正文、访问密钥、未授权素材和隐私信息都不应提交到仓库。

装饰图片暂存于 `public/images/`。文章媒体首版可由服务器提供，但文章只保存可迁移 URL；存储量增长后可迁移到腾讯 COS，而不改变内容模型。

## 检查命令

```powershell
pnpm check             # Astro / TypeScript
pnpm test:unit         # Schema 与纯逻辑
pnpm test:e2e          # 桌面、手机、平板浏览器检查
pnpm test:visual       # 视觉回归
pnpm build             # 完整静态发布门禁
```

浏览器测试会自行构建并启动预览服务器。本机优先使用已安装的 Chrome；CI 安装与 Playwright 匹配的 Chromium。

### 视觉基线

截图覆盖首页、归档、普通文章、敏感文章、搜索、关于和 404，并在明暗主题及三档视口运行。设计变更后先运行：

```powershell
pnpm exec playwright test tests/e2e/visual.spec.ts --update-snapshots
```

逐张检查横幅裁切、图标、文本换行、归档渐变、焦点状态和敏感内容遮挡；确认变化符合预期后再提交 `tests/e2e/visual.spec.ts-snapshots/`。随后不带参数重跑，确保没有像素差异。不要用更新基线来掩盖未知回归。

视觉基线按 `win32` 和 `linux` 分目录保存。Windows 本地检查使用 `win32`；GitHub Actions 使用 `linux`。只有在人工检查全部 42 张结果后，才可通过 PR 专用变量 `REFRESH_VISUAL_BASELINES=true` 生成 Linux artifact；下载并提交后立即恢复为 `false`，再让普通 PR 检查执行像素比较。

## 生产部署

生产发布、验证、回滚和密钥轮换步骤见 [部署手册](docs/deployment.md)。博客仓库只维护应用镜像、Compose、发布程序和 Actions；绑定 80/443 的共享 Caddy 属于独立的 `server-infra` 仓库，本仓库不拥有或直接覆盖其基础配置。

## 动态服务边界

- 评论：正文只暴露稳定的 `data-page-key` 与评论插槽。首版计划通过独立 API 封装 Waline，博客不直接绑定其数据库；免登录昵称头像和 GitHub 快捷登录属于后续接口能力。
- 搜索：Pagefind 在构建时生成本地索引，敏感正文不会进入索引。
- 媒体：URL 与内容解耦，便于从服务器目录迁移到对象存储。
- 发布：当前以 Git 推送触发自动发布。服务器部署配置属于独立远端工作目录，不与博客源码混放。

原创文字默认采用 CC BY 4.0，可在署名后转载。第三方图片、游戏素材、论文图表、商标等不自动适用该许可，必须在文章中单独标注权利与来源。

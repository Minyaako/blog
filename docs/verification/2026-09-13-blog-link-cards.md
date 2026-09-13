# 领域图标与正文链接卡片

## 需求与实现约定

- 四个首页领域使用已有 Lucide 图标集：书本勾选、芯片、咖啡、游戏手柄；沿用领域色与现有布局。
- 正文中单独成段的完整网址或自动链接转换为卡片。段落前后留空行；行内链接、命名链接、代码块、列表和引用不转换。
- 支持 GitHub 仓库根地址、YouTube 视频、Bilibili 视频、知乎专栏文章和回答。其他站点保持普通链接。
- 标题、简介、作者、封面和可获取的统计在构建时生成；浏览器只读取静态 HTML，封面懒加载，不增加播放器或第三方脚本。
- GitHub 显示 stars/forks，视频尝试显示播放/点赞。未知统计省略，实际为零才显示零；统计标注抓取日期，重新构建后更新。
- 平台拒绝访问、超时或限流时优先使用旧缓存，没有缓存时保留平台和目标地址构成的卡片，构建可继续。
- 仅访问指定平台的固定 API/网页地址，禁止跟随重定向。请求限时、限量、限制响应体大小，缓存公开元数据，不保存凭据。

## 写作方式

在 Markdown / MDX 正文中写：

```md
下面是项目：

https://github.com/withastro/astro

这个[行内链接](https://github.com/withastro/astro)保持原样。
```

卡片在博客构建时生成。编辑器中的原始网址仍是内容源，编辑器预览不在本次变更范围。

## 平台数据与配置

- GitHub：公开仓库 REST API，无需登录；接口存在匿名配额。[官方接口](https://docs.github.com/en/rest/repos/repos#get-a-repository)。
- YouTube：公开 oEmbed 提供标题、作者、缩略图。播放量/点赞数需要启用 YouTube Data API 的 API key；通过构建环境变量 `YOUTUBE_DATA_API_KEY` 配置，密钥仅用于构建请求，不写入前端或缓存。[官方入门](https://developers.google.com/youtube/v3/getting-started)、[视频接口](https://developers.google.com/youtube/v3/docs/videos/list)。
- Bilibili：公开视频信息接口尽力获取标题、封面、UP 主、播放和点赞；平台限制时回退，不绕过访问限制。
- 知乎：公开网页元信息尽力获取标题、简介和封面；登录墙或反爬限制时回退。

缓存目录为 `node_modules/.cache/blog-link-cards`，成功结果缓存 24 小时，失败短暂缓存后再试。测试使用独立离线数据，不依赖平台实时数据或 API key。

生产环境可在仓库 Actions secrets 设置 `YOUTUBE_DATA_API_KEY`。工作流通过 BuildKit secret 临时传入构建步骤，不使用 Docker ARG/ENV 留存密钥；未设置时照常构建基础卡片。

## 验收进度

- 已明确自动转换规则、数据字段、失败回退与静态性能要求。
- 实现图标、平台元数据适配、Markdown/MDX 转换和响应式卡片。
- `pnpm check`：0 errors / warnings / hints。
- `pnpm test:unit`：30 个文件、259 项通过（包含 57 项元数据测试、4 项转换测试及密钥构建契约）。
- fixture 模式 `pnpm build:astro` + `pnpm build:search`：50 个页面及 8 页搜索索引构建成功。构建读取已有公开歌词需要沙箱外网络，未改变歌词逻辑。
- Edge 桌面/手机/平板首页、动画、搜索、卡片共 84 项回归，初次 81 项通过；3 项手机溢出检查暴露列表长网址问题，补充正文链接换行后卡片 6/6 复测通过（最终带封面样例亦复测）。
- 实际浏览器检查四个新图标、卡片封面和深浅主题。截图位于本地 `.playwright-cli/domain-icons-light.png`、`link-cards-desktop-light.png`、`link-cards-mobile-dark.png`。
- 独立 agent 审查完成；已修复 GitHub tab/锚点丢失问题，无剩余可行动发现。
- 公开接口探测：Bilibili 返回真实标题、UP 主、封面、播放/点赞；知乎 403 正常降级；本机 Node 到 GitHub/YouTube 网络不可达，生产构建网络的成功率尚未实测。单元测试覆盖这些平台的接口映射与失败处理。
- 工作分支：`codex/blog-icons-link-cards`，本次改动尚未合并或发布。测试卡片标题、封面和统计为离线样例，不写入正式文章。

本次不修改先前的切页上滑动画、主题保持和搜索初始化。

## 卡片外观反馈修订

- Stars / Forks / 播放 / 点赞改用已有 Lucide SVG 图标与数字，保留完整悬停提示及可访问名称。
- 桌面封面与文字左右分栏，封面保持完整比例；手机有封面的卡片改为上方 16:9 封面。GitHub 无封面时显示本地 Simple Icons 标志，不发出占位图片请求。
- GitHub REST 的作者头像不再当作项目封面；旧缓存中的头像也会在读取时过滤，真实 Open Graph 封面仍允许显示。
- 地址与更新时间合并为较轻的页脚，减少重复文字。未添加浏览器端脚本。
- 修订验证：Astro 检查无错误/警告，Astro + Pagefind 构建通过，三种设备的卡片 E2E 6/6 通过，深浅主题截图已刷新；独立审查无阻塞问题。

## 渐变遮罩与真实链接验证

- 封面使用静态 CSS 渐变遮罩，桌面向文字区及上下边缘淡出，手机向下淡出。遮罩直接显示卡片背景，深浅主题及悬停均无需额外颜色同步脚本。
- 图片自身按原始比例缩放并限制最大宽高，遮罩跟随图片边缘。浏览器验证 4:3 图片为 240.75 × 180.5625，2:3 竖图为 120.375 × 180.5625，比例正确且未超出封面区域。
- 2026-09-13 17:53（UTC+8）使用正式 `identifyLink` / `getLinkMetadata`、全新隔离缓存、`offline:false`、空 API key 测试，无登录信息或 Cookie：
  - `https://github.com/Minyaako/blog`：HTTP 200，仓库名、简介、作者及真实 0 stars / 0 forks 正常。
  - `https://github.com/withastro/astro`：HTTP 200，62,507 stars / 3,784 forks（抓取时快照）正常。
  - `https://www.bilibili.com/video/BV1GJ411x7h7/`：HTTP 200，真实标题、UP 主、封面、播放及点赞正常；浏览器远程封面加载成功，原图宽度 1920。
  - `https://zhuanlan.zhihu.com/p/19819851`：HTTP 403，保留可点击回退卡片，不声称已拿到标题简介。
  - 本轮按用户要求跳过 YouTube。
- 本机 Node 默认未使用已有环境代理，GitHub 直连出现 `ECONNREFUSED`；仅对测试进程启用 `NODE_USE_ENV_PROXY=1` 后成功。未修改系统网络/证书设置及生产抓取代码。
- 原始结果：`.playwright-cli/live-link-card-results.json`。真实数据再经正式 rehype 转换器输出本地 `dist/test/link-cards-live/index.html`；不改正式文章及固定测试元数据，不纳入发布内容。重新构建后可运行 `node .playwright-cli/render-live-link-cards.mjs` 重建该预览。
- 最终 Astro + Pagefind 构建成功，三端卡片 E2E 6/6 通过，实际卡片在 390px 视口无横向溢出；真实封面深浅主题截图为 `.playwright-cli/live-bilibili-gradient-light.png` / `live-bilibili-gradient-dark.png`。

## 最终布局与自定义元数据

- 用户最终确认采用归档条目方向：四个平台标志位于最左，文字位于左侧，右侧封面向左淡出。手机保持这个阅读方向，没有封面时仍显示平台标志。
- 新增 `src/lib/link-card-overrides.mjs`，支持 `URL [title="..." description="..." image="..." author="..."]`。四个字段按需覆盖，空 image/description/author 可以隐藏字段；title 不允许为空。
- 从 Markdown/MDX 原始段落位置读取语法，保证引号内的空格、符号与链接不被 Markdown 自动链接/强调处理改变。覆盖值在自动数据之后合并，不修改缓存，不改变导航目标。
- 图片仅接受安全根路径或公共 HTTPS 地址；不在构建端请求自定义图片。未知/重复字段、非法图片与未闭合语法保持原段落。独立审查指出的“错误语法藏进 URL 参数/锚点后被兜底转卡”已在解析器与转换器两层修复，并有回归测试。
- 写作说明：`docs/link-cards.md`。本地实链预览已附加手动补充知乎元数据的示例，明确标注为自定义内容。
- 最终验证：完整 `pnpm build` 通过；Astro 检查 0 错误/警告；31 个单测文件 299 项全部通过；卡片 E2E 桌面/手机/平板 6/6 通过；实际 MDX 自定义图片、标题、简介、作者已在产物及浏览器确认；独立审查两项 P2 均关闭，无剩余阻塞。
- 当前仍为本地功能分支，未合并/发布。

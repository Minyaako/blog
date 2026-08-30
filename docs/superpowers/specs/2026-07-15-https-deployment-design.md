# 博客 HTTPS 与自动部署设计

日期：2026-07-15  
状态：已确认，等待书面复核

## 1. 目的与范围

本设计为 Astro 静态博客建立首版生产部署链路：GitHub Actions 验证并发布不可变容器镜像，腾讯云服务器运行静态站点容器，共用 Caddy 网关提供 HTTPS，并在部署失败时恢复上一版本。

本次同时完成域名职责调整：

- `https://gsk.minyako.top` 是博客的唯一规范地址；
- `https://minyakogsk.icu` 在切换完成后永久跳转到规范地址，并保留路径和查询参数；
- 根域 `minyako.top` 不在本次配置中使用，留给未来的服务器总入口。

本设计只覆盖静态博客。Waline、媒体管理 Web 应用、COS 迁移和根域入口均不在本次实施范围内。

本文细化并取代 `2026-07-12-blog-platform-design.md` 中以 `minyakogsk.icu` 为主域名的部署描述；其余产品与内容设计继续有效。

## 2. 已知基础

- 博客是独立 GitHub 仓库 `Minyaako/blog`，生产分支为 `main`。
- Astro 使用静态输出；构建结果包含 HTML、RSS、Sitemap 和 Pagefind 索引。
- 服务器为 Ubuntu x86_64，Docker Compose 可用。
- 共用 Caddy 网关位于 `/srv/server-stack-prod/caddy`，占用主机 `80` 和 `443` 端口，并连接外部 Docker 网络 `server_proxy`。
- 应用生产目录约定为 `/srv/apps/blog`，运行时机密目录约定为 `/srv/secrets/blog`。
- 两个博客域名均解析到 `124.223.13.233`；Caddy 当前尚未配置对应 HTTPS 站点。

## 3. 选定方案

采用“GitHub Actions + 公共 GHCR 不可变镜像 + Docker Compose + 共用 Caddy”的方案。

与直接把 `dist` 复制到服务器相比，镜像同时封装静态文件和内部 Web 服务器，版本标识明确、回滚简单，服务器也不需要 Node.js 或 pnpm。与在服务器上拉取源码并构建相比，生产主机更小、更可复现，也不会持有 GitHub 仓库凭据。

镜像使用完整提交 SHA 作为唯一发布标签：

```text
ghcr.io/minyaako/blog:<40-character-git-sha>
```

首版不发布可变的 `latest` 标签。部署和回滚只接受完整 SHA，避免同一标签指向不同内容。首版不自动删除历史 SHA 镜像，以免清理策略破坏回滚；镜像保留策略在实际占用需要控制时单独设计。

## 4. 系统边界

### 4.1 博客仓库负责

- Astro 的规范站点地址和所有站内绝对链接；
- GitHub Actions 验证、构建、发布和部署调用；
- 多阶段 Dockerfile、内部静态服务器配置和容器健康检查；
- 博客 Compose 模板、应用级部署脚本及运维说明；
- 针对生产域名、RSS、Sitemap 和关键页面的验证。

### 4.2 `server-infra` 仓库负责

- 共用 Caddy 的导入结构和博客站点路由；
- `server_proxy` 网络和主机端口的共用约定；
- `/srv/apps/blog`、部署账户、受限 SSH 命令和 sudo 规则的主机级安装；
- 远端路径、域名、同步状态和回滚责任的公共索引。

博客应用变更进入当前博客 PR。共用 Caddy 和主机权限变更进入独立的 `server-infra` 变更，不把共用网关配置混入应用 Git 历史。

## 5. 运行时架构

生产镜像由两个阶段组成：

1. 构建阶段使用锁定的 Node.js 和 pnpm 版本执行现有 `pnpm build`；
2. 运行阶段只保留 `dist` 和轻量静态服务器。

运行阶段使用内部 Caddy 静态服务器，监听容器内非特权端口 `8080`。它提供：

- Astro 构建产物；
- SPA 回退以外的标准静态文件行为和项目的 `404.html`；
- 不依赖磁盘写入的 `/healthz`；
- 与预压缩、缓存和安全响应头相容的基础配置。

容器以非 root 用户运行，根文件系统只读；确有运行时写入需求的目录使用临时文件系统。Compose 不映射任何主机端口，只把服务以稳定网络别名 `blog` 加入 `server_proxy`。共用 Caddy 通过 `blog:8080` 访问它，因此公网只能接触网关的 `80/443`。

`/srv/apps/blog` 保存 Compose 文件、当前与上一镜像 SHA、部署日志和回滚状态，不保存源码构建环境。博客没有首版运行时机密；`/srv/secrets/blog` 保留为空目录或后续服务使用，任何 OAuth 或评论服务密钥都不得写入镜像或仓库。

## 6. 域名与 Caddy 行为

### 6.1 规范域名

Astro `site`、canonical、Open Graph URL、RSS 和 Sitemap 都使用：

```text
https://gsk.minyako.top
```

生产页面不得再生成指向 `minyakogsk.icu` 的规范链接。正文中作为历史说明出现的旧域名不强制改写。

### 6.2 最终网关行为

- `gsk.minyako.top`：反向代理到 `blog:8080`；
- `minyakogsk.icu`：返回 `308 Permanent Redirect` 到 `https://gsk.minyako.top{uri}`；
- 重定向保留原始路径和查询参数；
- `minyako.top`：本次不新增任何站点块。

两个域名均由共用 Caddy 自动申请和续期证书。修改配置时必须先执行 Caddy 配置校验，校验通过后才热重载；失败时保留当前有效配置。

### 6.3 首发过渡

首发期间先让新旧两个域名都反向代理博客，以完成证书签发和新域名检查。确认 `gsk.minyako.top` 的页面、静态资源、RSS 和 Sitemap 正常后，再把旧域名切换为 308。该过渡只用于首次上线，不保留双主域长期运行，避免搜索引擎收录重复内容。

在博客容器尚未启动的极短引导窗口，共用 Caddy 可以继续显示现有引导页或明确的维护响应；外部验收必须检查博客专用的 `/healthz` 和页面内容，不能把引导页的 HTTP 200 误判为部署成功。

## 7. CI/CD 流程

### 7.1 触发规则

- Pull Request：只执行验证，不发布镜像，不连接服务器；
- 非 `main` 分支：不部署生产；
- `main` push：验证成功后发布 SHA 镜像；只有部署门禁开启时才自动部署；
- `workflow_dispatch`：允许对当前 `main` 的完整 SHA 重跑发布或首次受控部署，不允许指定任意分支进入生产。

部署环境使用 GitHub Environment `production`，使生产 Secrets、Variables 和部署记录与普通 CI 隔离。

### 7.2 作业依赖

工作流拆成明确的依赖链：

```text
verify -> publish-image -> deploy-production
```

`verify` 沿用现有锁定安装、Astro 检查、单元测试、静态构建、Pagefind 和 Playwright 检查。`publish-image` 只在 `main` 上运行，使用 GitHub 提供的 `GITHUB_TOKEN` 和最小 `packages: write` 权限发布 GHCR 镜像。`deploy-production` 依赖前两项成功，并额外要求仓库变量 `DEPLOY_ENABLED` 等于字符串 `true`。

工作流默认权限设为只读，仅发布镜像的作业获得 `packages: write`。镜像构建不得接收生产 Secrets，日志不得输出私钥或完整环境内容。

### 7.3 GitHub 配置

仓库 Variables：

- `DEPLOY_ENABLED`：首发前为 `false`，完成 GHCR 公共可拉取准备后改为 `true`；
- `DEPLOY_HOST`：`124.223.13.233`；
- `DEPLOY_USER`：专用部署账户名。

`production` Environment Secrets：

- `DEPLOY_SSH_PRIVATE_KEY`：专用部署私钥；
- `DEPLOY_SSH_KNOWN_HOSTS`：预先核验的服务器主机公钥记录。

GHCR 镜像为公共包，因此服务器不保存 GitHub Token、PAT 或容器仓库密码。Action 使用原生 `ssh` 客户端，不引入第三方 SSH Action。

## 8. 受限远程部署权限

GitHub Actions 不使用个人管理员密钥，也不直接获得通用 shell。服务器创建专用部署账户，并在 `authorized_keys` 上限制该密钥：禁用 PTY、端口转发、Agent 转发和 X11，只允许调用根拥有的部署分发器。

允许的远程命令集合保持最小：

```text
deploy <40-character-git-sha>
status
```

分发器严格校验命令和 SHA 后，才通过受限 sudo 规则调用根拥有的博客部署程序。账户不加入 `docker` 组，因为 Docker 组等价于广泛的主机控制权。部署程序只能操作博客 Compose 项目、博客镜像和 `/srv/apps/blog` 内的状态，不允许修改其他应用、共用卷或 Caddy 配置。

Caddy 首次接入和旧域名跳转属于独立的管理员基础设施操作，不授予日常博客部署密钥。

## 9. 部署与回滚算法

部署程序按以下顺序执行：

1. 拒绝非完整 SHA、并发部署和不属于公共 `ghcr.io/minyaako/blog` 的镜像引用；
2. 匿名拉取目标 SHA 镜像；
3. 记录当前 SHA 为可回滚的上一版本，但不覆盖尚未验证的当前记录；
4. 用唯一候选名称启动目标镜像，不绑定主机端口，并等待容器 `/healthz`；
5. 候选健康后，更新博客 Compose 的镜像 SHA，并替换稳定服务 `blog`；
6. 等待稳定服务健康，再检查 `https://gsk.minyako.top/healthz` 和关键公开路由；
7. 检查通过后原子写入当前/上一 SHA 和成功记录，清理候选容器；
8. 任一检查失败时恢复先前 SHA、重新启动并检查上一版本，然后以非零状态结束；
9. 首次部署尚无上一版本时，失败只清理候选和失败容器，不破坏原有 Caddy 引导页。

候选容器只证明镜像自身可以启动；外部 HTTPS 检查证明稳定网络别名、共用 Caddy、证书和实际页面链路均正常。首版接受替换稳定容器时的短暂连接重试，不承诺零停机蓝绿切换。

部署程序持有独占锁，避免两个 `main` push 同时覆盖状态。GitHub Actions 同时使用 production concurrency group；新发布可以排队，但不能取消已经进入远程切换阶段的部署。

## 10. 首次上线顺序

首次上线必须按以下顺序执行：

1. 合并博客 PR 到 `main`，但保持 `DEPLOY_ENABLED=false`；
2. Actions 完成验证并发布 `ghcr.io/minyaako/blog:<main-sha>`，不访问服务器；
3. 在 GitHub Package 设置中把新建 GHCR 包改为 Public，并从服务器验证匿名拉取；
4. 通过独立 `server-infra` 变更安装 `/srv/apps/blog`、Compose、受限部署账户和共用 Caddy 的临时双域名代理配置；
5. 把 `DEPLOY_ENABLED` 改为 `true`，对当前 `main` 手动运行 workflow dispatch；
6. 验证两个域名的 TLS、新域名关键路由和资源；
7. 把旧域名的临时代理改为 308 跳转，校验并热重载 Caddy；
8. 验证带路径和查询参数的跳转后，记录首发 SHA 和回滚演练结果。

之后每次 `main` push 都自动执行验证、发布和部署，不再需要更改 Caddy 或手动调整 GHCR 可见性。

## 11. 验证与验收

### 11.1 构建验证

- `pnpm build` 成功，包括 Astro 检查、单元测试、静态构建和 Pagefind；
- `pnpm test:e2e` 在生产预览模式运行并通过；
- 容器镜像能在本地以只读、非 root、无主机端口的方式通过 `/healthz`；
- 镜像中不包含源码仓库、Git 凭据、SSH 私钥或生产 Secrets。

### 11.2 生产验收

- `https://gsk.minyako.top/`、`/about`、`/archives`、`/rss.xml` 和 `/sitemap-index.xml` 返回预期内容；
- 页面 canonical、RSS 和 Sitemap 均使用 `https://gsk.minyako.top`；
- `https://minyakogsk.icu/archives?domain=academic` 返回 308，`Location` 精确保留路径和查询参数；
- 两个域名的证书有效且可自动续期；
- 主机没有新增博客公网端口，博客只存在于 `server_proxy`；
- 服务器在无 GHCR 凭据的情况下可拉取指定 SHA 镜像；
- 日志能区分构建、镜像发布、远程部署、健康检查和回滚失败；
- 用上一已知良好 SHA 完成一次受控回滚，再恢复当前 SHA。

### 11.3 失败条件

以下任一情况都阻止或回滚发布：

- CI 验证、镜像构建或 GHCR 推送失败；
- SHA 格式、镜像来源或 SSH 主机公钥不匹配；
- 匿名拉取失败；
- 候选或稳定容器健康检查超时；
- 新域名 TLS、关键路由、RSS 或 Sitemap 检查失败；
- 回滚后的上一版本仍不健康。

最后一种情况必须保留诊断信息并停止自动尝试，由管理员处理；部署程序不得继续循环重启或改动其他服务。

## 12. 运维与后续演进

应用日志通过 Docker 日志读取，网关访问和证书问题通过共用 Caddy 日志定位。运维说明应记录当前 SHA、上一 SHA、最近一次部署时间、手动状态查询、受控回滚和密钥轮换步骤。

未来如需零停机部署，可以在不改变 GitHub 发布接口的前提下，把稳定服务替换过程升级为双槽位和 Caddy 上游切换。未来即使根域 `minyako.top` 成为服务器入口，博客的规范地址仍保持 `gsk.minyako.top`，无需再次迁移文章永久链接。

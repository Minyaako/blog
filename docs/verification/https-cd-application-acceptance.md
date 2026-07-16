# HTTPS/CD 应用侧验收记录

验收时间：2026-07-16 07:07:33 +08:00（Asia/Shanghai / China Standard Time）

受测源码提交：`b29df9b88f9eb60bea94ecb0c5d43ae853c858f4`

分支：`codex/static-blog-core`

## 结论与边界

应用仓库的静态构建、浏览器回归、Linux 发布脚本和非特权容器运行契约均已通过本地验收。这里记录的是应用侧发布门禁，不代表生产部署已经完成，也不授权合并或启用自动部署。

- Draft PR：<https://github.com/Minyaako/blog/pull/1>
- 稳定 Checks 页面：<https://github.com/Minyaako/blog/pull/1/checks>
- 本记录提交后的最终 CI run ID 由控制端推送分支后补充；当前没有用本地结果代替远端 required checks。
- 合并与部署继续受阻，直到 `server-infra` bootstrap 资产完成审查。

## 验收平台

| 环境 | 版本 |
| --- | --- |
| 本地 | Microsoft Windows 11 专业版；Node.js `v24.11.0`；pnpm `11.7.0` |
| Linux 验收主机 | Ubuntu 24.04；Linux `6.8.0-124-generic` x86_64；Docker Server `29.6.1` |
| ShellCheck | `koalaman/shellcheck:v0.10.0`，镜像 digest `sha256:2097951f02e735b613f4a34de20c40f937a6c8f18ecb170612c88c34517221fb` |

Linux 检查全部从受测提交的干净 `git archive` 解包到唯一临时目录执行，没有复制本地未提交文件。

## 本地发布门禁

执行 E2E 前，先核验 `127.0.0.1:4321` 的监听进程命令行确实属于本 worktree 的 Astro dev server，再停止该进程；Playwright 因此没有复用现有 4321 服务，而是自行启动 production preview。

| 命令 | 观察结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过；锁文件无变化，pnpm `11.7.0` |
| `pnpm build` | 通过；Astro 57 个文件为 0 errors / 0 warnings / 0 hints；Vitest 7 个文件、45/45；生成 36 页；Pagefind 完成并索引 3 页 |
| `pnpm test:e2e` | 通过；desktop、mobile、tablet 共 93/93，耗时 48.6 秒 |
| `git diff --check` | 通过；无空白错误 |

验收后已用隐藏后台进程恢复 Astro dev server，并确认 `http://127.0.0.1:4321/` 返回 HTTP 200。

## Linux 发布脚本门禁

| 命令 | 观察结果 |
| --- | --- |
| `bash -n deploy/bin/blog-release tests/deploy/blog-release.test.sh` | 通过 |
| `shellcheck deploy/bin/blog-release tests/deploy/blog-release.test.sh` | pinned v0.10.0，退出码 0，0 diagnostics |
| `pnpm test:deploy` | 在临时 `node:24.18.0-bookworm-slim` 环境使用 pnpm `11.7.0` 执行，39/39 场景通过 |

39 项发布脚本场景覆盖完整 SHA 校验、六个公共端点、候选容器健康、失败回滚、状态文件提交、信号处理、锁争用和清理失败等路径。

## 容器构建与运行验收

干净归档构建标签：

`minyako-blog:acceptance-minyako-blog-final-acceptance-20260715230345-b29df9b88f9e`

使用唯一容器名运行，并明确传入：

```text
--read-only
--tmpfs /data:size=1m,mode=0700,uid=1000,gid=1000
--tmpfs /config:size=1m,mode=0700,uid=1000,gid=1000
-p 127.0.0.1:18080:8080
```

观察结果：

- `docker build` 通过；镜像内 `pnpm build` 为 45/45 单元测试、36 个静态页面且 Pagefind 完成。
- `http://127.0.0.1:18080/healthz` 响应体严格等于 `ok`。
- `.Config.User` 严格等于 `caddy`。
- Docker health 为 `healthy`。
- `.HostConfig.ReadonlyRootfs` 为 `true`。
- 端口只绑定 `127.0.0.1:18080`，未暴露到全部网卡。
- `/data` 和 `/config` 均为带预期 size、mode、uid、gid 的 tmpfs。
- finally 清理后，唯一容器、验收镜像标签、远端归档和临时目录均不存在；未执行共享 Docker prune。

## 发布闸门与生产现状（只读核实）

验收执行时的外部状态检查时间：2026-07-16 07:07 +08:00。

Secrets 库存再次只读复核时间：2026-07-16 07:15:28 +08:00。

- 仓库变量 `DEPLOY_ENABLED=false`，部署 job 仍关闭。
- GitHub Actions 仓库 Secrets 总数为 0，`DEPLOY_*` 数量为 0；Dependabot Secrets 总数也为 0。未读取任何 Secret 值。
- GitHub Environments 列表总数为 0，`production` environment 不存在，因此没有配置 environment-scoped production Secrets。
- GitHub Packages 用户级 API 对 `Minyaako/blog` 返回 `404 Package not found`；本时间点没有可设为 Public 的 GHCR package，也没有执行公开操作。
- 服务器 `/srv/apps/blog` 不存在；Compose project/service 为 `blog` 的容器数为 0；使用 `ghcr.io/minyaako/blog:*` 的容器数为 0。
- 共享 `server-caddy` 容器存在。对其当前 `/etc/caddy` 的只读定向扫描未发现 `gsk.minyako.top` 或 `minyakogsk.icu` 引用；这只是验收时间点观察，不代替 `server-infra` 配置审查。
- 本任务、本阶段没有修改 Caddy、域名路由、DNS 或任何生产文件。

## 明确未执行事项

- 没有 push、merge 或发布 `main`。
- 没有将 GHCR package 设为 Public；只读 API 当前返回 package not found。
- 没有配置 production environment 或生产部署 Secrets。
- 没有创建或启动 `/srv/apps/blog` 服务。
- 没有修改共享 Caddy 或任何域名路由。
- 没有把 PAT、私钥、Secret 值、host key 内容或 live `.env` 写入仓库、日志或本文档。

后续必须先审查并实施 `server-infra` bootstrap，再由控制端确认远端 PR checks 通过、GHCR 首个 SHA 镜像可匿名拉取以及受限 SSH 边界正确，才能讨论打开 `DEPLOY_ENABLED`。

# 生产部署

本文档是博客应用的生产发布与故障处置手册。首次上线仍须与 `server-infra` 仓库的主机初始化和共享网关计划配合执行。

## 固定边界

| 项目 | 固定值 |
| --- | --- |
| Canonical origin | `https://gsk.minyako.top` |
| 旧域名 | `https://minyakogsk.icu`，最终保留路径和查询参数并返回 308 |
| 不可变镜像 | `ghcr.io/minyaako/blog:$sha`，其中 `$sha` 必须是已部署提交的 40 位小写完整 SHA |
| 应用运行目录 | `/srv/apps/blog` |
| 内部服务 | `blog:8080`，只加入外部 Docker 网络 `server_proxy`，不映射主机端口 |
| 共享网关 | `server-caddy`，由 `server-infra` 仓库和服务器管理员维护 |

本仓库负责 Docker 镜像、`deploy/compose.yml`、`deploy/bin/blog-release` 和 GitHub Actions。它不拥有共享 Caddy 基础配置、主机账号、SSH forced-command 或 80/443 端口；这些属于 `server-infra`。根域名 `minyako.top` 不在本次博客部署范围内。

生产服务器不安装 Node.js 或 pnpm。服务器只匿名拉取公开的 SHA 镜像，不能保存 GitHub PAT、GHCR 密码或其他注册表凭据。博客容器是只读静态站，`/config` 与 `/data` 均为临时文件系统。

## 首次发布

首次发布必须严格按以下顺序执行。所有命令均在仓库 `Minyaako/blog` 上操作；秘密只从本地临时文件重定向，不应粘贴到终端参数、Issue、日志或本文档。

1. 保持发布闸门关闭：

   ```powershell
   gh variable set DEPLOY_ENABLED --repo Minyaako/blog --body false
   gh variable get DEPLOY_ENABLED --repo Minyaako/blog
   ```

   最后一条必须输出 `false`。此时合并到 `main` 可以验证并发布镜像，但不会连接生产服务器。

2. 确认 PR 检查通过后合并。等待 `main` 的 `verify` 与 `publish-image` 成功，并取得完整提交 SHA：

   ```powershell
   $mainSha = gh api repos/Minyaako/blog/commits/main --jq .sha
   if ($mainSha -cnotmatch '^[0-9a-f]{40}$') { throw 'main SHA 不是 40 位小写十六进制' }
   $image = "ghcr.io/minyaako/blog:$mainSha"
   $image
   ```

3. 首次创建的 GHCR Package 默认可能不是公开包。由仓库所有者在 GitHub Package 设置中把 `ghcr.io/minyaako/blog` 手动改为 **Public**。不得用服务器 PAT 绕过这一步。

4. 通过已信任的管理员别名证明服务器能够匿名拉取该 SHA 镜像：

   ```powershell
   ssh tencent-server "sudo docker logout ghcr.io >/dev/null 2>&1 || true"
   ssh tencent-server "sudo docker pull $image"
   ssh tencent-server "sudo docker image inspect $image --format '{{index .RepoDigests 0}}'"
   ```

   拉取必须在无 GHCR 凭据的情况下成功，并返回内容摘要。

5. 按 `server-infra` 的博客部署计划完成 `/srv/apps/blog`、`blog-deploy` forced-command、`server_proxy` 和临时双域名 Caddy 路由初始化。共享 Caddy 的候选配置须先验证并备份，不能从本仓库直接覆盖。

6. 创建或确认 GitHub Environment `production`，设置非秘密仓库变量：

   ```powershell
   gh variable set DEPLOY_HOST --repo Minyaako/blog --body 124.223.13.233
   gh variable set DEPLOY_USER --repo Minyaako/blog --body blog-deploy
   ```

   在现有可信管理员会话中核对服务器 Ed25519 host key 指纹后，把专用部署私钥和已核验的 `known_hosts` 文件写入 Environment Secrets：

   ```bash
   gh secret set DEPLOY_SSH_PRIVATE_KEY --repo Minyaako/blog --env production < "/path/to/id_ed25519"
   gh secret set DEPLOY_SSH_KNOWN_HOSTS --repo Minyaako/blog --env production < "/path/to/verified_known_hosts"
   ```

   两个路径都是本地临时文件占位符。不得打印文件内容；部署私钥不能提交到任一仓库。

7. 只有匿名拉取、主机边界、生产 Secrets 和临时网关都验证通过后，才打开闸门并手动调度当前 `main`：

   ```powershell
   gh variable set DEPLOY_ENABLED --repo Minyaako/blog --body true
   if ($LASTEXITCODE -ne 0) { throw '无法启用部署闸门' }
   $mainSha = gh api repos/Minyaako/blog/commits/main --jq .sha
   if ($LASTEXITCODE -ne 0 -or $mainSha -cnotmatch '^[0-9a-f]{40}$') { throw '无法取得当前 main 完整 SHA' }

   $beforeJson = gh run list --repo Minyaako/blog --workflow ci.yml --branch main --event workflow_dispatch --limit 100 --json databaseId
   if ($LASTEXITCODE -ne 0) { throw '无法读取调度前的 workflow run 列表' }
   $beforeRuns = $beforeJson | ConvertFrom-Json
   $beforeIds = @($beforeRuns | ForEach-Object { $_.databaseId })
   $dispatchStartedAt = [DateTimeOffset]::UtcNow
   gh workflow run ci.yml --repo Minyaako/blog --ref main
   if ($LASTEXITCODE -ne 0) { throw 'workflow dispatch 失败' }

   $runId = $null
   for ($attempt = 0; $attempt -lt 30 -and -not $runId; $attempt++) {
     Start-Sleep -Seconds 2
     $runsJson = gh run list --repo Minyaako/blog --workflow ci.yml --branch main --event workflow_dispatch --limit 100 --json databaseId,headSha,event,createdAt
     if ($LASTEXITCODE -ne 0) { throw '无法轮询新 workflow run' }
     $runs = $runsJson | ConvertFrom-Json
     $candidates = @($runs | Where-Object {
       $_.event -eq 'workflow_dispatch' -and
       $_.headSha -eq $mainSha -and
       $_.databaseId -notin $beforeIds -and
       [DateTimeOffset]::Parse($_.createdAt) -ge $dispatchStartedAt.AddSeconds(-5)
     })
     if ($candidates.Count -gt 1) { throw '发现多个候选 run，拒绝误选；请在 GitHub Actions 页面人工确认' }
     if ($candidates.Count -eq 1) { $runId = [string]$candidates[0].databaseId }
   }
   if (-not $runId) { throw '60 秒内未找到刚调度的 workflow run' }
   gh run watch $runId --repo Minyaako/blog --exit-status
   if ($LASTEXITCODE -ne 0) { throw "workflow run $runId 失败" }
   ```

   预期顺序是 `verify -> publish-image -> deploy-production`，远端状态的 `current` 等于 `$mainSha`。

## 受限 SSH 与状态检查

Actions 专用账号只允许以下两种 forced-command：

```text
status
deploy 40位小写完整SHA
```

它不能获得通用 shell、PTY、端口转发或 Docker 组权限。不要尝试用 Actions 私钥执行裸 `ssh`、`ssh -t`、日志命令或任意远程命令；管理员也不应取回或复用该私钥。

受限状态检查是：

```powershell
ssh -o BatchMode=yes blog-deploy@124.223.13.233 status
```

正常输出只包含 `current=<sha|none>` 和 `previous=<sha|none>`。自动化部署使用同一边界发送 `deploy $sha`，没有任意命令入口。

## 发布后检查

每次部署或回滚后都执行以下检查：

```powershell
$origin = 'https://gsk.minyako.top'
curl.exe -fsS -o NUL "$origin/"
if ($LASTEXITCODE -ne 0) { throw '首页检查失败' }
curl.exe -fsS -o NUL "$origin/about"
if ($LASTEXITCODE -ne 0) { throw 'About 检查失败' }
curl.exe -fsS -o NUL "$origin/archives"
if ($LASTEXITCODE -ne 0) { throw '归档页检查失败' }

$rss = curl.exe -fsS "$origin/rss.xml"
if ($LASTEXITCODE -ne 0) { throw 'RSS 获取失败' }
if (-not ($rss | Select-String -SimpleMatch $origin -Quiet)) { throw 'RSS 缺少 canonical origin' }

$sitemap = curl.exe -fsS "$origin/sitemap-index.xml"
if ($LASTEXITCODE -ne 0) { throw 'Sitemap 获取失败' }
if (-not ($sitemap | Select-String -SimpleMatch $origin -Quiet)) { throw 'Sitemap 缺少 canonical origin' }

$health = curl.exe -fsS "$origin/healthz"
if ($LASTEXITCODE -ne 0) { throw 'healthz 获取失败' }
$healthText = ($health -join "`n").Trim()
if ($healthText -cne 'ok') { throw "healthz 返回异常：$healthText" }
```

最终网关切换后，再验证旧域名的路径和查询参数都被保留：

```powershell
$headers = curl.exe -sS -o NUL -D - "https://minyakogsk.icu/archives?domain=academic"
if ($LASTEXITCODE -ne 0) { throw '旧域名请求失败' }
$headers
$headerText = $headers -join "`n"
if (-not ($headerText -match '(?im)^HTTP/2(?:\.0)?[ \t]+308(?:[ \t]+[^\r\n]*)?\r?$')) {
  throw '旧域名未返回精确的 HTTP/2 308 状态'
}
if (-not ($headerText -match '(?im)^Location:[ \t]*https://gsk\.minyako\.top/archives\?domain=academic[ \t]*\r?$')) {
  throw '旧域名 Location 未保留路径与查询参数'
}
```

预期响应包含：

```text
HTTP/2 308
Location: https://gsk.minyako.top/archives?domain=academic
```

此检查不为根域名 `minyako.top` 建立或暗示任何路由。

## 管理员状态与日志

以下命令只能通过已经信任的 `tencent-server` 管理员会话执行：

```powershell
ssh tencent-server "sudo /usr/local/sbin/blog-release status"
ssh tencent-server "sudo docker compose -f /srv/apps/blog/compose.yml logs --tail 200 blog"
ssh tencent-server "sudo docker logs --tail 200 server-caddy"
ssh tencent-server "sudo sh -c 'if test -f /srv/apps/blog/state/last-failure; then cat /srv/apps/blog/state/last-failure; else echo none; fi'"
```

`last-failure` 仅记录失败目标 SHA 和 UTC 时间。它不存在时表示当前无失败记录：可能尚未部署，也可能最近一次成功部署已经清除记录。

## 回滚与恢复

`blog-release` 会先启动独立候选容器，确认容器健康后替换 Compose 服务，再从公网验证 `/healthz`、首页、About、归档、RSS 和 Sitemap。任何切换或公网检查失败都会记录 `last-failure`，并自动恢复部署前的 `current` 与 `previous` 状态；若这是首次发布，则停止失败服务。

自动回滚后，管理员应检查 `status`、`last-failure`、博客日志与网关日志，再重复全部发布后检查。不要修改状态文件、重打镜像标签或用 `latest` 模拟恢复。

人工回滚只用于管理员批准的已知良好 `main` SHA，并且只能通过已信任的 `tencent-server` 管理员会话调用发布程序：

```powershell
$rollbackSha = Read-Host '输入已批准的已知良好 main 完整 SHA'
if ($rollbackSha -cnotmatch '^[0-9a-f]{40}$') { throw '回滚 SHA 必须是 40 位小写十六进制' }
ssh tencent-server "sudo /usr/local/sbin/blog-release deploy $rollbackSha"
```

执行“发布后检查”确认回滚版本正常。需要恢复较新版本时，重新验证并部署它的完整 SHA：

```powershell
$restoreSha = Read-Host '输入已批准的较新 main 完整 SHA'
if ($restoreSha -cnotmatch '^[0-9a-f]{40}$') { throw '恢复 SHA 必须是 40 位小写十六进制' }
ssh tencent-server "sudo /usr/local/sbin/blog-release deploy $restoreSha"
```

恢复后再次执行全部检查并确认 `current`、`previous`。绝不能从 GitHub Actions 取回私钥、复用 Actions 私钥登录，或为 Actions key 文档化通用 shell/PTY 路径。

## 紧急关闭自动部署

发现供应链、密钥或生产故障时，立即关闭后续自动部署：

```powershell
gh variable set DEPLOY_ENABLED --repo Minyaako/blog --body false
gh variable get DEPLOY_ENABLED --repo Minyaako/blog
```

预期输出 `false`。这不会停止当前健康容器，也不能中断已经进入远端事务的发布；正在运行的发布应由 `blog-release` 完成或自动回滚。随后按上节通过管理员路径处置。

## 密钥轮换

### 部署 key

1. 先把 `DEPLOY_ENABLED` 设为 `false`。
2. 在仓库外的临时目录生成新的专用 Ed25519 key；不要打印私钥：

   ```powershell
   $keyDir = Join-Path $env:TEMP 'minyako-blog-deploy-key-rotation'
   New-Item -ItemType Directory -Force $keyDir | Out-Null
   ssh-keygen -t ed25519 -N '' -C 'github-actions:minyaako-blog' -f (Join-Path $keyDir 'id_ed25519')
   ```

3. 通过已信任的 `tencent-server` 管理员会话，使用经过评审的 `server-infra` 安装流程替换 `blog-deploy` 的公钥；不得把账号加入 Docker 组或放宽 forced-command。
4. 用新私钥验证 `status` 成功，并验证任意其他命令仍以退出码 64 被拒绝。不要输出私钥内容。
5. 从临时文件重定向更新 `production` Environment Secret：

   ```bash
   gh secret set DEPLOY_SSH_PRIVATE_KEY --repo Minyaako/blog --env production < "/path/to/new_id_ed25519"
   ```

6. 恢复 `DEPLOY_ENABLED=true`，手动调度 `main` 并确认受限 SSH 部署成功。成功后立即删除临时私钥；旧公钥和旧 Secret 应失效。若验证失败，保持闸门关闭并由管理员恢复上一把公钥。

### SSH host known_hosts

host key 轮换时，必须先通过既有可信 `tencent-server` 管理员会话取得服务器 Ed25519 公钥指纹，再与新扫描文件的指纹逐字比较：

```powershell
ssh tencent-server "sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub"
ssh-keyscan -t ed25519 124.223.13.233 2>$null | Set-Content -Encoding ascii "$env:TEMP\minyako-blog-known_hosts"
ssh-keygen -lf "$env:TEMP\minyako-blog-known_hosts"
```

两处指纹不一致就中止，不得更新 Secret。确认一致后，只从已核验文件重定向更新 Environment Secret：

```bash
gh secret set DEPLOY_SSH_KNOWN_HOSTS --repo Minyaako/blog --env production < "/path/to/verified_known_hosts"
```

不要在文档、Issue 或日志中展示 `known_hosts` Secret 值。更新后手动调度一次 `main` 验证连接；失败时关闭 `DEPLOY_ENABLED` 并保留现有健康版本。

## 备份与数据边界

博客当前是无持久业务数据的静态站。源码与文章由 Git 保留，发布物由不可变 SHA 镜像保留；共享 Caddy 配置由 `server-infra` 管理并在变更前做带时间戳备份。`/srv/apps/blog/state` 只有 `current`、`previous`、锁和最近失败信息，是发布控制状态，不是业务数据。

因此当前不备份容器的 `/config`、`/data` 临时文件系统，也没有博客数据库卷。将来的 Waline、媒体管理器、服务器文章图片或对象存储各自拥有独立的数据保留与备份策略，不应被误认为由本静态站镜像或回滚程序保护。

# 排行榜运行与维护

容器采用固定 Node 24 镜像、UID/GID 1000、8080 内网端口和只读根文件系统。只运行一个实例；SQLite 必须位于本机持久磁盘。普通启动先检查库，不会自动建库或迁移。

## 首次准备

可信管理员创建 `/var/lib/blog-ranking`，属主 `1000:1000`、权限 `0700`，并准备 `/srv/apps/blog/ranking.env`（属主为维护账号、权限 `0600`）。配置不进 Git、不进镜像：

```dotenv
RANKING_ORIGIN=https://gsk.minyako.top
RANKING_WRITE_ENABLED=false
RANKING_ADMIN_IDS=
RANKING_WALINE_URL=https://comments.minyako.top
```

身份复用现有 Waline；`RANKING_WALINE_URL` 默认就是上述评论服务，不需要共享 JWT 密钥或 OAuth secret。配置只允许可信服务（生产 HTTPS，不带用户名、查询串、片段）；不要改为用户提交的地址。榜单会携带 `RANKING_ORIGIN` 请求其 `/api/token`，Waline 的 `SECURE_DOMAINS` 必须允许该站点 Origin。已有评论登录可复用；新增第三方平台仍在 Waline 认证服务单独配置，本次不新增 QQ 等平台。

上线前用真实账号验证登录弹窗、已登录评论复用、私有读取/投稿和退出。用户正常登录后，用下面的 `users` 命令查找站内 UUID，再加入管理员列表；不按昵称/邮箱授予权限，也不自动继承 Waline 管理员角色。身份按 Waline 实例 URL + objectId 固定，改变该 URL 视为不同身份来源，不能直接替换后假定账号自动合并。

本站及上游凭据在 HttpOnly、SameSite 的主机 Cookie 内，本地会话最长 7 天；每次私有访问都重新验证 Waline，无效/封禁即拒绝，5 秒超时或异常则暂时不可用且保留草稿。无需修改投稿数据库 schema，数据库不存上游 token。Waline 当前退出接口不撤销全设备 JWT；本次只同步当前浏览器评论/榜单退出，并撤销本站会话，不声称全设备登出。代理/应用日志禁止记录 Cookie、Authorization 或登录请求正文。

```sh
export BLOG_IMAGE=ccr.ccs.tencentyun.com/minyako-blog/blog:完整40位提交SHA
export RANKING_DATA_DIR=/var/lib/blog-ranking
export RANKING_ENV_FILE=/srv/apps/blog/ranking.env
docker compose -f /srv/apps/blog/compose.yml run --rm --no-deps --entrypoint node blog --experimental-transform-types scripts/ranking-db.ts init
docker compose -f /srv/apps/blog/compose.yml run --rm --no-deps --entrypoint node blog --experimental-transform-types scripts/ranking-db.ts users
```

`init` 只接受不存在的库；路径已存在时拒绝。完成认证、管理员和恢复演练后才将停写开关改为 `true` 并重建容器。Compose 要求显式数据目录和配置文件，且不自动创建宿主数据目录。

上线前确认 Node 实际看到的 Caddy 容器 socket 地址（可能是 IPv6 映射形式），将这些精确 IP 以逗号分隔填入 `RANKING_TRUSTED_PROXY_IPS`；容器重建后地址变化也要重新核对。网关必须用可信客户端地址覆盖 `X-Real-IP`，不得透传访客伪造值，并实际验证伪造请求头不能绕过限额。未配置可信代理时，应用按 socket 地址限流，所有经同一代理进入的访客会共享限额。

CDN 和反向代理必须排除 `/ranking/*`、`/api/ranking/*` 缓存（同时覆盖不带尾斜杠的入口及跳转），尊重响应中的 `no-store`。上线验收需通过实际公网链路执行审核发布与下架，确认再次请求不返回旧版本正文或已下架正文，不能仅检查本机响应头。

## 备份、迁移、回滚

自动备份使用本目录的 `ranking-backup`，复用当前发布 SHA 对应镜像中的 SQLite 一致性备份与完整性检查。脚本只读挂载真实数据，不加载 `ranking.env`；仅将隔离副本转换为独立的 DELETE journal 主文件，避免恢复依赖遗留 WAL 文件。每份归档包含 `database.sqlite`、`SHA256SUMS`、`image.txt`；不压缩、不覆盖既有归档。每日保留最近 14 份，每个 ISO 周第一次成功运行保留一份，保留最近 8 份周备份；清理只针对备份根下这些归档，不删除数据库。

首次由 root 安装（本地脚本不会替你执行生产操作）：

```sh
install -d -o root -g root -m 0700 /srv/backups/blog-ranking
install -o root -g root -m 0755 deploy/ranking/ranking-backup /usr/local/sbin/ranking-backup
install -o root -g root -m 0644 deploy/ranking/blog-ranking-backup.service deploy/ranking/blog-ranking-backup.timer /etc/systemd/system/
/usr/local/sbin/ranking-backup backup
# 将上一步输出的归档目录传入 verify；通过后再启用定时任务。
/usr/local/sbin/ranking-backup verify /srv/backups/blog-ranking/daily/实际归档目录名
systemctl daemon-reload
systemctl enable --now blog-ranking-backup.timer
```

定时任务每日 03:40（服务器时区）运行，并随机延迟不超过 15 分钟。默认从 `/srv/apps/blog/state/current` 读取已发布 SHA；首次正式发布前手工备份可设置 `RANKING_BACKUP_IMAGE=完整不可变镜像引用`。其他路径可写入 root 拥有、`0600` 的 `/etc/blog-ranking-backup.env`：`RANKING_DATA_DIR`、`RANKING_BACKUP_ROOT`、`RANKING_STATE_FILE`；不填认证凭据。数据目录须 `1000:1000/0700`、数据库 `1000:1000/0600`，备份根须 `root:root/0700`。残留 `.lock` 表示中断，先确认没有备份进程再手动处理，不自动抢锁。

现有异机备份任务应追加整个 `/srv/backups/blog-ranking/`，保留权限和每份归档的三个文件，并复制归档记录的不可变镜像或确保异机可拉取它。异机/本地隔离演练均在另一个 root 拥有的 `0700` 目录内复制一份完整归档至 `daily/原归档名`，设置 `RANKING_BACKUP_ROOT` 后运行 `verify`。该命令校验摘要，再在临时目录复制数据库并独立检查 schema、完整性和外键；不会挂载真实库，也不会恢复服务。通过并不替代公开榜单、审核状态和下架记录的人工恢复验收。

1. 将 `RANKING_WRITE_ENABLED=false` 并重建当前服务，确认写入口停用。重大迁移前停止应用容器，避免正在进行的写事务。
2. 使用当前镜像执行 `ranking-db.ts backup /var/lib/blog-ranking/backup-唯一时间.sqlite`；采用 SQLite 一致性备份并检查完整性，拒绝覆盖文件。保留每日备份 14 份、每周备份 8 份；复制到异机受限位置，上线前完成异机隔离恢复演练。
3. 使用新镜像显式执行一次 `ranking-db.ts migrate`，然后执行 `check`。迁移命令要求停写配置，但操作人员仍须确认运行实例确实已停写。
4. 执行既有 `blog-release deploy SHA`。发布只检查生产 schema 兼容性；候选运行在独立临时库中，不挂生产数据、不加载生产凭据。候选与切换后的数据库就绪检查都通过才记录发布成功。
5. 确认读写验收后开启写入。程序自动回滚仅切换镜像，不回滚或删除数据库。迁移前必须验证旧镜像兼容新 schema；不兼容的迁移应保持维护状态，由管理员恢复经过验证的备份后再切换旧镜像。

恢复旧备份会丢失备份之后的投稿和审核结果，必须先保存故障库以便核对。恢复时在维护状态清空 `sessions` 表，使全部旧会话失效；逐项核对备份之后的下架记录，避免已下架内容重新公开，确认完成后才恢复访问和写入。

`/healthz` 检查应用存活，`/api/ranking/ready` 检查数据库可用性；Waline 故障不代表数据库损坏，也不影响公开榜单。发布脚本、Docker 和 Compose 均不公开宿主端口。不要用复制正在写入的 `.sqlite` 主文件代替备份，也不要删除 WAL 文件或以空库覆盖生产库。

首次从旧静态 Caddy 镜像切换应安排维护窗口：旧镜像没有数据库就绪接口，自动回滚虽可恢复镜像，仍会报告完整就绪验收失败，需管理员确认旧站静态页面。`deploy/site.Caddyfile` 仅为旧镜像配置，Node 镜像不再使用它。

本地 `pnpm preview` 使用与容器相同的 HTTP 包装；用 `HOST` / `PORT` 设置监听地址（默认 `0.0.0.0:8080`）。E2E 使用显式 `seed --test-only`、专用 `.ranking-data/test-e2e.sqlite` 和同目录受限 fixture 文件；这些测试凭据不会进入 Git 或镜像。

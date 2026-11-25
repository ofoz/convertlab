# 部署指南

本文件描述在单台 Linux 主机上用 Docker Compose 部署 ConvertLab 的完整步骤，包括 HTTPS 反向代理、外部数据库和常见变体。

## 1. 前置条件

| 项目 | 要求 |
| --- | --- |
| 操作系统 | 主流 Linux（Debian/Ubuntu、Rocky/Alma、Fedora 均可） |
| Docker | 24 或更高，含 Compose v2 插件 |
| 内存 | 4 GB 起步，8 GB 更稳（LibreOffice + FFmpeg 同时运行很吃内存） |
| 磁盘 | 建议 20 GB 以上；转换临时文件会短时间占用空间 |
| 网络 | 能拉取 Docker Hub 镜像（`node:24-trixie-slim`、`postgres:16-alpine`、`redis:7-alpine`） |

镜像内已包含 LibreOffice、FFmpeg、Poppler、Ghostscript、Noto CJK 字体和 libheif，无需在宿主机安装这些工具。

## 2. 准备配置文件

```bash
git clone <仓库地址> convertlab      # 或直接拷贝项目目录
cd convertlab
cp .env.example .env
```

必须修改的三项：

```bash
openssl rand -hex 32      # 复制输出作为 COOKIE_SECRET
```

```env
COOKIE_SECRET=<32 字节随机十六进制>
ADMIN_PASSWORD=<至少 8 位、包含字母和数字的强密码>
POSTGRES_PASSWORD=<另一条随机字符串>
```

说明：

- `ADMIN_PASSWORD` 只在数据库为空时用于创建第一个管理员。创建后修改 `.env` 不会改密码，请在界面里改。
- `POSTGRES_PASSWORD` 同时用于 PostgreSQL 容器和 `DATABASE_URL` 构造，改一处即可，两边始终一致。
- `COOKIE_SECRET` 用于 Cookie 签名。多副本部署时必须一致，否则各副本之间会话校验会失效。

可选但常用的调整：

```env
APP_BASE_URL=https://files.example.com   # 对外访问地址，影响 Cookie 与链接
SECURE_COOKIES=true                      # 上 HTTPS 后开启
FILE_TTL_HOURS=2                         # 文件保留时长
DAILY_JOBS=20                            # 每人每天任务数
WORKER_CONCURRENCY=3                     # 同时转换数，与 CPU 核数匹配
```

## 3. 启动

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f web
```

判断启动成功：

- `docker compose ps` 中 `postgres`、`redis`、`web`、`worker` 都应为 `healthy`。worker 不提供 HTTP，镜像里的健康检查对 worker 角色直接返回成功，避免误报 unhealthy。
- 日志中出现 `ConvertLab listening` 和 `database ready`。
- 首次启动会有一条 `bootstrap administrator created` 警告，说明管理员已创建。

访问 `http://<主机>:8080`，用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录，然后：

1. 在“账户”页修改管理员密码。
2. 在“管理后台 → 设置”确认“开放注册”是否符合预期。
3. 上传一个带表格的 PDF 转 Word，确认表格带线、可编辑。

## 4. 数据卷与权限

Compose 定义了三个命名卷：

| 卷 | 内容 | 备份优先级 |
| --- | --- | --- |
| `convertlab-data` | 上传文件、转换结果、临时 LibreOffice 配置 | 低（可重建，但有 TTL 内未下载的文件） |
| `convertlab-pgdata` | PostgreSQL 数据（用户、任务记录、配额、审计） | **高** |
| `convertlab-redis` | 队列数据（可重建） | 低 |

容器以 UID/GID `10001` 运行。使用命名卷时 Docker 会自动处理权限；如果你改成宿主机目录 bind mount，需要先改属主：

```bash
sudo mkdir -p /srv/convertlab/data
sudo chown -R 10001:10001 /srv/convertlab/data
```

然后在 `docker-compose.override.yml` 中把 `convertlab-data` 替换为该目录。

## 5. 反向代理与 HTTPS

以 Caddy 为例（自动申请证书）：

```caddyfile
files.example.com {
    encode zstd gzip
    request_body {
        max_size 250MB      # 必须大于 MAX_FILE_MB
    }
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1   # 关闭缓冲，SSE 进度才能实时到达浏览器
        transport http {
            read_timeout 15m
            write_timeout 15m
        }
    }
}
```

仓库里的 `deploy/caddy/Caddyfile` 是这台服务器在用的版本，可以直接参考：80 端口永久跳转到规范域名，443 端口由 Caddy 自动申请和续期证书。

Nginx 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name files.example.com;

    ssl_certificate     /etc/letsencrypt/live/files.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/files.example.com/privkey.pem;

    client_max_body_size 120m;          # 要大于 MAX_FILE_MB

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;            # SSE 进度需要
        proxy_read_timeout 600s;
    }
}
```

同时修改 `.env`：

```env
APP_BASE_URL=https://files.example.com
SECURE_COOKIES=true
TRUST_PROXY=true
```

注意：

- `client_max_body_size` 必须大于单文件上限，否则上传会在代理层被 413 拒绝。
- 反代必须透传 `X-Forwarded-For`，否则登录限流会把所有请求当成同一个 IP。
- 进度使用 SSE（`text/event-stream`），代理不能缓冲。
- 如果服务**直接**暴露在公网、前面没有可信代理，请设置 `TRUST_PROXY=false`，避免客户端伪造 `X-Forwarded-For` 绕过限流。

上传目录里都是用户的原始文件，建议宿主机磁盘开启加密，或至少用独立分区并设置配额。

### 5.1 小内存服务器（1–2 GB）

`docker-compose.override.yml` 是为 800 MB 的小机器准备的，Compose 会自动合并它：

- 各服务内存上限：postgres 256 MB、redis 64 MB、web 288 MB、worker 800 MB；
- PostgreSQL `shared_buffers=48MB`、`max_connections=20`；
- Redis `maxmemory 48mb`、`--maxmemory-policy noeviction`；
- `WORKER_CONCURRENCY=1`、`JOB_TIMEOUT_SEC=900`；
- Docker 日志按 `10m × 3` 轮转。

配套要求：

1. 开 swap（`fallocate -l 4G /swapfile` + `mkswap` + `swapon` + 写进 `/etc/fstab`），否则 LibreOffice 转换容易被 OOM 杀掉；
2. `.env` 里把 `DATABASE_POOL_SIZE` 降到 4 左右；
3. 把发布端口绑到回环地址 `HOST_PORT=127.0.0.1:8080`，由前置代理对外提供服务。

实测 800 MB 机器空载占 180 MB 左右，单次 LibreOffice 转换峰值 200–400 MB。真实案例见 [this-server.md](this-server.md)。

## 6. 使用外部 PostgreSQL / Redis

Compose 中的 `DATABASE_URL` 由 `POSTGRES_PASSWORD` 直接拼出，不支持在 `.env` 里覆盖。使用外部数据库时，新建 `docker-compose.override.yml`：

```yaml
services:
  web:
    environment:
      DATABASE_URL: postgresql://convertlab:<密码>@db.internal:5432/convertlab
      REDIS_URL: redis://redis.internal:6379/0
  worker:
    environment:
      DATABASE_URL: postgresql://convertlab:<密码>@db.internal:5432/convertlab
      REDIS_URL: redis://redis.internal:6379/0
```

并删除或注释掉 `depends_on` 中的 `postgres` / `redis`。外部 PostgreSQL 需要 16 或更高版本，字符集 UTF8。

## 7. 使用托管 PostgreSQL（Supabase / Neon / RDS）

可以把 Supabase 当作**托管 PostgreSQL** 来用，但只替代数据库这一层：

| Supabase 服务 | 是否使用 | 说明 |
| --- | --- | --- |
| Database（PostgreSQL） | **可以** | 只需要把 `DATABASE_URL` 指过去 |
| Storage | 不使用 | 文件仍在本地 `/data` 卷，应用没有 S3/对象存储后端 |
| Auth | 不使用 | 账号、会话、CSRF 由本应用自己管理 |
| Edge Functions / Realtime | 不使用 | 与本项目无关 |

### 连接串示例

在 Supabase 控制台 **Project Settings → Database → Connection string** 复制，注意选对模式：

```env
# 推荐：Session pooler（IPv4，每个客户端独占一个后端连接）
DATABASE_URL=postgresql://postgres.<project-ref>:<数据库密码>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require

# 也可以用直连（Supabase 直连域名默认只有 IPv6，很多 VPS 没有 IPv6）
# DATABASE_URL=postgresql://postgres:<数据库密码>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
```

要点：

- **必须开 TLS**。连接串里保留 `?sslmode=require`；如果供应商给的串没有这个参数，设置 `DATABASE_SSL=true`。
- 数据库名是 `postgres`，不是 Compose 里的 `convertlab`。
- Session pooler 用户名格式是 `postgres.<project-ref>`，不是 `postgres`。
- **不建议用 Transaction pooler（端口 6543）**：它会在不同后端连接之间切换，应用里的会话级 advisory lock（清理任务的互斥锁）可能锁在 A 连接、在 B 连接释放失败，导致清理被卡住。直连或 Session pooler 没有这个问题。
- 连接数：免费版直连上限约 60，Session pooler 更高。两个容器各 `DATABASE_POOL_SIZE` 个连接，建议设为 `5`–`8`，不要用默认 `10` 去堆。

### Compose 覆盖写法

`docker-compose.override.yml`：

```yaml
services:
  web:
    environment:
      DATABASE_URL: postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
      DATABASE_POOL_SIZE: "6"
  worker:
    environment:
      DATABASE_URL: postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
      DATABASE_POOL_SIZE: "6"
```

同时删掉两个服务的 `depends_on.postgres`，或者保留但把 `postgres` 服务删掉后改用 `depends_on` 里只剩 `redis`。`POSTGRES_PASSWORD` 在这种情况下不再使用，可以删掉。

### Supabase 免费版的实际限制

| 限制 | 影响 | 应对 |
| --- | --- | --- |
| 项目 7 天无活动自动暂停 | 恢复前 `/api/health` 的 `database` 为 false，页面报错 | 定期有访问；或用免费的外部定时请求保活；或升级 |
| 数据库 500 MB | 任务记录和审计日志会持续增长 | 定期清理旧审计日志、控制用户数 |
| 每日备份保留 7 天，无 PITR | 误删无法回滚到分钟级 | 自己用 `pg_dump` 做异地备份，见 [backup-restore.md](backup-restore.md) |
| 出站流量限制 | 大量下载会消耗配额 | 文件本身放在本地卷，只有查询走 Supabase，正常够用 |

### 仍然需要本机的东西

Supabase 只替代数据库。**Redis 必须自己提供**（Compose 里的 `redis` 服务继续用），转换引擎（LibreOffice、FFmpeg、Poppler、Ghostscript）仍在容器里，文件存储仍在 `/data` 卷。

### 备份

把备份命令指向 Supabase：

```bash
pg_dump "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require" \
  --format=custom --no-owner > backups/convertlab-$(date +%F).dump
```

也可以在 Supabase 控制台用 Database → Backups 做即时备份，但不要只依赖平台备份。

## 8. 扩容与并发

- 单机提高吞吐：增大 `WORKER_CONCURRENCY`，同时提高 worker 服务的 `cpus` 和 `mem_limit`（Compose 中默认 `3.0` CPU / `4g`）。
- 多副本：`docker compose up -d --scale worker=3`。队列由 Redis 统一调度，天然支持多 worker。
- 多 web 副本时必须固定 `COOKIE_SECRET`，并在前面加负载均衡。
- 转换是 CPU 密集的；不要在同一台机器上同时开太多 LibreOffice 实例，否则内存会先耗尽。

## 9. 升级

```bash
git pull
docker compose build
docker compose up -d
```

数据库迁移在启动时自动执行（建表脚本使用 `CREATE TABLE IF NOT EXISTS` 和幂等语句）。升级前先做一次备份，见 [backup-restore.md](backup-restore.md)。

## 10. 健康检查与观测

```bash
curl -fsS http://127.0.0.1:8080/api/health
docker compose exec web node dist/server/doctor.js
docker compose logs --since 30m web worker
```

`/api/health` 返回数据库和队列状态；`doctor` 检查 LibreOffice、FFmpeg、FFprobe、Poppler、Ghostscript 和数据目录是否可用。

日志是逐行 JSON（`ts`、`level`、`msg` 字段），可以直接交给 journald、Loki 或 ELK。默认不记录用户文件内容，只记录任务 ID、格式和字节数。

## 11. 卸载

```bash
docker compose down            # 停止并删除容器，保留数据卷
docker compose down -v         # 连同数据卷一起删除（不可恢复）
docker image rm convertlab:latest
```

## 部署检查清单

- [ ] `COOKIE_SECRET`、`ADMIN_PASSWORD`、`POSTGRES_PASSWORD` 已修改，且不是示例值
- [ ] 登录后已修改管理员密码
- [ ] HTTPS 已启用，`SECURE_COOKIES=true`
- [ ] `client_max_body_size` 大于单文件上限
- [ ] 已配置备份，并做过一次恢复演练
- [ ] 上传一个带表格的 PDF 转 Word/Excel，确认表格带线且按行列写入
- [ ] 上传一个扫描版 PDF 转 Word，确认提示“已自动使用版式模式”
- [ ] 若使用托管数据库，连接串带 `sslmode=require` 或设置了 `DATABASE_SSL=true`，且 `DATABASE_POOL_SIZE` 未超过套餐连接上限

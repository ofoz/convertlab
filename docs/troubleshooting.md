# 故障排查

按“现象 → 原因 → 处理”组织。先做两步通用检查：

```bash
docker compose ps
docker compose logs --since 30m web worker
curl -i http://127.0.0.1:8080/api/health
```

`/api/health` 返回 200 且 `database`、`redis` 都为 `true` 才是真正健康。

## web 容器一直 unhealthy

1. `docker compose logs web` 看是否在 `startup failed` 处退出。
2. 常见原因：`DATABASE_URL` 或 `REDIS_URL` 不通、`ADMIN_PASSWORD` 没设置、数据库还没就绪。Compose 已经用 `depends_on: condition: service_healthy` 等待，但自定义外部数据库时不会等。
3. `curl http://127.0.0.1:8080/api/health`，看响应里哪个字段是 `false`。
4. 健康检查命令本身依赖 `PORT`，如果你改了端口，Compose 里的探测地址也要改。

## PostgreSQL 认证失败

日志特征：`password authentication failed for user "convertlab"`。

原因：改了 `POSTGRES_PASSWORD`，但数据卷里还是旧密码（初始化只在第一次建卷时执行）。

处理（三选一）：

```bash
# 1. 如果数据可以丢弃（全新部署）
docker compose down -v && docker compose up -d

# 2. 用旧密码进入容器修改
docker compose exec postgres psql -U convertlab -d convertlab
ALTER USER convertlab WITH PASSWORD '新密码';

# 3. 把 .env 的 POSTGRES_PASSWORD 改回旧值
```

记住：`DATABASE_URL` 由 `POSTGRES_PASSWORD` 自动拼出，两边不会再不同步；问题通常是卷里的密码没跟着变。

## Redis 连接失败

日志特征：`redis connection error`、`ECONNREFUSED`、`Connection is closed`。

- `docker compose ps redis` 是否 `healthy`。
- 外部 Redis 检查 `REDIS_URL` 是否带密码、是否允许该网段。
- Redis 使用了 `appendonly yes`，磁盘满会导致写入失败，检查 `df -h`。
- 队列数据损坏时（极少见）可以清空 Redis 卷：`docker compose down` → 删除 `convertlab-redis` 卷 → 重新启动。正在排队的任务会丢失，需要用户重新提交。

## 任务一直显示“排队中”

`queued` 说明任务已入库但没有 worker 领取，或 worker 没连上 Redis。

1. 确认 worker 在跑：`docker compose ps worker`、`docker compose logs worker`。
2. 日志里应有 `BullMQ worker started with concurrency N`；如果没有，说明 worker 启动失败。
3. 确认 `PROCESS_ROLE` 正确：只用 `web` 角色时不会消费队列；`all` 或 `worker` 才会。
4. 检查 `QUEUE_NAME` 在 web 和 worker 中是否一致（Compose 中来自同一个 `.env`，通常没问题）。
5. 所有 worker 都在忙时任务会等待；提高 `WORKER_CONCURRENCY` 或增加 worker 副本。

## LibreOffice 转换失败 / 卡住

- 日志中 `soffice` 报 `no export filter`、`source file could not be loaded`：文件损坏、加密或格式与扩展名不符。用 `libreoffice --headless` 在宿主机复现。
- 提示“文件受密码保护”：暂不支持解密，请先手动去掉密码。
- 每个任务使用独立的 `UserInstallation` 目录，位于 `DATA_DIR/tmp` 下；如果该目录不可写（bind mount 属主错误），LibreOffice 会直接失败并留下空输出。
- 首次转换特别慢是正常的（字体缓存、组件加载）。镜像构建时已执行 `fc-cache -f`。
- 单个任务超过 `JOB_TIMEOUT_SEC`（默认 600 秒）会被终止，报“转换用时过长”。

## 中文变成方框 / 乱码

镜像已安装 `fonts-noto-cjk`，但如果你自己改过 Dockerfile 或用了精简镜像，可能丢失。检查：

```bash
docker compose exec web fc-list :lang=zh | head
```

没有输出说明中文字体缺失，见 [heic-fonts.md](heic-fonts.md) 的字体部分。

Office 文档转 PDF 时中文乱码，通常是原文档指定了本机没有的字体（如“宋体”“微软雅黑”），Noto CJK 会做替代，字形会略有不同但不会乱码。

## HEIC 上传后转换失败

提示“无法解码 HEIC/HEIF 图片”。

- 镜像包含 FFmpeg（带 libheif）和 `libheif-examples`；如果自行构建时删掉了这些包，HEIC 会失败。
- 先用 `ffmpeg -i test.heic out.png` 在容器内测试。
- 应急处理：让用户先转成 JPG/PNG 再上传。

## PDF 表格转换结果不对

先区分 PDF 类型：

```bash
docker compose exec web pdftotext -layout /data/uploads/<文件> - | head
```

- **有文字输出**：有文本层，可编辑模式会尝试重建表格。若结果错乱，多半是复杂排版（多栏、嵌套表、合并单元格、旋转页面）。可改用“版式还原”保证外观，但内容不可编辑。
- **只有空白或极短输出/全是图片**：扫描件，没有文本层。在 PDF 参数里开启“扫描件识别（OCR，较慢）”选项后重新转换即可生成可编辑文字和表格。
- **开启 OCR 后仍识别错误或表格错位**：扫描件清晰度低、字号过小、页面歪斜或含复杂合并单元格，属 OCR 固有局限，请人工校对。
- 表格跨页：Excel 默认仍放在同一个工作表，相邻页的表头与续接行会尝试自动合并；复杂续表仍建议人工核对。只有显式选择“每页一个工作表”时，才会按 PDF 页拆成多个 sheet。
- 表格无边框：靠列间距识别，列间距过小或文字重叠时可能把两列合并。

这不是参数问题，属于识别能力边界；重要文件请人工核对。

## 上传报 413

- 单文件超过 `MAX_FILE_MB`：任务上传阶段就会被拒绝，提示具体文件名和上限。
- 反向代理限制：Nginx 默认 1 MB，必须设置 `client_max_body_size 120m;` 或更大。
- 批量总大小超过当日上传配额也会失败，但错误码是 429 而不是 413。

## 上传报 429

- 当日任务数、上传流量或输出流量达到配额（默认 20 次 / 1 GB / 2 GB）。
- 登录/注册/改密码触发限流。等待 `Retry-After` 指示的秒数。
- 管理员可以在“管理员 → 用户”里单独调整某个用户的配额。

## 写操作报 403“安全校验失败，请刷新页面后重试”

CSRF token 与当前会话不匹配。常见于：

- 页面开着很久，会话过期或已在别处改密码导致会话被吊销 → 重新登录。
- 多个标签页登录了不同账号，最后登录的会话覆盖了 Cookie → 刷新页面。
- 反向代理改写了 Cookie 或域名不一致 → 确认 `APP_BASE_URL` 与实际访问地址一致。

## 登录后立刻回到登录页

- 检查 `/api/auth/me` 返回：`curl -i -b "cl_session=..."`。
- `SECURE_COOKIES=true` 但用 HTTP 访问时，浏览器不会保存 Cookie。要么上 HTTPS，要么临时关闭该选项。
- 反向代理没有透传 `Cookie` 头，或前端与 API 不在同一个域名下。

## 使用 Supabase / 托管数据库时的常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `no pg_hba.conf entry ... no encryption` | 连接串没带 TLS | 在 `DATABASE_URL` 末尾加 `?sslmode=require`，或设置 `DATABASE_SSL=true` |
| `password authentication failed for user "postgres.<ref>"` | pooler 用户名写错，或密码含特殊字符没转义 | Session pooler 用户名是 `postgres.<project-ref>`；密码里的 `@ : / ?` 需要 URL 编码 |
| `ENOTFOUND db.<ref>.supabase.co` / 连接超时 | 直连域名只有 IPv6，宿主机没有 IPv6 | 改用 Session pooler（`aws-0-<region>.pooler.supabase.com:5432`） |
| `remaining connection slots are reserved` / `too many clients` | 连接数超过套餐上限 | 降低 `DATABASE_POOL_SIZE`（两个容器各算一次），或改用 pooler |
| 健康检查 `database: false`，日志里连接被拒 | 免费项目因长期无活动被暂停 | 到 Supabase 控制台恢复项目；需要长期在线就配置保活或升级 |
| 清理任务日志一直跳过、过期文件不删 | 用了 Transaction pooler（6543），advisory lock 释放失败 | 改用直连或 Session pooler（5432） |
| `prepared statement "s1" already exists` | 第三方工具开了命名预处理语句，且走 Transaction pooler | 本应用不使用命名预处理语句；若用其他客户端连同一个库，换 Session pooler |

注意：托管数据库只替代 PostgreSQL，Redis 和文件存储仍需本地提供，见 [deployment.md](deployment.md#7-使用托管-postgresqlsupabase--neon--rds)。

## 下载报 410“文件已过期”

文件超过 `FILE_TTL_HOURS` 已被清理。任务记录仍在，但文件不可恢复，需要重新转换。需要更长时间请调大 `FILE_TTL_HOURS`（最大 168 小时），或转换完立即下载。

## 磁盘写满

```bash
docker system df
du -sh /var/lib/docker/volumes/convertlab-data/_data/*
```

清理顺序：

1. 管理后台 → 设置 → “立即清理过期数据”。
2. 检查 `/data/tmp` 是否有异常大的残留目录（正常应 6 小时内清掉）。
3. `docker image prune` 清理旧镜像。
4. 降低 `MAX_FILE_MB`、`MAX_BATCH_FILES` 或 `FILE_TTL_HOURS`。

## 页面样式或脚本 404 / 白屏

`PUBLIC_DIR` 指向的前端产物不存在。确认容器内有 `dist/web/index.html`：

```bash
docker compose exec web ls -l /app/dist/web
```

本地开发时，如果只跑了 `npm run dev`（后端），没有构建前端，访问根路径会 404；请先 `npm run build`，或使用 `npx vite --config web/vite.config.ts` 开发服务器。

## 还是解决不了

收集以下信息再求助，注意先删除文件内容和密码：

```bash
docker compose version
docker compose ps
docker compose logs --since 2h web worker > convertlab-logs.txt
docker compose exec web node dist/server/doctor.js
curl -s http://127.0.0.1:8080/api/health
```

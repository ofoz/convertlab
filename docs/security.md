# 安全设计

这是一个自托管工具，安全模型的假设是：**部署在受信任的网络上，前面有 HTTPS 反向代理，用户是熟人但彼此不完全信任**。下面说明已经做了哪些防护，以及部署时必须自己补上的部分。

## 账号与密码

- 密码用 **scrypt** 哈希（N=16384, r=8, p=1, 64 字节输出），每个密码独立 16 字节随机盐，格式为 `scrypt$N$r$p$盐$哈希`，可直接升级参数而不影响旧密码校验。
- 校验使用 `timingSafeEqual`，避免比较耗时泄露信息。
- 密码长度 8–200 字符；注册和改密码都要求通过同一套强度校验。
- 登录失败统一返回“邮箱或密码不正确”，不区分邮箱是否存在；失败会写入审计日志，但不会记录明文密码。
- 修改密码后会**吊销该用户其它所有会话**，当前会话保留。

## 会话与 Cookie

- 会话令牌是 32 字节随机值，数据库只存它的 SHA-256 哈希，数据库泄露也无法直接冒用 Cookie。
- Cookie 名称 `cl_session`，属性：`HttpOnly`、`SameSite=Lax`、`Path=/`；HTTPS 部署时设置 `SECURE_COOKIES=true` 会追加 `Secure`。
- 会话默认 30 天过期（`SESSION_TTL_DAYS`），每小时被清理的过期会话由定时任务删除。
- 被停用的账号即使持有有效 Cookie 也无法访问（每次请求都会检查用户状态）。

## CSRF 防护

- 每个会话有独立的 CSRF token，登录和注册响应会返回它，前端保存后随写操作发送 `X-CSRF-Token` 头。
- 所有改变状态的接口（上传、取消、登出、改密码、管理员操作）都校验该 token，缺失或不匹配返回 403。
- `SameSite=Lax` 进一步阻止跨站表单提交携带 Cookie。
- 前端是单页应用，所有状态变更都走 `fetch`/`XHR`，没有可被利用的 HTML 表单提交点。

## 登录与接口限流

进程内滑动窗口限流（单机部署足够；多节点需要换成 Redis）：

| 场景 | 限制 |
| --- | --- |
| 登录（按 IP） | 15 分钟内 12 次 |
| 登录（按邮箱） | 15 分钟内 10 次，成功后清零 |
| 注册 | 每小时 10 次 |
| 修改密码 | 15 分钟内 8 次 |

超过限制返回 429，并带 `Retry-After`。反向代理必须透传真实 IP（`X-Forwarded-For`），否则所有请求会共享一个 IP 限流桶。反过来，如果服务直接暴露公网，请设置 `TRUST_PROXY=false`，防止客户端伪造该头。

## 上传与文件处理

- 每次上传写入独立的临时目录，权限 `0700`；任务完成后删除。
- 单文件大小和批次数量在流式写入时就限制（`MAX_FILE_MB`、`MAX_BATCH_FILES`），超限立即中止，不会先落盘再检查。
- **不信任扩展名**：读取文件头做 magic bytes 嗅探，PNG/JPG/GIF/WebP/PDF/RTF/WAV/FLAC/OGG/MP3/MKV/MP4/HEIC/OLE/ZIP 各自识别；Office 文件还会解析 ZIP 容器判断是 docx/xlsx/pptx。
- 内容与扩展名不匹配时按内容处理，识别不了就拒绝，避免把可执行文件当图片喂给转换器。
- 文件名只用于展示和下载命名，磁盘上使用 UUID 命名，杜绝路径穿越。
- 转换在无头 LibreOffice / FFmpeg 子进程中执行，每个任务独立 `UserInstallation` 配置目录，设置超时（`JOB_TIMEOUT_SEC`）并可取消。

## 下载鉴权

- 所有下载接口都先校验“任务属于当前用户”，管理员接口额外校验角色。
- 文件过期或已被清理返回 410，不泄露路径。
- 响应带 `Cache-Control: private, no-store`，避免中间缓存留存文件。

## HTTP 响应头与 CSP

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` 与 CSP `frame-ancestors 'none'`
- `Referrer-Policy: same-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`
- 页面 CSP：`default-src 'self'`，脚本、样式、连接都限制为同源，`object-src 'none'`，`base-uri 'none'`。前端没有内联脚本和内联样式，因此不需要 `unsafe-inline`。

## 数据隔离

- PostgreSQL 和 Redis 只在 Compose 内部网络暴露，**没有映射宿主机端口**。
- 使用托管数据库（Supabase/Neon/RDS）时，连接串必须启用 TLS（`?sslmode=require` 或 `DATABASE_SSL=true`），证书会按系统 CA 校验。
- 转换任务以非 root 用户（UID/GID 10001）运行。
- 数据目录权限 `0700`，入口脚本每次启动都会尝试收紧。
- 应用层按 `user_id` 过滤任务和文件；没有跨用户共享链接。

## 审计日志

以下动作写入 `audit_logs`：登录成功/失败、注册、改密码、创建任务、管理员创建/修改/删除用户、修改设置、手动清理。记录操作者、目标、IP、时间和简要详情（不记录文件内容）。

管理员可在“管理员 → 审计日志”查看最近记录。

## 部署时必须自己做的事

1. **改掉三个默认值**：`COOKIE_SECRET`、`ADMIN_PASSWORD`、`POSTGRES_PASSWORD`。使用 `.env.example` 里的原值等于没有防护。
2. **启用 HTTPS**，并设置 `SECURE_COOKIES=true`。
3. **限制网络暴露**：不要把 8080 直接暴露到公网；用防火墙只放行反向代理。
4. **保护 `.env`**：`chmod 600 .env`，不要提交到 Git。
5. **限制注册**：内部使用建议 `ALLOW_REGISTRATION=false`，由管理员手动开账号。
6. **定期升级基础镜像**：`docker compose build --pull`，及时获得 LibreOffice/FFmpeg 的安全修复。
7. **限制上传体积**：在反向代理设置 `client_max_body_size`，防止超大请求打满磁盘。

## 当前没有做的事（请知悉）

- 没有 2FA / TOTP。
- 没有邮件验证、找回密码、邮件通知。
- 没有按 IP 的全局带宽/连接数限制。
- 限流是进程内的，多副本时每个副本独立计数。
- 转换子进程运行在同一容器内，没有额外的 seccomp 或 gVisor 隔离；不要把它当作处理不受信任恶意文件的高安全沙箱。
- 没有病毒扫描。转换引擎（LibreOffice 等）历史上出现过解析漏洞，处理来源不明的文件时要谨慎。

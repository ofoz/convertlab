# 备份与恢复

数据分三部分：PostgreSQL（用户、任务记录、配额、审计、设置）、文件目录（上传与输出）、Redis（队列，可重建）。备份的重点是前两个。

## 需要备份什么

| 数据 | 位置 | 是否必须 |
| --- | --- | --- |
| 数据库 | 卷 `convertlab-pgdata` | **必须** |
| 上传与输出文件 | 卷 `convertlab-data`（`/data/uploads`、`/data/outputs`） | 可选；文件本身 2 小时过期，除非需要保留某个结果 |
| 配置 | 宿主机 `.env` | **必须**，但请勿提交到版本库 |
| 队列状态 | 卷 `convertlab-redis` | 不需要，重启后重建 |

恢复后旧任务记录仍然存在，但超过 TTL 的文件已经被删除，下载链接会返回“文件已过期”。这是预期行为。

## 1. 备份数据库（推荐方式）

```bash
mkdir -p backups
docker compose exec -T postgres \
  pg_dump -U convertlab -d convertlab --format=custom --no-owner \
  > backups/convertlab-$(date +%F-%H%M).dump
```

`--format=custom` 生成的 `.dump` 支持并行恢复和选择性恢复，比纯 SQL 更可靠。文件大小通常只有几 MB。

校验备份可用：

```bash
docker compose exec -T postgres pg_restore --list < backups/convertlab-2026-01-01-0300.dump | head
```

如果输出表清单（`users`、`jobs`、`job_files`、`sessions`、`daily_usage`、`audit_logs` 等），说明备份文件完整。

## 2. 备份文件目录（可选）

```bash
docker run --rm \
  -v convertlab-data:/data:ro \
  -v "$PWD/backups":/backup \
  alpine tar czf /backup/convertlab-data-$(date +%F).tar.gz -C /data .
```

如果使用的是宿主机目录 bind mount，直接 `tar` 那个目录即可。

注意：正在进行的任务会同时写文件，备份可能需要几秒钟。要严格一致，先暂停 worker：

```bash
docker compose stop worker
# ... 备份 ...
docker compose start worker
```

## 3. 自动化备份示例

`/etc/cron.d/convertlab-backup`：

```cron
15 3 * * * root cd /opt/convertlab && docker compose exec -T postgres pg_dump -U convertlab -d convertlab --format=custom --no-owner > backups/convertlab-$(date +\%F).dump && find backups -name 'convertlab-*.dump' -mtime +14 -delete
```

配合 `rclone` 或 `restic` 把 `backups/` 同步到另一台机器或对象存储。备份和原机器放在同一块磁盘上等于没有备份。

## 4. 恢复步骤

恢复会**覆盖**现有数据库，请先确认目标环境。

```bash
cd /opt/convertlab

# 1. 停止写入
docker compose stop web worker

# 2. 清空并重建数据库（会删除现有数据）
docker compose exec -T postgres psql -U convertlab -d postgres \
  -c "DROP DATABASE convertlab WITH (FORCE);" \
  -c "CREATE DATABASE convertlab OWNER convertlab;"

# 3. 恢复
docker compose exec -T postgres \
  pg_restore -U convertlab -d convertlab --no-owner --clean --if-exists \
  < backups/convertlab-2026-01-01-0300.dump

# 4. 如果也恢复了文件目录
docker run --rm \
  -v convertlab-data:/data \
  -v "$PWD/backups":/backup \
  alpine sh -c "cd /data && tar xzf /backup/convertlab-data-2026-01-01.tar.gz"

# 5. 启动
docker compose start web worker
docker compose logs -f web
```

恢复后确认：

```bash
curl -fsS http://127.0.0.1:8080/api/health
docker compose exec web node dist/server/doctor.js
```

用管理员账号登录，检查“管理员 → 用户”列表和最近任务是否与备份时间点一致。

## 5. 只恢复某个用户或某张表

`pg_restore` 支持选择性恢复：

```bash
# 只恢复 users 表
docker compose exec -T postgres pg_restore -U convertlab -d convertlab \
  --no-owner --data-only --table=users < backups/convertlab-2026-01-01.dump
```

跨表恢复（比如 `jobs` 与 `job_files`）要注意外键顺序，必要时先禁用触发器：

```sql
SET session_replication_role = replica;
-- 导入
SET session_replication_role = DEFAULT;
```

## 6. 完全重建（没有备份时）

如果数据库彻底丢失但 `.env` 还在：

1. `docker compose down -v`（清空所有卷）。
2. `docker compose up -d --build`。
3. 系统会用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 重新创建管理员。

代价是所有用户、历史记录、配额和审计日志丢失，无法找回。这也是为什么要定期备份，并至少每季度做一次恢复演练。

## 恢复演练清单

- [ ] 在非生产目录准备一份 `.env` 和空卷
- [ ] 用真实备份文件执行一次完整恢复
- [ ] 登录成功，任务列表与备份时间点一致
- [ ] `/api/health` 正常，`doctor` 全绿
- [ ] 用恢复后的数据做一次 PDF 表格转换，确认输出正常
- [ ] 记录实际耗时，确认在可接受范围内

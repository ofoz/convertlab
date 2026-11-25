# 文件过期与清理策略

ConvertLab 默认让上传文件和转换结果只保留 **12 小时**，目的是控制磁盘占用，并降低文件泄露风险。所有清理都是自动的，也有管理员手动入口。

## 生命周期

```text
上传 → 写入 /data/uploads → 转换 → 写入 /data/outputs
     → 用户下载（任意时间，只要未过期）
     → 到达 TTL → 标记过期 → 删除磁盘文件 → 记录保留
```

数据库中的任务记录**不会**随文件删除而删除，历史页仍能看到任务、格式、字节数和结果状态，但下载会返回“文件已过期”。

## 关键配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `FILE_TTL_HOURS` | `12` | 从任务创建时开始计算的有效期，范围 1–168 小时 |
| `DATA_DIR` | `/data` | 上传、输出、临时目录的根 |

TTL 在任务创建时写入每条文件的 `expires_at`，修改 `FILE_TTL_HOURS` 只影响新任务，不影响已有任务。

## 清理调度

清理任务由 web 进程启动，每 **5 分钟**执行一次，第一次在启动后 15 秒：

1. 用 PostgreSQL advisory lock 加锁，多个 web 副本同时运行时只有一个真正执行。
2. 把到期文件的 `status` 标记为 `expired`。
3. 删除到期文件的输出路径和源路径，清空数据库中的路径字段。
4. 把请求取消但仍在排队/执行中的任务标记为 `cancelled`。
5. 删除过期的登录会话。
6. 删除 `DATA_DIR/tmp` 下超过 **6 小时** 的临时目录（LibreOffice 配置、页面图片等）。

清理日志示例：

```json
{"level":"info","msg":"cleanup complete","expiredFiles":3,"removedArtifacts":6,"cancelledQueued":0,"purgedSessions":1,"removedTempDirs":2}
```

## 手动清理

管理员可以在“管理后台 → 设置”点击“立即清理过期数据”，或直接调用接口：

```bash
curl -X POST https://files.example.com/api/admin/cleanup \
  -H "Cookie: cl_session=<你的会话>" \
  -H "X-CSRF-Token: <你的 csrf token>"
```

返回本次清理的数量统计。手动清理和定时清理走同一段逻辑，可以安全重复执行。

## 磁盘空间估算

单个任务占用的空间约为：`源文件大小 + 输出文件大小 + 转换中间文件`。

- 100 MB 的 PDF 转图片可能产生数百 MB 的中间 PNG，转换结束即删除，但峰值需要预留空间。
- 20 个文件 × 100 MB 的批次，峰值可能接近 4 GB。

建议：

- 给 `/data` 单独分区，至少 20 GB。
- 用 `du -sh /var/lib/docker/volumes/convertlab-data/_data` 观察增长。
- 如果磁盘持续紧张，先降低 `MAX_FILE_MB` 或 `MAX_BATCH_FILES`，再考虑缩短 TTL。

## 关闭自动过期（不推荐）

把 `FILE_TTL_HOURS` 设得很大（例如 `168`，7 天）即可延长时间，但仍会自动清理。当前版本没有“永久保留”开关；确实需要长期保存的结果，请在过期前下载到自己的存储。

## 清理没有生效怎么办

1. 确认 web 进程在运行：`docker compose ps`。
2. 查看日志中是否有 `cleanup failed`；常见原因是数据库连接中断。
3. 确认多个副本没有同时卡在 advisory lock 上（正常情况下会直接跳过，不会报错）。
4. 检查 `/data` 权限：容器内 UID 必须是 `10001`，否则删除文件会失败并记录 `artifact removal failed`。
5. 手动执行一次 `POST /api/admin/cleanup`，看返回的数量是否大于 0。

# 本次部署记录（111.91.29.56）

这份文档记录的是**这台具体机器**上真实跑起来的部署状态，不是通用教程。通用步骤见 [deployment.md](deployment.md)。

最后更新：2026-11-25

## 1. 机器规格

| 项目 | 值 | 备注 |
| --- | --- | --- |
| 公网 IP | `111.91.29.56` | 华为云 ECS，主机名 `hcss-ecs-135f` |
| 宿主机系统 | Debian GNU/Linux 12 (bookworm)，内核 6.1 | 应用容器已使用 Debian 13 (trixie) |
| CPU | 2 vCPU | |
| 内存 | **800 MB** | 远低于推荐的 4 GB，见第 3 节 |
| Swap | 4 GB（`/swapfile`） | 本次新增，`vm.swappiness=10` |
| 应用容器系统 | Debian GNU/Linux 13 (trixie) | Poppler、LibreOffice、Ghostscript、OCR 工具链随系统升级 |
| 磁盘 | 40 GB（已用 14 GB，剩余 25 GB） | |
| Docker | 29.10.0 + Compose v5.8.0 | 系统自带 |

## 2. 目录与组件

| 路径 | 内容 |
| --- | --- |
| `/opt/convertlab` | 项目源码、`.env`、`docker-compose.yml` + `docker-compose.override.yml` |
| `/usr/local/bin/caddy` | Caddy v2.10.2，接管 80 / 443 |
| `/etc/caddy/Caddyfile` | 反向代理配置（源文件在 `deploy/caddy/Caddyfile`） |
| `/var/lib/caddy/.local/share/caddy/` | Caddy 自动申请的 `fileshop.shop` 证书与 ACME 状态 |
| `/var/backups/convertlab` | 每日 `pg_dump` 与 `.env` 备份 |
| `/usr/local/bin/convertlab-backup` | 备份脚本（源文件 `deploy/backup.sh`） |
| `/root/backup-before-convertlab-20261123-1822` | 迁移前旧环境的备份（1Panel 数据、dp 站点证书、dapan-cloud 配置） |

## 3. 内存：这台机器最需要注意的地方

800 MB 物理内存 + 4 GB swap 是本部署的硬约束。已做的处理：

- 关闭并移除了 1Panel（`1panel-core` / `1panel-agent`）与它管理的 openresty 容器：约省 150 MB。
- 停用了原来的 `dapan-cloud` 容器：约省 160 MB。
- `docker-compose.override.yml` 里给四个服务都设了内存上限，并把 `WORKER_CONCURRENCY` 降到 1（同时只跑一个转换）。
- Docker 日志限制为 `10m × 3`，避免长期运行写满 40 GB 磁盘。

实测常驻内存（空闲）：

```
convertlab-worker-1    53 MB
convertlab-web-1       77 MB
convertlab-postgres-1  39 MB
convertlab-redis-1     12 MB
```

转换时 worker 会涨到 200–400 MB（LibreOffice / FFmpeg 子进程），此时会用到 swap，速度会下降但不至于 OOM。

**建议**：如果以后转换任务变多，把内存升到 2 GB 以上体验会明显不同。当前配置适合「自己和小圈子偶尔用」。

## 4. 访问方式

| 地址 | 端口 | 证书 |
| --- | --- | --- |
| `http://fileshop.shop` / `http://111.91.29.56` | 80 | 永久跳转到 HTTPS |
| `https://fileshop.shop` | 443 | Caddy 自动申请和续期证书，推荐用这个 |

`fileshop.shop` 的 A 记录指向本机 IP。Caddy 通过 ACME 自动申请并续期证书。

应用本身只监听 `127.0.0.1:8080`，公网无法直连，必须经过 Caddy。

如果要再换域名：先让新域名的 A/AAAA 记录指向本机，然后把 `/etc/caddy/Caddyfile` 中 `fileshop.shop` 替换为新域名，执行 `caddy validate` 后重载 Caddy。Caddy 会自动完成证书申请和续期。

## 5. 常用运维命令

```bash
cd /opt/convertlab

docker compose ps                        # 看四个容器状态
docker compose logs -f web               # Web 日志
docker compose logs -f worker            # 转换日志（每个文件一行结果）
docker compose restart worker            # 只重启 worker
docker compose up -d --build             # 改代码后重新构建并滚动启动
docker compose exec web node dist/server/doctor.js   # 依赖自检

systemctl status caddy                   # 反向代理状态
systemctl reload caddy                   # 改完 Caddyfile 后生效
tail -f /var/log/caddy/caddy.log         # 代理日志（按 20 MB 轮转）

/usr/local/bin/convertlab-backup         # 手动跑一次备份
systemctl list-timers convertlab-backup.timer        # 备份定时器下次执行时间
```

冷启动后两个容器会自动恢复（`restart: unless-stopped` + Docker 开机自启），不需要人工介入。

## 6. 验收记录（2026-11-23，真实执行）

在本机对线上实例执行 `deploy/verify/smoke.py`：

```
login: ok as admin@192163.xyz (admin)
health: {'status': 'ok', 'database': True, 'redis': True, ...}
table-bordered.pdf    -> docx: success  (word/document.xml: tables=1, borderBlocks=1)
table-bordered.pdf    -> xlsx: success  (1 个工作表，表格区块带 thin 边框，正文自动换行)
table-borderless.pdf  -> docx: success  (tables=1, borderBlocks=1)
SMOKE OK
```

LibreOffice 路径（`deploy/verify/libreoffice_probe.py`）：DOCX → PDF 成功，耗时 6.2 秒，输出 44 KB 的 `%PDF-` 文件。

容器内 `doctor.js` 全部通过：LibreOffice 7.4.7.2、FFmpeg 5.1.9、Poppler、Ghostscript 10.00、PostgreSQL 16.16、Redis PONG、`/data` 可写。

历史上外部访问曾使用旧域名；当前规范地址以本文第 4 节和本次验收记录为准。

## 7. 迁移记录：删掉了什么

按「服务器上的内容全部清除、项目直接跑在 80/443」的要求，本次移除了：

- 1Panel（面板本体、agent、openresty 容器、`/opt/1panel` 全部数据）
- `dapan-cloud` 容器与 `/opt/dapan-cloud`（镜像 `dapan-cloud:20261118-01` 已删除）
- 上述两个镜像与全部构建缓存

**保留物**：`/root/backup-before-convertlab-20261123-1822/` 里有 1Panel 的 `core.db`/`agent.db`、dp 站点的证书与代理配置、`dapan-cloud` 的完整目录打包（34 MB）。如需回滚旧服务，从这里取文件即可，但要注意内存只有 800 MB，旧服务与本项目不适合同时运行。

## 8. 容器系统升级记录（2026-11-24，Debian 12 → 13）

**只升级了应用容器，宿主机仍是 Debian 12 + 内核 6.1。** 宿主机整机大版本升级会牵动
Docker、Caddy 和内核重启，收益低风险高，所以没有做；转换质量真正依赖的东西都在容器里，
换基础镜像就能全部拿到。

镜像的两处 `FROM` 从 `node:24-bookworm-slim` 改成了 `node:24-trixie-slim`。

工具链前后对比：

| 组件 | 升级前（Bookworm） | 升级后（Trixie） |
| --- | --- | --- |
| 基础系统 | Debian 12 | Debian 13.8 |
| Poppler (`pdftotext`) | 22.12.0 | 25.03.0 |
| LibreOffice | 7.4.7.2 | 25.2.3.2 |
| Ghostscript | 10.00.0 | 10.05.1 |
| FFmpeg | 5.1.9 | 7.1.5 |
| OCRmyPDF | 14.0.1 | 16.7.0 |
| Tesseract | 5.3.0 | 5.5.0 |
| Node | 24 (不变) | 24 (不变) |

数据卷（`convertlab-data` / `convertlab-pgdata` / `convertlab-redis`）全程未动，
数据库里的账号、任务记录和已上传文件都保留。

### 回滚

升级前的镜像保留为 `convertlab:bookworm-backup-20261124`：

```bash
cd /opt/convertlab
docker tag convertlab:bookworm-backup-20261124 convertlab:latest
docker compose up -d --no-build web worker
```

### 升级后验收（真实执行）

- `node dist/server/doctor.js` 全部 OK（LibreOffice、FFmpeg、Poppler、Ghostscript、OCR、PG、Redis、`/data`）
- `deploy/verify/smoke.py`：`SMOKE OK`（带边框 PDF → DOCX 1 张表 1 组边框；→ XLSX 表头冻结、styles.xml 4 条 thin 边框；无边框 PDF → DOCX 1 张表）
- `deploy/verify/libreoffice_probe.py`：DOCX → PDF 成功，6.5 秒，65 KB
- 真实 5 页带表格 PDF（`WorkBuddy能力自述.pdf`）：DOCX 4 张表（10×5、6×2、4×3、4×3，
  与原版 Word 完全一致），正文 1945 字；XLSX 默认把正文与 4 张表放进 1 个工作表
- OCR 链路（渲染成纯图片 PDF 后开 OCR）：识别成功，12 秒出 docx，文字层 698 字
- 外部访问：HTTP 请求会跳转至 HTTPS，规范域名由 Caddy 自动管理证书
- 常驻内存反而更低：worker 28 MB、web 45 MB（升级前 53 / 77 MB）

### 顺带修的两个 PDF 问题

1. **Poppler SVG 写法兼容**（`src/converters/pdf-tables.ts`）：22.x 把描边写成
   `style="stroke:rgb(...)"`，25.x 写成 `stroke=""` 属性。原代码只读属性，导致旧版容器里
   表格线全部丢失、表格塌成纯文本。现在两种写法都读，并有 `tests/pdf-svg-poppler-compat.test.ts` 兜底。
2. **跨页表格在 Excel 里重复行**（`src/converters/documents.ts`）：跨页续接的表已经并入上一页的
   表格，但生成 XLSX 时又按页把它写了一遍，出现重复的续行。现在跳过已合并的续接表。

### 段落被误判成表格（2026-11-24 修复）

两端对齐的正文有时会被无边框表格识别误判：这种段落左右都贴着页边距，于是"左边缘稳定、右边缘稳定"
的判据成立，一页 20 行的正文里被拆出十几张"表"。修复方式是在原有的边缘判据之外，再要求
**列与列之间存在贯穿所有对齐行的空白通道**（每行在同一个 x 区间都是空白），否则不算表格。

修复前后对比（20 页研究报告 `全球大模型格局与旗舰模型评分报告_2026-11.pdf`）：

| | 修复前 | 修复后 |
| --- | --- | --- |
| DOCX 表格数 | 25（其中 12 张是段落误判） | 13（全部为真表格） |
| 表格行数合计 | 175 | 106 |
| DOCX 正文字符 | 14334 | 14334（无丢失，只是段落回到段落） |

验证：`npm test` 新增两条用例（两端对齐段落不误判 / 列间空白通道稳定的无边框表格仍识别）；
`tests/fixtures/table-borderless.pdf` 仍识别为 5 列 × 5 行；WorkBuddy 5 页样例仍为 4 张表。

### 扫描版表格支持（2026-11-24 新增）

扫描版（图片型）PDF 开 OCR 后此前只能识别文字，表格结构识别不出来：表格线是像素，不是矢量，
原有识别依赖矢量线或文本列间隙。现在新增了图像表格检测：

- 对判定为扫描页的页面（页面位图面积 ≥ 页面的 50%，或整份文件都没有文本层），额外以
  300dpi 灰度渲染一次，用像素连续暗行程检测横线/竖线，并用线带密度校验排除色块、字形、logo。
- 检测到的线位置换算回 PDF 坐标，与 OCR 文本层坐标一起交给原有的网格装配逻辑，产出真正的
  带边框 Word 表格 / Excel 单元格，而不是一列列离散文字。
- 同一页上多张上下堆叠、左右边距相同的表格，先按笔画断点（共线但中断超过 3pt）拆成独立线段再装配，
  否则左右边框会被熔成一条整页竖线，整页被当成一张表而识别失败。
- 表格结构先由 300dpi 像素检测定位，再由隔离的 Python 环境里的 RapidTable SLANet Plus 复核合并单元格；pdfplumber 作为电子 PDF 的第二检测器。单次最多处理 20 页扫描页。

生产实测：把 5 页样例 PDF 的第 3 页（1 张表）和第 4 页（3 张表）分别栅格化成无文本层 PDF
（`pdftotext` 取到 0 字符），开 OCR 转换：

| 页面 | DOCX | XLSX |
| --- | --- | --- |
| 第 3 页（1 张表） | `tables=2 rows=20 cells=38`，文本 698 字符 | 1 个工作表，含 2 个带边框表格区块与正文 |
| 第 4 页（3 张表） | `tables=3 rows=24 cells=37`，文本 470 字符 | 1 个工作表，含 3 个带边框表格区块与正文 |

整份 5 页样例都栅格化成纯图片 PDF（`pdftotext` 取到 0 字符）后，开 OCR 转换 DOCX 得到
`tables=5 rows=26 cells=98`、正文 1919 字符，XLSX 默认得到 1 个工作表（正文与 5 张表按阅读顺序排列），
任务备注写“其中 5 个来自扫描页图像识别”。堆叠表格拆分修复前同输入只能识别出 3 张表。

改造前同一份扫描页输出 0 张表。任务备注会写“其中 N 个来自扫描页图像识别”。
同一份 5 页数字版 PDF 回归转换仍是 4 张带边框表格、正文 1945 字符（原始 `pdftotext`
非空白字符 1969），未出现退化。

### Excel 默认单工作表（2026-11-24）

PDF 转 Excel 的默认行为已从“每张表一个工作表”改成“整份文档一个工作表”。正文和表格按 PDF
阅读顺序堆叠，正文跨表格列合并并开启自动换行；只有识别出的表格区块添加边框、表头底纹、数字格式
和首行冻结。列宽只参考表格单元格内容，避免长段落把表格列撑得过宽。用户显式传
`options.pdf.sheetMode = "page"` 时，才按 PDF 页码拆成多个工作表。

扫描版多表 PDF 的回归结果同步变为 1 个工作表，原有 OCR 识别与图像表格检测结果不变。

### 已知限制

图像表格检测依赖扫描页上**可见的表格线**。三线表、只有浅色/断续线条、严重倾斜或压缩失真的
扫描页，仍可能识别不全；常见合并单元格和相邻页续表已尝试自动重建，复杂表格、表格内公式仍需人工核对。带底色的引文块、色块
和水印有可能被当成表格线而误判为表格；OCR 本身也会认错字。OCR 和图像检测都有页数上限
（OCR 40 页、图像表格检测 20 页），超出后只重建文字。

## 9. 已知风险（需要你决定）

1. **root 密码是截图里那个弱密码**，且 SSH 密码登录开着。建议立刻改密码并改用密钥登录：

   ```bash
   passwd                                   # 改 root 密码
   # 本地： ssh-copy-id root@111.91.29.56
   # 然后编辑 /etc/ssh/sshd_config：PasswordAuthentication no
   systemctl restart ssh
   ```

2. **必须走 HTTPS**。Caddy 已把 80 端口永久跳转到 <https://fileshop.shop>，登录和文件传输请使用 HTTPS 地址。

3. **注册是开放状态**（`ALLOW_REGISTRATION=true`）。公网可见的转换工具有被陌生人刷配额的风险。改 `.env` 为 `false` 后 `docker compose up -d` 即可关闭，已有账号不受影响。

4. **证书续期**：由 Caddy 自动管理；若 ACME 失败，检查 80/443 入站规则和 `/var/log/caddy/caddy.log`。

5. **备份只在本机**。`/var/backups/convertlab` 与数据在同一块盘上，整机故障时会一起丢。建议定期把该目录同步到对象存储或另一台机器。

6. 上传与输出文件按 2 小时 TTL 自动删除，属于预期行为，不是 bug。

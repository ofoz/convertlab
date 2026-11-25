# ConvertLab

**自托管的文件格式转换服务**：PDF 表格转可编辑 Word / Excel、扫描件 OCR、图片与 Office 文档互转、音视频提取音频。
中文界面，单机 Docker Compose 部署，自带账号体系、每日配额、任务队列、历史记录与管理后台。

![Node](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker%20Compose-v2-2496ED?logo=docker&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Postgres](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)

> 线上实例：`https://dp.192163.xyz`（Caddy 接管 80 / 443）。这台华为云 ECS 的规格、内存调优、
> 运维命令、迁移记录与已知风险见 [docs/this-server.md](docs/this-server.md)。

---

## 目录

- [特性一览](#特性一览)
- [快速开始](#快速开始)
- [使用教程](#使用教程)
- [重点能力：PDF 表格 → Word / Excel](#重点能力pdf-表格--word--excel)
- [支持的转换](#支持的转换)
- [HTTP API](#http-api)
- [配置](#配置)
- [本地开发与测试](#本地开发与测试)
- [项目结构](#项目结构)
- [部署与运维](#部署与运维)
- [已知限制](#已知限制)
- [界面来源与素材授权](#界面来源与素材授权)

## 特性一览

- **PDF 表格 → 真表格**：有文本层的 PDF 识别表格结构，输出真正的 `w:tbl`（带 `w:tblBorders` 细边框、
  表头加粗底纹、跨页重复表头），转 Excel 时按行列写单元格、带边框与冻结首行。
- **扫描件 OCR**：OCRmyPDF + Tesseract（`chi_sim` + `eng`）写入不可见文本层，页面图像不动，结果仍可编辑；可开启 300dpi 深度表格结构重建识别出合并单元格与跨页连续表格。
- **图片表格还原**：扫描页用 300dpi 灰度位图检测表格线，配合 RapidTable SLANet Plus 深度学习模型识别网格与合并单元格，换算回 PDF 坐标后装配成带边框表格——不是一列列散文字。
- **多格式互转**：4 个转换引擎、30 种输入格式、26 种输出格式（图片 / PDF / 文档 / 表格 / 演示 / 音视频）。
- **批量作业**：一次最多 20 个文件、单文件 100 MB，任务队列 + 实时进度 + 结果 ZIP 打包。
- **账号与配额**：登录、注册开关、每日任务数与流量配额、管理员封禁与用量统计、审计日志。
- **自动清理**：上传与结果文件默认 2 小时后过期删除，也有手动/定时清理入口。
- **匿名浏览**：首页和格式库不用登录，只有真正提交转换时才要求登录，登录后自动续办这一单。

## 快速开始

需要：Linux 主机、Docker 24+、Docker Compose v2、至少 2 GB 内存（建议 8 GB，4 GB 舒适）。
默认自带 PostgreSQL 16 与 Redis 7，**不依赖任何外部服务**（Supabase / Neon / RDS 等托管库是可选项，
见 [部署指南第 7 节](docs/deployment.md#7-使用托管-postgresqlsupabase--neon--rds)）。

```bash
git clone <this-repo> convertlab && cd convertlab
cp .env.example .env
# 必改三项：COOKIE_SECRET、ADMIN_PASSWORD、POSTGRES_PASSWORD
openssl rand -hex 32        # 生成 COOKIE_SECRET
$EDITOR .env

docker compose up -d --build
docker compose logs -f web
```

打开 `http://服务器地址:8080`，用 `.env` 里的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录，
**登录后立刻在“账户”页改密码**。首次启动会自动建库建表并创建管理员，`ADMIN_PASSWORD` 只在数据库为空时使用。

内存小于 2 GB 的机器（例如 1 GB 小 VPS）请保留仓库里的 `docker-compose.override.yml`：
它把各服务上限压到 256–800 MB、worker 并发降到 1，另请务必开 swap，否则 LibreOffice 容易被 OOM 杀掉。

上 HTTPS（Caddy 自动证书、反代示例、外部数据库、扩容）见 [docs/deployment.md](docs/deployment.md)。

## 使用教程

1. 打开首页（转换台），在工坊大厅里选**目标格式**，比如「Word 文档（.docx）」。
2. 拖入或选择文件，可一次选多个（同一批必须转成同一个目标格式）。
3. 选转换参数：PDF 可切换「可编辑 / 版式还原」两种模式；扫描件勾选「扫描件识别（OCR，较慢）」
   （默认 300dpi，40 页以内）。
4. 点「办理转换」——如果还没登录，此时才弹登录/注册框，登录成功后这一单自动继续。
5. 在任务列表看进度，每行显示源文件、**目标格式**、状态与耗时；完成后点文件领取，多个结果可打包成 ZIP。
6. 结果默认保留 2 小时，历史记录页可回看并取消未完成的任务；账号页可改密码、看当日配额。

## 重点能力：PDF 表格 → Word / Excel

这是本项目投入最多的部分，结论先说：

> 有文本层的 PDF（电子生成、可复制文字），在“可编辑”模式下，表格会被识别并重建为**真正的 Word 表格**
> （`w:tbl` / `w:tr` / `w:tc`），带**显式细边框**，不是空格对齐的假表格；转 Excel 时按行列写入单元格，
> 带边框、表头样式和冻结首行。

### PDF → Word（可编辑模式）

- 按单词坐标识别表格，**带边框**和**无边框**（靠列间距、行距判断）都支持。
- 无边框判定要求列与列之间存在**贯穿所有行的空白通道**：两端对齐的正文虽然左右都贴着页边距，
  但行内空隙逐行漂移、凑不出通道，因此段落不会被误判成表格。
- 每个单元格就是一个 Word 表格单元格；表格后紧跟空段落，避免相邻表格被 Word 合并。
- 边框为显式 `<w:tblBorders>`（`#8A94A6` 细线），不依赖 Word 默认样式。
- 表头加粗 + 浅灰底纹 `#F1F5F9`，并设为跨页重复表头；列宽按 PDF 实际列比例固定。
- 标题、制表信息、脚注等非表格文字保留在表格外，作为普通段落。

### PDF → Excel

- **默认把整份 PDF 的正文和表格按阅读顺序放进一个工作表**，不会把每张表拆成单独 sheet，也不会把正文另放一个 sheet。
- 工作表内的正文跨表格列合并并自动换行；只有表格区块带细边框、表头底纹和数值格式。列宽由表格单元格决定，长正文不会把表格列撑得过宽。
- 需要按 PDF 页码归档时，可在转换参数中选择“每页一个工作表”（`sheetMode: "page"`）；页内仍按正文与表格的阅读顺序排列。
- 数字写成数值单元格（金额用 `0.00` 格式），不会全变文本。

### 扫描件：OCR + 图像表格检测

- 勾「扫描件识别（OCR）」后，无文本层页面先用 OCRmyPDF + Tesseract 写入不可见文本层，页面图像不动。
- 表格线在扫描件里是**像素**，所以对判定为扫描页的页面额外以 300dpi 灰度渲染一次，
  用像素连续暗行程找横线/竖线（带线带密度校验，排除色块、字形、logo），再换算回 PDF 坐标，
  与文本层坐标一起装配成带边框表格。
- 触发自动判断：位图面积 ≥ 页面 50% 且矢量表格线不足，或整份文件没有文本层；单次最多 20 页扫描页。
- 同一页上多张上下堆叠、左右边距相同的表格会按笔画断点（共线中断 > 3pt）拆开，不会熔成一张。
- 已有文本层的 PDF 自动跳过 OCR，不重复识别、不变慢；OCR 失败自动降级为版式模式并在任务备注说明。

### 生产实测（2026-11-24）

| 用例 | 结果 |
| --- | --- |
| 数字版 5 页 PDF（4 张表）→ DOCX | 4 张带边框 `w:tbl`（10/6/4/4 行），正文 1945 字（原始 `pdftotext` 1969），无退化 |
| 数字版 5 页 PDF（4 张表）→ XLSX | 默认 1 个工作表：4 张带边框表格与正文按阅读顺序排列 |
| 5 页整份栅格化成纯图片 PDF（`pdftotext` 取 0 字符）→ DOCX | `tables=5 rows=26 cells=98`，正文 1919 字，备注写“其中 5 个来自扫描页图像识别” |
| 同上 → XLSX | 默认 1 个工作表：扫描页识别出的表格仍保留边框、表头与数值格式 |
| 单页扫描件（1 张表） | `tables=2 rows=20 cells=38`，698 字 |
| 单页扫描件（3 张表） | `tables=3 rows=24 cells=37`，XLSX 的同一工作表内有 3 个带边框表格区块 |

### 合并单元格、跨页与能力边界

| 场景 | 结果 |
| --- | --- |
| 合并单元格（`gridSpan` / `vMerge`） | 支持横向、纵向与混合合并，DOCX 输出 `w:gridSpan` / `w:vMerge`，XLSX 输出 `<mergeCell>` |
| 跨页长表格 | 相邻页表头行完全一致时自动合并，保留连续合并单元格；按页拆分时会落在不同工作表 |
| 表格内公式 | 只保留计算结果文字，不重建公式 |
| 三线表、浅色/断续线、倾斜页面 | 表格结构可能识别不全（依赖可见表格线） |
| 带底色的引文块、色块、水印 | 有概率被误判为表格 |
| 版式还原模式 | 外观最接近原 PDF，但整页是图片，文字和表格都不可编辑 |

表格识别是基于坐标与像素的启发式算法，不是万能解析器；重要文件转完请打开确认一遍。

## 支持的转换

| 源类型 | 可转为 |
| --- | --- |
| 图片 PNG / JPG / WebP / GIF / BMP / TIFF / HEIC | PNG、JPG、WebP、GIF、BMP、TIFF、HEIC、PDF |
| PDF | DOCX、ODT、RTF、TXT、XLSX、PPTX、ODP、PNG、JPG |
| 文字文档 DOC / DOCX / ODT / RTF / TXT | PDF、DOC、DOCX、ODT、RTF、TXT |
| 表格 XLS / XLSX / ODS / CSV | PDF、XLS、XLSX、ODS、CSV |
| 演示文稿 PPT / PPTX / ODP | PDF、PPT、PPTX、ODP |
| 视频 MP4 / MOV / MKV / WebM | MP3、WAV、M4A、AAC、FLAC、OGG（只提取音频） |
| 音频 MP3 / WAV / M4A / AAC / FLAC / OGG | 以上音频格式互转 |

- 文字文档、表格、演示文稿之间**不能直接跨类型转换**，需先转 PDF（LibreOffice 无头模式的限制，UI 与 API 同时拦截）。
- 视频不做转码，只提取音轨；一次任务内的文件必须转成同一目标格式。
- 单文件上限 100 MB、单批 20 个文件、PDF 最多处理 200 页。

## HTTP API

所有转换相关接口都需要登录会话；写操作还需 `X-CSRF-Token`（登录与 `/api/auth/me` 会返回）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查（数据库、Redis、角色、版本） |
| `GET` | `/api/formats` | 支持的格式与分类 |
| `POST` | `/api/auth/register` · `login` · `logout` | 注册 / 登录 / 登出 |
| `GET` | `/api/auth/me` | 当前账号与 CSRF token |
| `POST` | `/api/auth/password` | 修改密码 |
| `GET` | `/api/account/usage` | 当日配额用量 |
| `POST` | `/api/jobs` | 创建任务（multipart：`files` + `target` + `options`） |
| `GET` | `/api/jobs` · `/api/jobs/:id` | 任务列表 / 详情 |
| `GET` | `/api/jobs/:id/events` | 进度事件流（SSE） |
| `GET` | `/api/jobs/:id/download` | 下载结果（多文件为 ZIP） |
| `DELETE` | `/api/jobs/:id` | 取消未完成任务 |
| `GET/POST/PATCH/DELETE` | `/api/admin/*` | 统计、用户、任务、审计、设置、清理 |

`options` 形如 `{"pdf":{"mode":"editable","dpi":300,"ocr":true,"sheetMode":"single","secondDetector":true}}`。`mode` 取 `editable`（可编辑）或 `layout`（版式还原）；`secondDetector: true` 启用 pdfplumber 第二检测器做结果融合（默认开启）；PDF 转 Excel 时，`sheetMode` 可取 `single`（默认，全部内容放在一个工作表）或 `page`（每页一个工作表）。

## 配置

全部通过环境变量提供，完整示例见 [.env.example](.env.example)。最常改的：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `COOKIE_SECRET` | 无（必填） | Cookie 签名密钥，`openssl rand -hex 32` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@example.com` / 无 | 首次启动创建的管理员 |
| `POSTGRES_PASSWORD` | 无（必填） | Compose 用它构造 `DATABASE_URL` |
| `DATABASE_URL` / `DATABASE_SSL` | 无 / `false` | 使用外部或托管 PostgreSQL 时设置 |
| `ALLOW_REGISTRATION` | `true` | 是否允许自助注册 |
| `SECURE_COOKIES` | `false` | 上 HTTPS 后设为 `true` |
| `TRUST_PROXY` | `true` | 前面有反代时保持 `true`；直接暴露公网设为 `false` |
| `FILE_TTL_HOURS` | `2` | 上传与结果保留时长 |
| `MAX_FILE_MB` / `MAX_BATCH_FILES` | `100` / `20` | 单文件上限 / 单批文件数 |
| `DAILY_JOBS` / `DAILY_UPLOAD_MB` / `DAILY_OUTPUT_MB` | `20` / `1024` / `2048` | 每用户每日配额 |
| `WORKER_CONCURRENCY` / `JOB_TIMEOUT_SEC` | `3` / `600` | 并发任务数 / 单任务超时 |
| `PYTHON_TABLE_BIN` | `/opt/convertlab-python/bin/python` | RapidTable 与 pdfplumber 使用的独立 Python 解释器 |

## 本地开发与测试

要求 Node.js **24 或更高版本**（开发直接跑 TS 源码，生产用编译产物）。

```bash
npm ci
cp .env.example .env      # 本地需自行提供 PostgreSQL 与 Redis
npm run dev               # 后端，默认 http://127.0.0.1:8080
npx vite --config web/vite.config.ts   # 前端开发服务器（带 /api 代理）
```

```bash
npm run check                          # 后端类型检查
npx tsc -p web/tsconfig.json --noEmit  # 前端类型检查
npm test                               # 单元 / 转换器 / PDF 表格 / 图像表格（当前 47 项：42 通过、0 失败、5 跳过）
CONVERTLAB_E2E=1 npm test              # 追加真实 LibreOffice / Poppler 的端到端用例
npm run build && npm start             # 生产构建与启动
npm run doctor                         # 检查 LibreOffice、FFmpeg、Poppler、数据库、Redis
```

- 未设置 `CONVERTLAB_API_URL` 时 API 集成测试跳过；未设置 `CONVERTLAB_E2E=1` 时依赖真实转换程序的用例跳过。**跳过不等于通过。**
- `tests/fixtures/table-bordered.pdf`（带边框采购表）与 `table-borderless.pdf`（无边框销售表）覆盖表格识别回归。
- `deploy/verify/smoke.py`（登录 → 上传 → 轮询 → 下载 → 校验 DOCX 的 `w:tbl` 与 XLSX 的 `styles.xml` 边框）用于上线验收。

## 项目结构

```text
src/
  index.ts              进程入口（web / worker 共用）
  worker-main.ts        worker 角色入口
  config.ts             环境变量与默认值
  bootstrap.ts          建目录、迁移、创建首个管理员
  doctor.ts             依赖自检
  http/                 路由、鉴权、CSRF、静态文件、错误映射
  auth/                 scrypt 密码、会话、登录限流
  db/                   PostgreSQL 访问与建表脚本
  jobs/                 BullMQ 队列、worker 池、清理与恢复
  converters/
    pdf-tables.ts          PDF 文本层表格识别、网格装配、跨页合并与检测器融合
    pdf-image-tables.ts    扫描页位图表格线检测（纯 TS 像素处理）
    pdf-plumber.ts         第二检测器，pdfplumber 生成的独立表格结果，用于和主检测结果融合
    pdf-rapid-table.ts     扫描件 300dpi 深度学习表格结构识别与单元格 OCR，RapidTable SLANet Plus 封装
    ooxml.ts               直接生成 DOCX / XLSX / PPTX（不依赖第三方库）
    documents.ts           PDF 与 Office 文档转换流程
    ocr.ts                 OCRmyPDF + Tesseract 封装
    image.ts / media.ts    图片与音视频
web/                    React 19 + Vite 前端（ConvertX 风格界面）
tests/                  单元、转换器、PDF 表格、API 与端到端测试
deploy/                 上线验收脚本（smoke.py、libreoffice_probe.py）
docker/                 容器入口脚本
docs/                   部署、备份、清理、安全、排错文档
```

## 部署与运维

- [本次部署记录（线上实例）](docs/this-server.md) —— 机器规格、内存调优、实测与风险项
- [部署指南](docs/deployment.md) —— Compose、HTTPS 反代、托管数据库、扩容
- [备份与恢复](docs/backup-restore.md)
- [文件过期与清理策略](docs/retention-cleanup.md)
- [安全设计](docs/security.md)
- [故障排查](docs/troubleshooting.md)
- [HEIC 与中文字体](docs/heic-fonts.md)

## 已知限制

- PDF 表格识别采用双检测器 + 深度学习融合，已覆盖常见合并单元格与相邻页续表；复杂排版、低清晰度扫描件仍需人工核对，旋转页面、公式、图表与批注暂不还原。
- 扫描件需手动开 OCR 才能识别文字与表格；OCR 上限 40 页 / 约 3 分钟，图像表格检测上限 20 页，超出部分只重建文字。
- OCR 目前只支持中文简体与英文；错字、倾斜、小字、手写需人工校对。
- 版式还原模式输出整页图片，文字与表格不可编辑。
- Office 跨类型（文字 ↔ 表格 ↔ 演示）转换被禁止，需先转 PDF；视频只提取音频。
- 单机部署，除多租户（每用户）隔离外没有组织/团队概念。
- 界面复刻只覆盖视觉与交互：一个任务仍是一次 multipart 提交（没有 ConvertX 的逐文件并发重试与多引擎选择器）。
- 历史记录可取消单个未完成任务，批量删除暂未提供。

## 界面来源与素材授权

- 前端界面对照 [ConvertX](https://github.com/ofoz/ConvertX) 复刻：工坊大厅、格式选择器、格式库、登录/注册、
  历史记录和账号页沿用了它的布局、配色、字体层级与交互节奏，在本仓库重新实现为 React 19 + Vite 组件（`web/`）。
  复刻范围是界面与交互，后端转换、鉴权、配额与任务队列均为本仓库自己的实现。
  ConvertX 以 **AGPL-3.0** 授权，界面样式与结构的来源说明保留在本 README 与 `web/public/characters/` 中。
- 角色立绘、大厅插图等美术素材来自 [JAdpp/dsh-whale-galgame](https://github.com/JAdpp/dsh-whale-galgame)
  （commit `bdfe1e4`），以 **CC BY-NC-SA 4.0** 授权：保留署名、仅限非商业用途、改编作品同协议共享。
  完整署名链、素材清单与哈希见 [`web/public/characters/ATTRIBUTION.md`](web/public/characters/ATTRIBUTION.md)。
- 若要用于商业场景，请先替换这些美术素材，并自行确认 ConvertX 界面复刻在 AGPL-3.0 下的义务。

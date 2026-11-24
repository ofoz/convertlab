# HEIC 与中文字体

这两类问题都和运行镜像里的本地依赖有关：HEIC 依赖 `libheif`，中文显示依赖 CJK 字体。官方镜像已经预装，下面的内容用于自定义镜像、排查和更换基础镜像时参考。

## 一、HEIC / HEIF 支持

### 镜像里有什么

| 组件 | 作用 |
| --- | --- |
| `libheif-examples` | 提供 libheif 命令行工具，需要时用于排查 |
| `ffmpeg`（Debian 构建，带 libheif 解码器） | 实际的 HEIC 解码路径 |
| `sharp`（npm 依赖，内置 libvips） | 图片缩放、格式转换、质量参数 |

转换流程：HEIC 文件先由 FFmpeg 解码为 PNG（`decoded.png`），再交给 sharp 做缩放、旋转、背景填充和编码。这样即使 sharp 的 libvips 没有编译 HEIF 支持，HEIC 也能正常工作。

### 验证

```bash
docker compose exec web ffmpeg -hide_banner -decoders | grep -i heif
docker compose exec web ffmpeg -hide_banner -i /path/to/test.heic -f null -
```

第一条有输出说明解码器存在；第二条能读出分辨率说明文件本身正常。

### 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `无法解码 HEIC/HEIF 图片` | FFmpeg 不带 libheif，或文件是 HEIC 的罕见变体（如 10-bit HDR） | 换 JPG/PNG；或重建镜像时确认 `ffmpeg` 来自 Debian 官方源 |
| 图片方向倒了 | EXIF 方向信息异常 | 转换时会按 EXIF 自动旋转（`.rotate()`），如仍有问题在手机端先导出为 JPG |
| 透明背景变黑 | HEIC 不支持透明，原图可能是 HEIF 序列 | 指定背景色 `#ffffff` 重新转换 |
| 转换很慢 / 内存高 | 超大分辨率 HEIC（如 48MP） | 降低单文件上限或先压缩 |

### 自定义镜像时

不要把 `ffmpeg` 换成静态编译的精简版本，很多静态构建去掉了 libheif。Debian 的 `ffmpeg` 包默认支持 HEIC 解码。

## 二、中文字体

### 镜像里有什么

```dockerfile
fonts-noto-cjk          # 思源黑体/宋体，覆盖简体、繁体、日文、韩文
fonts-noto-color-emoji  # 彩色 emoji，避免转 PDF 时 emoji 变方块
fontconfig              # 字体匹配与缓存
```

构建时执行了 `fc-cache -f` 预生成缓存，运行时 `HOME=/home/app` 可写，LibreOffice 不会因为字体缓存问题启动失败。

### 验证

```bash
docker compose exec web fc-list :lang=zh | head
docker compose exec web fc-match "Noto Sans CJK SC"
docker compose exec web fc-match "宋体"
```

- 前两条应返回具体字体文件路径。
- 第三条通常返回 Noto Sans CJK（说明做了合理替代），这是正常的。

### 中文变方框 / 乱码

1. 确认镜像里确实有字体（上面第一条命令）。
2. 如果自己改过 Dockerfile，确认没有删掉 `fonts-noto-cjk`。
3. 检查 `LANG` / `LC_ALL`：镜像默认 `C.UTF-8`，如果改成 `POSIX` 可能导致部分工具按单字节处理。
4. 原文档指定了本机没有的商业字体（宋体、微软雅黑、方正系列），LibreOffice 会用 Noto 替代，**字形会变但文字不会丢**。需要完全一致的外观，请把字体文件放进镜像：

```dockerfile
COPY fonts/*.ttf /usr/share/fonts/truetype/custom/
RUN fc-cache -f
```

注意商业字体有授权限制，确认许可后再打包。

### PDF 里嵌入的字体

PDF 转 Word/Excel 时用的是文本层内容，不依赖本机字体；PDF 转图片、PDF 转 PPT 的版式模式由 Poppler 渲染，字体已在 PDF 内嵌，也不受影响。真正受影响的是 **Office 文档转 PDF**，此时需要本机字体。

### Emoji

`fonts-noto-color-emoji` 提供彩色 emoji。LibreOffice 导出 PDF 时对彩色字体的支持有限，emoji 可能显示为单色或方框；这是 LibreOffice 的已知限制，不是字体缺失。

## 三、自定义镜像检查清单

- [ ] `ffmpeg` 带 libheif 解码器（`ffmpeg -decoders | grep heif`）
- [ ] `pdftoppm`、`pdftotext`、`pdfinfo` 可用（`poppler-utils`）
- [ ] `gs` 可用（`ghostscript`）
- [ ] `soffice` 可用（`libreoffice-core` + `libreoffice-writer/calc/impress`）
- [ ] `fc-list :lang=zh` 有输出
- [ ] `HOME` 对运行用户可写，`fc-cache -f` 能成功
- [ ] 运行用户 UID 10001，`/data` 属主正确
- [ ] `docker compose exec web node dist/server/doctor.js` 全部 OK

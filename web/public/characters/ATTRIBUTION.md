# Character artwork attribution

Source: [JAdpp/dsh-whale-galgame](https://github.com/JAdpp/dsh-whale-galgame), pinned at commit `bdfe1e481815b6292f48b3badb6c037ae7df4bca` (resolved using the GitHub commits API). All source URLs and individual local SHA-256 hashes are recorded in [assets.json](assets.json).

These are **unofficial fan designs**, not company-official artwork or endorsements. The artwork is distributed under **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)**: preserve attribution, use only on noncommercial terms, and share adaptations under the same license. The upstream grant for project-made AI-assisted artwork applies only to the extent the maintainer holds applicable rights. This directory's artwork terms do not replace the project's software license.

## Artists and attribution chain

DeepSeek / whale-girl material preserves the full chain:

1. **上善** — original whale-girl character: [Pixiv](https://www.pixiv.net/users/62155430), [Bilibili](https://space.bilibili.com/4456176).
2. **ZipZipPipe** — maid whale-girl redesign incorporating DeepSeek elements: [Pixiv](https://www.pixiv.net/users/18604994), [Bilibili](https://space.bilibili.com/4168597).
3. **Small-tailqwq / dsh-deep-whale** — publisher of the [maid-atelier skin](https://github.com/Small-tailqwq/dsh-deep-whale/tree/main/maid-atelier), with the original standing sprite and preserved credits.
4. **JAdpp / dsh-whale-galgame** — redistribution and expression preparation; AI-assisted pet redraw and workshop atlases following the credited character designs.

**Claude and GPT standing designs are by ZipZipPipe**, from the [original Bilibili post](https://www.bilibili.com/opus/1233069202138464289), under CC BY-NC-SA 4.0. Upstream removed white backgrounds, cropped each figure, and converted to transparent WebP (lossy q95). Their standing files here are renamed copies with no further image changes.

The current pet atlas is upstream AI-assisted artwork made with Codex's built-in image generator, whose exact model version is not exposed, referencing the chibi appearance and gaze frames from [f0909172434/dsh-deepseek-girl-pet](https://github.com/f0909172434/dsh-deepseek-girl-pet). The whale-girl design retains 上善 → ZipZipPipe; the broader reused assets retain Small-tailqwq as above. No pet integration code is copied here.

Workshop images were found online in the pinned repository. Upstream generated them using Codex's built-in image generator (exact model version not exposed), following the existing unofficial character designs. They were **not generated locally for this prototype**. Local image crops, if listed in the manifest, are clearly identified as local derivatives and remain CC BY-NC-SA 4.0.

## Local copies and presentation

| Local asset | Upstream source | Modifications here |
| --- | --- | --- |
| deepseek-standing.webp | assets/default/maid-left.webp | Renamed copy; upstream reports a byte-identical maid-atelier sprite |
| claude.webp | assets/default/claude-zipzippipe.webp | Renamed copy |
| gpt.webp | assets/default/gpt-zipzippipe.webp | Renamed copy |
| whale-cheerful.webp, whale-serious.webp, whale-exasperated.webp, whale-starry.webp | Same filenames in assets/default | None |
| pet-dafeiyu.webp | assets/default/pet-dafeiyu.webp | None |
| leisure-actions.webp, residents-atlas-builtin.webp, workstations-rpg-atlas.webp | Same filenames in assets/workshop | None |
| crop-*.webp | Crop of a downloaded atlas | Exact crop coordinates and source SHA-256 in assets.json; lossless WebP export |

DeepSeek's full-size standing image is a real single-palm welcoming pose: one hand is raised and the other holds her skirt. No source frame of opening both arms to receive a file has been verified. The pet atlas has an outstretched-arms falling/imbalance frame; it is not relabeled as receiving a file. Expression variants are expression changes, not new body poses. The webpage adds local CSS/SVG room scenery, desks, monitors, paper props and sleeve/hand rigs as presentation adaptations. Project preview images are locally captured composite screenshots, not additional artwork found online.

The inspected pet atlas **does contain native seated laptop work** in zero-based row 1, columns 3–5. The local `crop-deepseek-work-0.webp` through `crop-deepseek-work-2.webp` preserve those exact cells (384 × 512). `crop-deepseek-idle.webp` is the sleeping standing pose with a sleep bubble; `crop-deepseek-sleepy.webp` rubs an eye; `crop-deepseek-meal-0.webp` and `crop-deepseek-meal-1.webp` eat rice. These crops are local derivatives of the online atlas, not newly drawn or independently sourced pictures.

## Atlas layout and limits

- **pet-dafeiyu.webp:** current 2304 × 3584 atlas, 6 columns × 7 rows, 384 × 512 per cell; 40 named frames plus 2 unused cells, foot line y = 498. The first four rows contain 24 work/waiting/meal/idle/hover/carry/landing frames; the final rows contain 16 gaze frames. This replaces the old pet-spritesheet.webp; the current pinned README and actual dimensions take precedence over older descriptions.
- **leisure-actions.webp:** 1536 × 1024, 6 columns × 4 rows, 256 × 256 cells. Columns are DeepSeek, Claude, GPT, Gemini, Kimi, Grok; four rows form each character's four-frame leisure cycle. DeepSeek eats rice, Claude reads, GPT holds a miniature galaxy.
- **residents-atlas-builtin.webp:** 1536 × 1024, 6 columns × 4 rows. Only row 0 is active idle artwork upstream. Rows 1–3 are deprecated; upstream documents an extra-hand defect in the old Grok work frame.
- **workstations-rpg-atlas.webp:** 1374 × 1145, 6 columns × 5 rows, 229 × 229 cells. Rows: empty, work-a, work-b, work-c, waiting. Character and matching desk/chair are a single composite frame. Upstream explicitly uses no computer screens: DeepSeek adjusts a tidal instrument, Claude edits with a quill, GPT drafts with a compass. The prototype may add a computer visually, but the source must not be claimed to already contain one.

## Responsive display derivatives

For browser rendering efficiency, seven original transparent standing portraits have local **display-only WebP derivatives** at 384 px and 768 px widths. They are downscaled proportionally with Lanczos resampling and lossy WebP quality 90; the original images remain unchanged and are retained both as the default `src` and as the final `srcset` fallback. Browser `srcset`/`sizes` lets ordinary-density screens choose a smaller decoded portrait while high-density screens can choose the larger derivative or original. This is only responsive delivery: no pose, framing, animation rig, or eye/hand coordinate was altered.

The derivatives inherit each source portrait's authors and CC BY-NC-SA 4.0 attribution. [assets.json](assets.json) records every derivative's exact `sourceSha256`, source URL, dimensions, output SHA-256, output size, authors, and license under `localDerivedAssets`; those source hashes identify the unchanged full-resolution originals and can be checked against the original `assets` records.

## Preserved source records

Original upstream texts are preserved locally as [upstream-NOTICE.md](upstream-NOTICE.md), [upstream-LICENSE.md](upstream-LICENSE.md), [upstream-default-README.md](upstream-default-README.md), [upstream-workshop-README.md](upstream-workshop-README.md), and [upstream-workshop-manifest.json](upstream-workshop-manifest.json). Applicable earlier whale-art texts are preserved under [licenses/dsh-deep-whale-LICENSE.txt](licenses/dsh-deep-whale-LICENSE.txt) and [licenses/dsh-deep-whale-NOTICE.txt](licenses/dsh-deep-whale-NOTICE.txt). These copies retain the exact downloaded upstream text.

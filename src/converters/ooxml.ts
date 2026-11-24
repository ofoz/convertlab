import { buildZip, type ZipEntry } from './zip.ts';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters that make Office refuse to open a file.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_IMAGE = `${NS_R}/image`;
const REL_OFFICE = `${NS_R}/officeDocument`;
const REL_SLIDE = `${NS_R}/slide`;
const REL_MASTER = `${NS_R}/slideMaster`;
const REL_LAYOUT = `${NS_R}/slideLayout`;
const REL_THEME = `${NS_R}/theme`;
const REL_WORKSHEET = `${NS_R}/worksheet`;
const REL_STYLES = `${NS_R}/styles`;
const CT_PML = 'application/vnd.openxmlformats-officedocument.presentationml';
const CT_WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const CT_SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const THEME_XML = `${XML_DECL}<a:theme xmlns:a="${NS_A}" name="ConvertLab"><a:themeElements><a:clrScheme name="ConvertLab"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1E3A8A"/></a:dk2><a:lt2><a:srgbClr val="E5E7EB"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="0EA5E9"/></a:accent2><a:accent3><a:srgbClr val="14B8A6"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="8B5CF6"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="ConvertLab"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="ConvertLab"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

export type PageImage = { data: Buffer; format: 'jpg' | 'png'; widthPx: number; heightPx: number };

const EMU_PER_PX = 9525;
const PPTX_CX = 12192000;
const PPTX_CY = 6858000;

export function fitBox(widthPx: number, heightPx: number, boxW: number, boxH: number): { cx: number; cy: number } {
  if (widthPx <= 0 || heightPx <= 0) return { cx: boxW, cy: boxH };
  const scale = Math.min(boxW / widthPx, boxH / heightPx);
  return { cx: Math.round(widthPx * scale), cy: Math.round(heightPx * scale) };
}

/** Builds a one-slide-per-page PPTX where each slide holds the page rendering. */
export function buildPptxFromImages(pages: PageImage[]): Buffer {
  const entries: ZipEntry[] = [];
  const overrides = (n: number) =>
    Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT_PML}.slide+xml"/>`).join('');

  entries.push({
    name: '[Content_Types].xml',
    data: `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="${CT_PML}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT_PML}.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT_PML}.slideLayout+xml"/>${overrides(pages.length)}<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT_PML}.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  });
  entries.push({
    name: '_rels/.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_OFFICE}" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${NS_R}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  });
  entries.push({
    name: 'docProps/core.xml',
    data: `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>PDF pages</dc:title><dc:creator>ConvertLab</dc:creator></cp:coreProperties>`,
  });
  entries.push({
    name: 'docProps/app.xml',
    data: `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ConvertLab</Application></Properties>`,
  });

  const slideIds = pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  entries.push({
    name: 'ppt/presentation.xml',
    data: `${XML_DECL}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${PPTX_CX}" cy="${PPTX_CY}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  });
  const slideRels = pages.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL_SLIDE}" Target="slides/slide${i + 1}.xml"/>`).join('');
  entries.push({
    name: 'ppt/_rels/presentation.xml.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_MASTER}" Target="slideMasters/slideMaster1.xml"/>${slideRels}<Relationship Id="rId${pages.length + 2}" Type="${REL_THEME}" Target="theme/theme1.xml"/></Relationships>`,
  });
  entries.push({ name: 'ppt/theme/theme1.xml', data: THEME_XML });
  entries.push({
    name: 'ppt/slideMasters/slideMaster1.xml',
    data: `${XML_DECL}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200"/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  });
  entries.push({
    name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_LAYOUT}" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL_THEME}" Target="../theme/theme1.xml"/></Relationships>`,
  });
  entries.push({
    name: 'ppt/slideLayouts/slideLayout1.xml',
    data: `${XML_DECL}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  });
  entries.push({
    name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_MASTER}" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  });

  pages.forEach((page, index) => {
    const n = index + 1;
    const { cx, cy } = fitBox(page.widthPx, page.heightPx, PPTX_CX, PPTX_CY);
    const offX = Math.round((PPTX_CX - cx) / 2);
    const offY = Math.round((PPTX_CY - cy) / 2);
    const media = `page-${n}.${page.format}`;
    entries.push({ name: `ppt/media/${media}`, data: page.data });
    entries.push({
      name: `ppt/slides/slide${n}.xml`,
      data: `${XML_DECL}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${n}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${offX}" y="${offY}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    });
    entries.push({
      name: `ppt/slides/_rels/slide${n}.xml.rels`,
      data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_IMAGE}" Target="../media/${media}"/></Relationships>`,
    });
  });

  return buildZip(entries);
}

const TWIPS_PER_PX = 15;

/** Builds a DOCX where each PDF page is a full-page image (layout-preserving mode). */
export function buildDocxFromImages(pages: PageImage[]): Buffer {
  const entries: ZipEntry[] = [];
  const headers = pages
    .map((page, index) => {
      const n = index + 1;
      const media = `page-${n}.${page.format}`;
      entries.push({ name: `word/media/${media}`, data: page.data });
      const maxWidth = 12_000;
      const maxHeight = 15_840;
      const scale = Math.min(maxWidth / page.widthPx, maxHeight / page.heightPx, 15);
      const cx = Math.round(page.widthPx * scale * EMU_PER_PX * 0.5);
      const cy = Math.round(page.heightPx * scale * EMU_PER_PX * 0.5);
      const breakXml = index === 0 ? '' : '<w:pageBreakBefore/>';
      return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/>${breakXml}</w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Page ${n}"/><a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${media}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    })
    .join('');

  const first = pages[0] ?? { widthPx: 1224, heightPx: 1584, format: 'jpg' as const, data: Buffer.alloc(0) };
  const pageW = Math.max(3000, Math.min(31_680, Math.round(first.widthPx * TWIPS_PER_PX)));
  const pageH = Math.max(3000, Math.min(31_680, Math.round(first.heightPx * TWIPS_PER_PX)));

  entries.push({
    name: '[Content_Types].xml',
    data: `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="${CT_WML}.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  });
  entries.push({
    name: '_rels/.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_OFFICE}" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  });
  entries.push({
    name: 'docProps/core.xml',
    data: `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>PDF pages</dc:title><dc:creator>ConvertLab</dc:creator></cp:coreProperties>`,
  });
  const imageRels = pages
    .map((page, index) => `<Relationship Id="rId${index + 1}" Type="${REL_IMAGE}" Target="media/page-${index + 1}.${page.format}"/>`)
    .join('');
  entries.push({ name: 'word/_rels/document.xml.rels', data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">${imageRels}</Relationships>` });
  entries.push({
    name: 'word/document.xml',
    data: `${XML_DECL}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"><w:body>${headers}<w:sectPr><w:pgSz w:w="${pageW}" w:h="${pageH}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  });

  return buildZip(entries);
}

export type DocBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; rows: string[][]; columnWeights?: number[] };

const DOCX_PAGE_W = 11_906;
const DOCX_PAGE_H = 16_838;
const DOCX_MARGIN = 1_134;
const DOCX_CONTENT_W = DOCX_PAGE_W - DOCX_MARGIN * 2;

const DOCX_STYLES = `${XML_DECL}<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei" w:cs="Aptos"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1E3A8A"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>`;

function docxParagraph(text: string, style?: 'Title' | 'Heading1'): string {
  const styleXml = style ? `<w:pStyle w:val="${style}"/>` : '';
  const lines = text.split(/\r?\n/);
  return lines
    .map((line) => `<w:p><w:pPr>${styleXml}<w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(line) || ' '}</w:t></w:r></w:p>`)
    .join('');
}

function docxCell(text: string, widthTwips: number, header: boolean): string {
  const shading = header ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : '';
  const runProps = header ? '<w:rPr><w:b/><w:color w:val="0F172A"/></w:rPr>' : '';
  const lines = text.split(/\r?\n/);
  const paragraphs = lines
    .map((line) => `<w:p><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:r>${runProps}<w:t xml:space="preserve">${escapeXml(line) || ' '}</w:t></w:r></w:p>`)
    .join('');
  return `<w:tc><w:tcPr><w:tcW w:w="${widthTwips}" w:type="dxa"/><w:vAlign w:val="center"/>${shading}</w:tcPr>${paragraphs}</w:tc>`;
}

function docxTable(rows: string[][], weights?: number[]): string {
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''));
  const rawWeights = Array.from({ length: columnCount }, (_, index) => Math.max(8, Number(weights?.[index]) || 12));
  const weightTotal = rawWeights.reduce((sum, value) => sum + value, 0);
  let widths = rawWeights.map((value) => Math.max(650, Math.round((value / weightTotal) * DOCX_CONTENT_W)));
  const widthTotal = widths.reduce((sum, value) => sum + value, 0);
  if (widthTotal !== DOCX_CONTENT_W) {
    const scale = DOCX_CONTENT_W / widthTotal;
    widths = widths.map((value) => Math.max(500, Math.round(value * scale)));
    const delta = DOCX_CONTENT_W - widths.reduce((sum, value) => sum + value, 0);
    widths[widths.length - 1] = widths[widths.length - 1]! + delta;
  }

  const borders = '<w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="8A94A6"/><w:left w:val="single" w:sz="6" w:space="0" w:color="8A94A6"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="8A94A6"/><w:right w:val="single" w:sz="6" w:space="0" w:color="8A94A6"/><w:insideH w:val="single" w:sz="6" w:space="0" w:color="8A94A6"/><w:insideV w:val="single" w:sz="6" w:space="0" w:color="8A94A6"/></w:tblBorders>';
  const tblPr = `<w:tblPr><w:tblW w:w="${DOCX_CONTENT_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}<w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
  const grid = `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;
  const body = normalized
    .map((row, rowIndex) => {
      const props = rowIndex === 0 ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>';
      return `<w:tr>${props}${row.map((cell, index) => docxCell(cell, widths[index]!, rowIndex === 0)).join('')}</w:tr>`;
    })
    .join('');
  return `<w:tbl>${tblPr}${grid}${body}</w:tbl><w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="auto"/></w:pPr></w:p>`;
}

/** Builds a DOCX with editable paragraphs and real Word tables (explicit borders). */
export function buildDocxFromBlocks(blocks: DocBlock[], options: { title?: string } = {}): Buffer {
  const entries: ZipEntry[] = [];
  const body = blocks
    .map((block) => {
      if (block.type === 'table') return docxTable(block.rows, block.columnWeights);
      if (block.type === 'heading') return docxParagraph(block.text, 'Heading1');
      return docxParagraph(block.text);
    })
    .join('');
  const title = options.title ? docxParagraph(options.title, 'Title') : '';

  entries.push({
    name: '[Content_Types].xml',
    data: `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${CT_WML}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${CT_WML}.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  });
  entries.push({
    name: '_rels/.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_OFFICE}" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  });
  entries.push({
    name: 'docProps/core.xml',
    data: `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(options.title ?? 'Converted document')}</dc:title><dc:creator>ConvertLab</dc:creator></cp:coreProperties>`,
  });
  entries.push({
    name: 'word/_rels/document.xml.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  });
  entries.push({ name: 'word/styles.xml', data: DOCX_STYLES });
  entries.push({
    name: 'word/document.xml',
    data: `${XML_DECL}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${title}${body}<w:sectPr><w:pgSz w:w="${DOCX_PAGE_W}" w:h="${DOCX_PAGE_H}"/><w:pgMar w:top="${DOCX_MARGIN}" w:right="${DOCX_MARGIN}" w:bottom="${DOCX_MARGIN}" w:left="${DOCX_MARGIN}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  });
  return buildZip(entries);
}

export type SheetTableRange = {
  /** First and last row that belong to this table (zero-based, inclusive). */
  startRow: number;
  endRow: number;
  /** Style the first row as a table header and freeze it in single-table sheets. */
  headerRow?: boolean;
};

export type SheetMerge = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

export type SheetSpec = {
  name: string;
  rows: string[][];
  /** Adds a visible cell border to every written cell (single-table sheets). */
  table?: boolean;
  /** Applies the header style (bold on a light fill) to the first row. */
  headerRow?: boolean;
  /** Table blocks inside a mixed sheet; rows outside these ranges stay plain text. */
  tables?: SheetTableRange[];
  /** Merged cells, for example a paragraph spanning the table width. */
  merges?: SheetMerge[];
  /** Optional custom row heights in points; zero keeps the default. */
  rowHeights?: number[];
  /** Column widths in Excel character units. */
  columnWidths?: number[];
  /** Relative column widths taken from the source layout (for example PDF table geometry). */
  columnWeights?: number[];
};

function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

const XLSX_STYLES = `${XML_DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FF8A94A6"/></left><right style="thin"><color rgb="FF8A94A6"/></right><top style="thin"><color rgb="FF8A94A6"/></top><bottom style="thin"><color rgb="FF8A94A6"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Approximates Excel's character-width unit, counting CJK glyphs as double width. */
export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    width += code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)) ? 2 : 1;
  }
  return width;
}

function numericCell(value: string): boolean {
  return /^-?(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,10})?$/.test(value.trim());
}

/** Target total width in Excel character units for a data table sheet. */
const TABLE_TOTAL_WIDTH = 116;

/**
 * Columns whose values are all short numbers (row numbers, counts) read better
 * centered; long numbers such as amounts stay right aligned.
 */
function centeredColumns(sheet: SheetSpec): Set<number> {
  const centered = new Set<number>();
  if (sheet.table !== true) return centered;
  const columnCount = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (let column = 0; column < columnCount; column += 1) {
    const values = sheet.rows
      .slice(sheet.headerRow === false ? 0 : 1)
      .map((row) => String(row[column] ?? '').trim())
      .filter((value) => value.length > 0);
    if (values.length === 0) continue;
    const shortNumbers = values.every((value) => numericCell(value) && displayWidth(value) <= 4);
    if (shortNumbers) centered.add(column);
  }
  return centered;
}

/** Columns where every value is written with exactly two decimals (amounts). */
function moneyColumns(sheet: SheetSpec): Set<number> {
  const money = new Set<number>();
  if (sheet.table !== true) return money;
  const columnCount = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (let column = 0; column < columnCount; column += 1) {
    const values = sheet.rows
      .slice(sheet.headerRow === false ? 0 : 1)
      .map((row) => String(row[column] ?? '').trim())
      .filter((value) => value.length > 0);
    if (values.length === 0) continue;
    const amounts = values.filter((value) => numericCell(value));
    // Placeholder cells ("—", "-", "/") are common in total rows; they must not
    // drop the column back to General formatting.
    if (amounts.length >= 2 && amounts.every((value) => /^-?(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/.test(value))) money.add(column);
  }
  return money;
}

function columnWidthsFor(sheet: SheetSpec, maxColumns: number): number[] {
  const weights = sheet.columnWeights ?? [];
  const weightSum = weights.reduce((sum, weight) => sum + (Number.isFinite(weight) && weight > 0 ? weight : 0), 0);
  return Array.from({ length: maxColumns }, (_, column) => {
    const explicit = sheet.columnWidths?.[column];
    if (typeof explicit === 'number' && Number.isFinite(explicit)) return Math.min(80, Math.max(8, explicit));
    const longest = sheet.rows.reduce((max, row) => Math.max(max, displayWidth(String(row[column] ?? ''))), 0);
    const textWidth = Math.round(longest * 1.2 + 3);
    const weight = weights[column];
    if (weightSum > 0 && typeof weight === 'number' && weight > 0) {
      const proportional = Math.round((weight / weightSum) * TABLE_TOTAL_WIDTH);
      return Math.min(60, Math.max(Math.min(24, Math.max(8, textWidth)), proportional));
    }
    return Math.min(60, Math.max(10, textWidth));
  });
}

/** Builds an XLSX from rows; with `table: true` every cell gets a visible border. */
export function buildXlsx(sheets: SheetSpec[]): Buffer {
  const entries: ZipEntry[] = [];
  const safeSheets = sheets.length > 0 ? sheets : [{ name: 'Sheet1', rows: [] }];
  const sheetOverrides = safeSheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="${CT_SML}.worksheet+xml"/>`)
    .join('');

  entries.push({
    name: '[Content_Types].xml',
    data: `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT_SML}.sheet.main+xml"/>${sheetOverrides}<Override PartName="/xl/styles.xml" ContentType="${CT_SML}.styles+xml"/></Types>`,
  });
  entries.push({
    name: '_rels/.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_OFFICE}" Target="xl/workbook.xml"/></Relationships>`,
  });
  entries.push({
    name: 'xl/workbook.xml',
    data: `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}"><sheets>${safeSheets
      .map((sheet, index) => `<sheet name="${escapeXml(sheet.name.slice(0, 31) || `Sheet${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join('')}</sheets></workbook>`,
  });
  entries.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">${safeSheets
      .map((_, index) => `<Relationship Id="rId${index + 1}" Type="${REL_WORKSHEET}" Target="worksheets/sheet${index + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${safeSheets.length + 1}" Type="${REL_STYLES}" Target="styles.xml"/></Relationships>`,
  });
  entries.push({ name: 'xl/styles.xml', data: XLSX_STYLES });

  safeSheets.forEach((sheet, index) => {
    const wholeTable = sheet.table === true;
    const centered = centeredColumns(sheet);
    const money = moneyColumns(sheet);
    const ranges = sheet.tables ?? [];
    const rowsXml = sheet.rows.slice(0, 5000).map((row, rowIndex) => {
      const range = ranges.find((entry) => rowIndex >= entry.startRow && rowIndex <= entry.endRow);
      const tableCell = wholeTable || range !== undefined;
      const headerCell = wholeTable
        ? rowIndex === 0 && sheet.headerRow !== false
        : range?.headerRow === true && rowIndex === range.startRow;
      const cells = row.slice(0, 100).map((value, colIndex) => {
        if (value === '') return '';
        const ref = `${columnName(colIndex)}${rowIndex + 1}`;
        const text = String(value);
        const numeric = tableCell && numericCell(text);
        const shortNumber = tableCell && numeric && displayWidth(text) <= 4;
        const amount = numeric && /^-?(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/.test(text.trim());
        const style = tableCell
          ? headerCell ? 2 : money.has(colIndex) || amount ? 4 : centered.has(colIndex) || shortNumber ? 3 : 1
          : 5;
        const styleAttr = style > 0 ? ` s="${style}"` : '';
        if (numeric) return `<c r="${ref}"${styleAttr}><v>${text.trim()}</v></c>`;
        return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
      }).join('');
      const customHeight = sheet.rowHeights?.[rowIndex] ?? 0;
      const heightAttr = customHeight > 0 ? ` ht="${customHeight}" customHeight="1"` : '';
      return `<row r="${rowIndex + 1}"${heightAttr}>${cells}</row>`;
    }).join('');

    const maxColumns = sheet.rows.reduce((max, row) => Math.max(max, row.length), 1);
    const widths = columnWidthsFor(sheet, Math.min(maxColumns, 100));
    const colsXml = widths.length
      ? `<cols>${widths.map((width, column) => `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
      : '';
    const views = wholeTable && sheet.headerRow !== false
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const validMerges = (sheet.merges ?? []).filter((merge) =>
      merge.startRow >= 0 && merge.endRow < sheet.rows.length &&
      merge.startColumn >= 0 && merge.endColumn > merge.startColumn && merge.startColumn < 100,
    );
    const mergeCells = validMerges.length
      ? `<mergeCells count="${validMerges.length}">${validMerges.map((merge) => `<mergeCell ref="${columnName(merge.startColumn)}${merge.startRow + 1}:${columnName(Math.min(99, merge.endColumn))}${merge.endRow + 1}"/>`).join('')}</mergeCells>`
      : '';

    entries.push({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${views}<sheetFormatPr defaultRowHeight="16"/>${colsXml}<sheetData>${rowsXml}</sheetData>${mergeCells}<printOptions horizontalCentered="0" verticalCentered="0"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`,
    });
  });

  return buildZip(entries);
}

/** Builds a PPTX where each PDF page becomes an editable text slide. */
export function buildPptxFromText(pages: string[][]): Buffer {
  const entries: ZipEntry[] = [];
  const count = Math.max(1, pages.length);
  const overrides = Array.from({ length: count }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT_PML}.slide+xml"/>`).join('');

  entries.push({
    name: '[Content_Types].xml',
    data: `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT_PML}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT_PML}.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT_PML}.slideLayout+xml"/>${overrides}<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT_PML}.theme+xml"/></Types>`,
  });
  entries.push({ name: '_rels/.rels', data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_OFFICE}" Target="ppt/presentation.xml"/></Relationships>` });
  const slideIds = Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  entries.push({
    name: 'ppt/presentation.xml',
    data: `${XML_DECL}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${PPTX_CX}" cy="${PPTX_CY}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  });
  const slideRels = Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 2}" Type="${REL_SLIDE}" Target="slides/slide${i + 1}.xml"/>`).join('');
  entries.push({
    name: 'ppt/_rels/presentation.xml.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_MASTER}" Target="slideMasters/slideMaster1.xml"/>${slideRels}<Relationship Id="rId${count + 2}" Type="${REL_THEME}" Target="theme/theme1.xml"/></Relationships>`,
  });
  entries.push({ name: 'ppt/theme/theme1.xml', data: THEME_XML });
  entries.push({
    name: 'ppt/slideMasters/slideMaster1.xml',
    data: `${XML_DECL}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200"/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  });
  entries.push({
    name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_LAYOUT}" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL_THEME}" Target="../theme/theme1.xml"/></Relationships>`,
  });
  entries.push({
    name: 'ppt/slideLayouts/slideLayout1.xml',
    data: `${XML_DECL}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  });
  entries.push({
    name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${REL_MASTER}" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  });

  for (let index = 0; index < count; index += 1) {
    const n = index + 1;
    const lines = (pages[index] ?? []).slice(0, 60);
    const paragraphs = (lines.length > 0 ? lines : [''])
      .map((line) => `<a:p><a:r><a:rPr lang="zh-CN" sz="1600"/><a:t>${escapeXml(line.slice(0, 500)) || ' '}</a:t></a:r></a:p>`)
      .join('');
    entries.push({
      name: `ppt/slides/slide${n}.xml`,
      data: `${XML_DECL}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Page ${n} text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="609600"/><a:ext cx="10972800" cy="5638800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    });
    entries.push({ name: `ppt/slides/_rels/slide${n}.xml.rels`, data: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"/>` });
  }
  return buildZip(entries);
}

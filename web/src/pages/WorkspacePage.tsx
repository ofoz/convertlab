import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, downloadUrl, request, subscribeJob, uploadForm, zipUrl } from '../api';
import { FormatLibrary } from '../components/FormatLibrary';
import { FormatPicker, type TargetChoice } from '../components/FormatPicker';
import { ServiceHall, type HallStage } from '../components/ServiceHall';
import { SymbolIcon, type SymbolName } from '../components/Symbols';
import { buildCatalog, buildTargets } from '../data/catalog';
import { useSession } from '../session';
import type { ConversionOptions, FormatInfo, FormatsResponse, Job, JobStatus } from '../types';
import { fileExtension, formatBytes } from '../utils';

const TERMINAL: JobStatus[] = ['success', 'partial', 'failed', 'cancelled'];

type Picked = { key: string; file: File; ext: string };

const STEP_LABELS = ['choose', 'receive', 'work', 'collect'] as const;

const BUSINESS_STEPS: ReadonlyArray<{
  label: string;
  description: string;
  icon: SymbolName;
}> = [
  { label: '选择格式', description: '告诉我想转换成什么格式', icon: 'grid' },
  { label: '交给鲸鱼娘', description: '上传一个或多个待处理文件', icon: 'upload' },
  { label: '耐心等一下', description: '后台处理，进度会实时更新', icon: 'sparkles' },
  { label: '取走文件', description: '转换完成后下载结果文件', icon: 'download' },
];

function stepIndex(stage: HallStage): number {
  if (stage === 'welcome' || stage === 'choosing') return 0;
  if (stage === 'receiving' || stage === 'uploading' || stage === 'placing' || stage === 'error') return 1;
  if (stage === 'working') return 2;
  return 3;
}

const STATUS_TEXT: Record<string, string> = {
  pending: '排队中',
  processing: '办理中',
  success: '已办好',
  failed: '未办成',
  cancelled: '已取消',
};

export default function WorkspacePage() {
  const { user, usage, quotas, setUsage, refresh } = useSession();

  const [formats, setFormats] = useState<FormatsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stage, setStage] = useState<HallStage>('welcome');
  const [dialogue, setDialogue] = useState('欢迎光临！今天想把文件转换成什么格式呢？');
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [claimed, setClaimed] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragover, setDragover] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [connectionLost, setConnectionLost] = useState(false);

  const [quality, setQuality] = useState(85);
  const [maxDimension, setMaxDimension] = useState('');
  const [background, setBackground] = useState('#ffffff');
  const [preserveAlpha, setPreserveAlpha] = useState(true);
  const [bitrate, setBitrate] = useState(192);
  const [sampleRate, setSampleRate] = useState('');
  const [channels, setChannels] = useState<'source' | 'mono' | 'stereo'>('source');
  const [pdfMode, setPdfMode] = useState<'editable' | 'layout'>('editable');
  const [pdfDpi, setPdfDpi] = useState(150);
  const [pdfOcr, setPdfOcr] = useState(false);
  const [pdfSecondDetector, setPdfSecondDetector] = useState(true);
  const [pdfSheetMode, setPdfSheetMode] = useState<'single' | 'page'>('single');
  const [docPdfLayout, setDocPdfLayout] = useState<'editable' | 'layout'>('editable');

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef<null | (() => void)>(null);
  const pollRef = useRef<number | null>(null);

  const [prefill] = useState(() => {
    const raw = window.location.hash;
    const index = raw.indexOf('?');
    const fromQuery = index < 0 ? '' : new URLSearchParams(raw.slice(index + 1)).get('to');
    const stored = window.sessionStorage.getItem('convertlab:prefill');
    window.sessionStorage.removeItem('convertlab:prefill');
    return (fromQuery ?? stored ?? '').trim().toLowerCase().replace(/^\./, '');
  });

  useEffect(() => {
    let active = true;
    request<FormatsResponse>('/api/formats')
      .then((payload) => {
        if (active) setFormats(payload);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : '无法读取支持的格式列表');
      });
    return () => {
      active = false;
    };
  }, []);

  const formatMap = useMemo(() => {
    const map = new Map<string, FormatInfo>();
    formats?.formats.forEach((item) => map.set(item.ext, item));
    return map;
  }, [formats]);

  const groups = useMemo(() => buildCatalog(formats), [formats]);
  const allTargets = useMemo(() => buildTargets(groups), [groups]);
  const limits = formats?.limits;

  const allowedTargets = useMemo(() => {
    if (picked.length === 0) return [] as string[];
    let result: string[] | null = null;
    for (const item of picked) {
      const info = formatMap.get(item.ext);
      if (!info) return [];
      const list = info.targets.filter((ext) => ext !== 'zip');
      result = result === null ? [...list] : result.filter((ext) => list.includes(ext));
    }
    return result ?? [];
  }, [picked, formatMap]);

  const pickerTargets = useMemo(() => {
    const allowed = picked.length > 0 ? new Set(allowedTargets) : null;
    const out: Record<string, string[]> = {};
    for (const [engine, list] of Object.entries(allTargets)) {
      const filtered = allowed ? list.filter((format) => allowed.has(format)) : list;
      if (filtered.length > 0) out[engine] = filtered;
    }
    return out;
  }, [allTargets, allowedTargets, picked.length]);

  // 目标格式被文件过滤掉时自动切到第一个兼容格式，并提示保留文件。
  useEffect(() => {
    if (picked.length === 0 || allowedTargets.length === 0) return;
    if (selected && allowedTargets.includes(selected)) return;
    const next = allowedTargets[0];
    if (!next) return;
    setSelected(next);
    setNotice('已保留上传文件。请选择下面兼容的目标格式，无需再次上传。');
  }, [allowedTargets, picked.length, selected]);

  useEffect(() => {
    if (!prefill || selected || picked.length > 0) return;
    const exists = Object.values(allTargets).some((list) => list.includes(prefill));
    if (!exists) return;
    setSelected(prefill);
    setPanelOpen(false);
    setStage('receiving');
    setDialogue(`转成 ${prefill.toUpperCase()} 对吧？已经准备好啦，请点我的手，把文件交给我～`);
  }, [prefill, selected, picked.length, allTargets]);

  const stopWatching = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopWatching, [stopWatching]);

  const refreshUsage = useCallback(async () => {
    try {
      const payload = await request<{ usage: { day: string; jobs: number; uploadBytes: number; outputBytes: number } }>(
        '/api/account/usage',
      );
      if (payload.usage) setUsage(payload.usage);
    } catch {
      /* usage refresh is best-effort */
    }
  }, [setUsage]);

  const applyJob = useCallback(
    (next: Job) => {
      setJob(next);
      if (!TERMINAL.includes(next.status)) return;
      stopWatching();
      setConnectionLost(false);
      void refreshUsage();
      const ok = next.files.filter((file) => file.status === 'success').length;
      if (ok > 0) {
        setStage('ready');
        setDialogue(`办好啦！${ok} 份文件都在桌上，点文件就可以取走啦～`);
      } else {
        setStage('error');
        setDialogue('这一单没能生成可领取的文件，换一个目标格式或稍后我再帮你办一次。');
      }
    },
    [refreshUsage, stopWatching],
  );

  const watchJob = useCallback(
    (jobId: string) => {
      stopWatching();
      setConnectionLost(false);
      stopRef.current = subscribeJob(jobId, {
        onUpdate: (payload) => applyJob(payload as Job),
        onDone: () => {
          stopWatching();
          void refreshUsage();
        },
        onError: () => {
          setConnectionLost(true);
          if (pollRef.current !== null) return;
          pollRef.current = window.setInterval(() => {
            void request<{ job: Job }>(`/api/jobs/${encodeURIComponent(jobId)}`)
              .then((payload) => {
                applyJob(payload.job);
                setConnectionLost(false);
              })
              .catch(() => undefined);
          }, 2500);
        },
      });
    },
    [applyJob, refreshUsage, stopWatching],
  );

  const kinds = useMemo(
    () => new Set(picked.map((item) => formatMap.get(item.ext)?.kind ?? 'unknown')),
    [picked, formatMap],
  );
  const hasImage = kinds.has('image');
  const hasPdf = kinds.has('pdf');
  const hasDocument = kinds.has('document');
  const hasAudio = kinds.has('audio') || kinds.has('video');
  const sourceExt = picked[0]?.ext ?? '';

  function buildOptions(): ConversionOptions {
    const options: ConversionOptions = {};
    if (hasImage) {
      const dimension = maxDimension.trim() === '' ? null : Number(maxDimension);
      options.image = {
        quality,
        maxDimension: dimension !== null && Number.isFinite(dimension) ? Math.round(dimension) : null,
        background,
        preserveAlpha,
      };
    }
    if (hasAudio) {
      const rate = sampleRate.trim() === '' ? null : Number(sampleRate);
      options.audio = {
        bitrateKbps: bitrate,
        sampleRate: rate !== null && Number.isFinite(rate) ? Math.round(rate) : null,
        channels,
      };
    }
    if (hasPdf) {
      options.pdf = {
        mode: pdfMode,
        dpi: pdfDpi,
        ocr: pdfOcr,
        sheetMode: pdfSheetMode,
        secondDetector: pdfSecondDetector,
      };
    }
    if (hasDocument && selected === 'pdf') options.document = { pdfLayout: docPdfLayout };
    return options;
  }

  const startConversion = useCallback(async () => {
    if (!user) {
      dialogRef.current?.showModal();
      return;
    }
    if (!selected || picked.length === 0 || uploading) return;
    if (job && !TERMINAL.includes(job.status)) return;
    if (!limits) return;

    const totalBytes = picked.reduce((sum, item) => sum + item.file.size, 0);
    if (usage && quotas && usage.uploadBytes + totalBytes > quotas.uploadBytes) {
      setError('今日上传额度不足，请明天再试或联系管理员提高配额');
      setStage('error');
      return;
    }

    setError(null);
    setNotice(null);
    const form = new FormData();
    form.append('target', selected);
    form.append('options', JSON.stringify(buildOptions()));
    for (const item of picked) form.append('files', item.file, item.file.name);

    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setUploadProgress(0);
    setStage('working');
    setDialogue('文件放好啦！我要开始认真工作了，请稍等一下～');
    try {
      const payload = await uploadForm<{ job: Job }>('/api/jobs', form, {
        onProgress: ({ loaded, total }) => {
          if (total > 0) setUploadProgress(Math.round((loaded / total) * 100));
        },
        signal: controller.signal,
      });
      setClaimed([]);
      applyJob(payload.job);
      watchJob(payload.job.id);
      void refreshUsage();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ABORTED') {
        setNotice('已取消上传');
        setStage('receiving');
      } else {
        setError(err instanceof ApiError ? err.message : '提交转换任务失败');
        setStage('error');
        setDialogue('刚才没有接稳这份文件，点“重新办一单”再交给我一次吧。');
      }
    } finally {
      abortRef.current = null;
      setUploading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user, selected, picked, uploading, job, limits, usage, quotas,
    hasImage, hasAudio, hasPdf, hasDocument, quality, maxDimension, background, preserveAlpha,
    bitrate, sampleRate, channels, pdfMode, pdfDpi, pdfOcr, pdfSecondDetector, pdfSheetMode, docPdfLayout, applyJob, watchJob, refreshUsage,
  ]);

  // 文件收好后等一下再自动开工，跟 ConvertX 的 1.1 秒“放桌上”停顿一致。
  useEffect(() => {
    if (stage !== 'placing' || !selected || picked.length === 0 || uploading || job) return;
    const timer = window.setTimeout(() => {
      void startConversion();
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [stage, selected, picked, uploading, job, startConversion]);

  const showPicker = useCallback(() => {
    if (uploading || (job && !TERMINAL.includes(job.status))) {
      setNotice('这一单还在办理，请先等鲸鱼娘处理完。');
      return;
    }
    if (stage === 'ready') {
      setDialogue('文件已经在桌上啦，先取走这一单，再来办新的业务吧～');
      return;
    }
    if (stage === 'idle') {
      setDialogue('先把上一单的文件取走，再来办新业务吧～');
      return;
    }
    setPanelOpen(true);
    setStage('choosing');
    setDialogue('今天想转换成什么格式？在下面挑一个业务就好啦！');
    document.getElementById('business-order')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
    window.setTimeout(() => document.getElementById('target-search')?.focus({ preventScroll: true }), 260);
  }, [uploading, job, stage]);

  function chooseTarget(choice: TargetChoice) {
    if (uploading || (job && !TERMINAL.includes(job.status))) return;
    if (stage === 'ready' || stage === 'idle') return;
    setSelected(choice.format);
    setPanelOpen(false);
    setStage('receiving');
    setDialogue(`转成 ${choice.format.toUpperCase()} 对吧？已经准备好啦，请点我的手，把文件交给我～`);
    setNotice(null);
    document.getElementById('service-hall')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
    window.setTimeout(() => document.getElementById('hall-receive')?.focus({ preventScroll: true }), 320);
  }

  function openAuthDialog() {
    if (selected) window.sessionStorage.setItem('convertlab:prefill', selected);
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    document.getElementById('business-auth-login')?.focus({ preventScroll: true });
  }

  function openFileChooser() {
    if (!user) {
      openAuthDialog();
      return;
    }
    if (!selected) {
      showPicker();
      return;
    }
    if (uploading || (job && !TERMINAL.includes(job.status))) return;
    if (stage === 'ready' || stage === 'idle') return;
    if (stage === 'placing') setStage('receiving');
    inputRef.current?.click();
  }

  function addFiles(list: FileList | File[]) {
    if (!user) {
      openAuthDialog();
      return;
    }
    if (!limits) return;
    setError(null);
    setNotice(null);
    const incoming = Array.from(list);
    const next = [...picked];
    const problems: string[] = [];
    for (const file of incoming) {
      if (next.length >= limits.maxBatchFiles) {
        problems.push(`每单最多 ${limits.maxBatchFiles} 个文件，请分批办理`);
        break;
      }
      const ext = fileExtension(file.name);
      if (!ext) {
        problems.push(`${file.name}：没有扩展名，请补全后再交给我`);
        continue;
      }
      if (!formatMap.has(ext)) {
        problems.push(`${file.name}：不支持 .${ext} 格式`);
        continue;
      }
      if (sourceExt && ext !== sourceExt) {
        problems.push(`这一单是 ${sourceExt.toUpperCase()} 文件，不同格式请分开办理`);
        continue;
      }
      if (file.size > limits.maxFileBytes) {
        problems.push(`${file.name}：超过 ${limits.maxFileMb} MB 上限`);
        continue;
      }
      if (file.size === 0) {
        problems.push(`${file.name}：文件为空`);
        continue;
      }
      if (next.some((item) => item.file.name === file.name)) {
        problems.push(`${file.name} 已经接收过啦，不会重复收取`);
        continue;
      }
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        ext,
      });
    }
    setPicked(next);
    if (problems.length > 0) setNotice(problems.join('；'));
    if (next.length > picked.length) {
      setStage('placing');
      setDialogue('文件收到啦！我先把它们放在办公桌上，马上开始办理～');
    }
  }

  function removeFile(key: string) {
    if (uploading) return;
    const next = picked.filter((item) => item.key !== key);
    setPicked(next);
    if (next.length === 0) {
      setStage(selected ? 'receiving' : 'choosing');
      setDialogue('好啦，文件已从这一单移除。需要时再交给我～');
    }
  }

  function reset() {
    if (uploading) return;
    stopWatching();
    setJob(null);
    setPicked([]);
    setClaimed([]);
    setSelected(null);
    setUploadProgress(0);
    setError(null);
    setNotice(null);
    setConnectionLost(false);
    setPanelOpen(true);
    setStage('choosing');
    setDialogue('欢迎回来！下一单想转换成什么格式？我准备好啦～');
    void refresh();
    document.getElementById('business-order')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  const deliverables = job?.files.filter((file) => file.status === 'success') ?? [];
  const remaining = deliverables.filter((file) => !claimed.includes(file.id));
  const jobActive = job !== null && !TERMINAL.includes(job.status);

  function claim(fileId?: string) {
    if (!job || deliverables.length === 0) return;
    const archive = !fileId && deliverables.length > 1 && claimed.length === 0;
    const file = fileId
      ? deliverables.find((item) => item.id === fileId)
      : deliverables.find((item) => !claimed.includes(item.id)) ?? deliverables[0];
    if (!archive && !file) return;
    const href = archive ? zipUrl(job.id) : downloadUrl(job.id, file!.id);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = '';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setClaimed((current) => {
      const next = new Set(current);
      if (archive) deliverables.forEach((item) => next.add(item.id));
      else if (file) next.add(file.id);
      return [...next];
    });
    setNotice('下载已交给浏览器，没收到可以点「没找到下载？重新取件」。');
  }

  useEffect(() => {
    if (stage !== 'ready') return;
    if (remaining.length === 0) {
      setStage('idle');
      setDialogue('下载已交给浏览器啦！请在下载列表查看进度，没收到随时再来领取～');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimed.length, stage]);

  const active = stepIndex(stage);
  const canStart = Boolean(selected) && picked.length > 0 && !uploading && !job;
  const ticket = !user
    ? '游客浏览'
    : job
      ? `业务单 #${job.id.slice(0, 8)}`
      : selected
        ? '业务已开单'
        : '等待选择业务';

  const selectionStatus = !user
    ? '可自由浏览与选择格式；交文件时再登录或注册。'
    : uploading
      ? `正在接收文件… ${uploadProgress}%`
      : jobActive
        ? '鲸鱼娘正在实际处理文件，完成后会把结果放到桌上。'
        : stage === 'ready'
          ? '点桌上的文件取件；也可以在下方逐份领取。'
          : stage === 'idle'
            ? '文件已交给浏览器保存；如果没找到，可以重新取件。'
            : stage === 'error'
              ? error ?? '这一单没有办成，可以换一种格式再试。'
              : stage === 'placing'
                ? '文件收好啦，马上自动开工。'
                : selected
                  ? '点鲸鱼娘的手，或点“选择文件”；上传完成后会自动办理。'
                  : '先选择目标格式，鲸鱼娘就会准备接收文件。';

  return (
    <main
      id="main-content"
      className="app-container business-page"
      tabIndex={-1}
      data-service-workspace
      data-stage={stage}
    >
      <section className="business-process" aria-labelledby="business-process-title">
        <div className="business-process-heading">
          <div>
            <p className="eyebrow">HOW IT WORKS</p>
            <h2 id="business-process-title">使用流程</h2>
          </div>
          <p>四步完成文件转换，进度实时更新</p>
        </div>
        <ol className="business-steps" aria-label="办理流程">
          {BUSINESS_STEPS.map((step, index) => {
            const state = index === active ? 'active' : index < active ? 'complete' : 'pending';
            return (
              <li
                key={step.label}
                data-business-step={STEP_LABELS[index]}
                data-state={state}
                className={state === 'active' ? 'is-active' : state === 'complete' ? 'is-complete' : undefined}
              >
                <span className="business-step-index">{index + 1}</span>
                <span className="business-step-icon"><SymbolIcon name={step.icon} size={17} /></span>
                <span className="business-step-copy">
                  <strong>{step.label}</strong>
                  <small>{step.description}</small>
                </span>
                <span className="business-step-state" aria-hidden="true">
                  {state === 'complete' ? <SymbolIcon name="check" size={13} /> : state === 'active' ? '当前' : '待开始'}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <ServiceHall
        stage={stage}
        dialogue={dialogue}
        stackCount={remaining.length}
        stackLabel={
          remaining.length > 1 && claimed.length === 0
            ? `领取全部 ${remaining.length} 份`
            : remaining[0]?.name ?? '文件已办好'
        }
        showStack={(stage === 'ready' || stage === 'idle') && remaining.length > 0}
        showStartNew={stage === 'idle'}
        dragover={dragover}
        onReceive={openFileChooser}
        onCollect={() => claim()}
        onStartNew={reset}
        onDropFiles={addFiles}
        onDragStateChange={setDragover}
      />

      <section className="business-order surface" aria-labelledby="business-order-title" id="business-order">
        <div className="business-order-heading">
          <div>
            <p className="eyebrow">YOUR SERVICE ORDER</p>
            <h2 id="business-order-title">今天要办理什么业务？</h2>
          </div>
          <span id="business-ticket" className="business-ticket">
            {ticket}
          </span>
        </div>

        <form
          id="convert-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void startConversion();
          }}
        >
          <div id="business-format-panel" className="business-format-panel" hidden={!panelOpen}>
            <div className="business-picker-title">
              <h3>想转换成哪种格式？</h3>
              <span id="format-count">
                {!formats && !loadError
                  ? '加载中…'
                  : `${new Set(Object.values(pickerTargets).flat()).size} 种输出格式`}
              </span>
            </div>
            <fieldset id="target-fieldset" disabled={uploading || jobActive || stage === 'ready' || stage === 'idle'}>
              <legend className="cx-sr-only">选择业务的目标格式</legend>
              <div className="select_container">
                <FormatPicker
                  targets={pickerTargets}
                  loading={!formats && !loadError}
                  selected={selected}
                  onSelect={chooseTarget}
                  advanced={
                    hasImage || hasAudio || hasPdf || (hasDocument && selected === 'pdf') ? (
                      <div className="cx-advanced-fields">
                        {hasImage ? (
                          <fieldset>
                            <legend>图片参数</legend>
                            <label className="sx-labeled-field">
                              <span>质量（1-100）</span>
                              <input
                                className="form-field"
                                type="number"
                                min={1}
                                max={100}
                                value={quality}
                                onChange={(event) =>
                                  setQuality(Math.min(100, Math.max(1, Number(event.target.value) || 85)))
                                }
                              />
                            </label>
                            <label className="sx-labeled-field">
                              <span>最长边（像素，可选）</span>
                              <input
                                className="form-field"
                                type="number"
                                min={16}
                                max={20000}
                                placeholder="保持原始尺寸"
                                value={maxDimension}
                                onChange={(event) => setMaxDimension(event.target.value)}
                              />
                            </label>
                            <label className="sx-labeled-field">
                              <span>透明区域背景色</span>
                              <input
                                className="form-field form-field-color"
                                type="color"
                                value={background}
                                onChange={(event) => setBackground(event.target.value)}
                              />
                            </label>
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={preserveAlpha}
                                onChange={(event) => setPreserveAlpha(event.target.checked)}
                              />
                              <span>目标格式支持时保留透明通道</span>
                            </label>
                          </fieldset>
                        ) : null}

                        {hasAudio ? (
                          <fieldset>
                            <legend>音频参数</legend>
                            <label className="sx-labeled-field">
                              <span>音频码率（kbps）</span>
                              <input
                                className="form-field"
                                type="number"
                                min={32}
                                max={512}
                                step={32}
                                value={bitrate}
                                onChange={(event) =>
                                  setBitrate(Math.min(512, Math.max(32, Number(event.target.value) || 192)))
                                }
                              />
                            </label>
                            <label className="sx-labeled-field">
                              <span>采样率（Hz，可选）</span>
                              <input
                                className="form-field"
                                type="number"
                                min={8000}
                                max={192000}
                                step={1000}
                                placeholder="沿用原始采样率"
                                value={sampleRate}
                                onChange={(event) => setSampleRate(event.target.value)}
                              />
                            </label>
                            <label className="sx-labeled-field">
                              <span>声道</span>
                              <select
                                className="form-field"
                                value={channels}
                                onChange={(event) => setChannels(event.target.value as 'source' | 'mono' | 'stereo')}
                              >
                                <option value="source">保持原始</option>
                                <option value="mono">单声道</option>
                                <option value="stereo">立体声</option>
                              </select>
                            </label>
                          </fieldset>
                        ) : null}

                        {hasPdf ? (
                          <fieldset>
                            <legend>PDF 参数</legend>
                            <label className="sx-labeled-field">
                              <span>PDF 转 Office 方式</span>
                              <select
                                className="form-field"
                                value={pdfMode}
                                onChange={(event) => setPdfMode(event.target.value as 'editable' | 'layout')}
                              >
                                <option value="editable">可编辑文字（保留表格线）</option>
                                <option value="layout">版式优先（按位置还原）</option>
                              </select>
                            </label>
                            <label className="sx-labeled-field">
                              <span>识别分辨率（DPI）</span>
                              <input
                                className="form-field"
                                type="number"
                                min={72}
                                max={400}
                                step={10}
                                value={pdfDpi}
                                onChange={(event) =>
                                  setPdfDpi(Math.min(400, Math.max(72, Number(event.target.value) || 150)))
                                }
                              />
                            </label>
                            {selected === 'xlsx' ? (
                              <label className="sx-labeled-field">
                                <span>Excel 工作表</span>
                                <select
                                  className="form-field"
                                  value={pdfSheetMode}
                                  onChange={(event) => setPdfSheetMode(event.target.value as 'single' | 'page')}
                                >
                                  <option value="single">全部内容放在一个工作表</option>
                                  <option value="page">每页一个工作表</option>
                                </select>
                                <small className="cx-options-hint">
                                  默认按 PDF 阅读顺序把正文和表格放进同一个工作表；表格仍保留边框、表头和数值格式。
                                </small>
                              </label>
                            ) : null}
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={pdfOcr}
                                onChange={(event) => setPdfOcr(event.target.checked)}
                              />
                              <span>扫描件识别（OCR，较慢，40 页以内）</span>
                            </label>
                            {pdfOcr ? (
                              <small className="cx-options-hint">
                                无文本层的扫描 PDF 会先用 Tesseract 做中英文识别，再重建可编辑表格；识别结果需人工校对。
                              </small>
                            ) : null}
                            {(selected === 'docx' || selected === 'xlsx') ? (
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={pdfSecondDetector}
                                  onChange={(event) => setPdfSecondDetector(event.target.checked)}
                                />
                                <span>深度表格结构复核（推荐）</span>
                              </label>
                            ) : null}
                            {(selected === 'docx' || selected === 'xlsx') && pdfSecondDetector ? (
                              <small className="cx-options-hint">
                                数字版 PDF 使用第二检测器复核漏检表格；扫描件在开启 OCR 时以 300 dpi 重建网格、合并单元格和中英文内容。复杂版面仍需人工校对。
                              </small>
                            ) : null}
                          </fieldset>
                        ) : null}

                        {hasDocument && selected === 'pdf' ? (
                          <fieldset>
                            <legend>文档转 PDF</legend>
                            <label className="sx-labeled-field">
                              <span>页面处理</span>
                              <select
                                className="form-field"
                                value={docPdfLayout}
                                onChange={(event) =>
                                  setDocPdfLayout(event.target.value as 'editable' | 'layout')
                                }
                              >
                                <option value="editable">可编辑转换</option>
                                <option value="layout">版式优先</option>
                              </select>
                            </label>
                          </fieldset>
                        ) : null}
                      </div>
                    ) : undefined
                  }
                />
              </div>
            </fieldset>
          </div>

          <div className="business-selection" id="business-selection" hidden={!selected || panelOpen}>
            <span className="business-selected-icon">
              <SymbolIcon name="file" size={21} />
            </span>
            <div>
              <small>本次办理</small>
              <strong id="chosen-format">{selected ? selected.toUpperCase() : '请选择目标格式'}</strong>
              <span id="source-summary">
                {picked.length > 0
                  ? `${sourceExt.toUpperCase()} → ${(selected ?? '').toUpperCase()} · ${picked.length} 个输入文件`
                  : '选好格式后，鲸鱼娘就会准备接收文件。'}
              </span>
            </div>
            <button
              type="button"
              id="change-business"
              className="btn-secondary"
              disabled={uploading || jobActive || stage === 'ready' || stage === 'idle'}
              onClick={showPicker}
            >
              更换格式
            </button>
          </div>

          <input
            id="file-input"
            className="business-file-input"
            type="file"
            multiple
            hidden
            ref={inputRef}
            aria-label="选择交给鲸鱼娘的文件"
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = '';
            }}
          />

          <div className="business-receive-note" id="business-receive-note" hidden={!selected || panelOpen}>
            <SymbolIcon name="upload" size={18} />
            <span>
              可以点鲸鱼娘的手，也可以拖拽文件到她的工位。
              <small className="business-upload-limits">
                每单最多 {limits?.maxBatchFiles ?? 20} 个文件，单个最多 {limits?.maxFileMb ?? 100} MiB。
              </small>
            </span>
            <button
              type="button"
              id="fallback-upload"
              className="btn-secondary"
              disabled={!selected || uploading || jobActive}
              onClick={openFileChooser}
            >
              选择文件
            </button>
          </div>

          <div className="cx-file-list-heading" id="file-list-heading" hidden={picked.length === 0 && !job}>
            <span id="file-count">
              本次交来 {(job?.files.length ?? picked.length)} 个文件
            </span>
            <button type="button" id="clear-files" className="cx-text-button" disabled={uploading} onClick={() => setPicked([])}>
              清空文件
            </button>
          </div>

          {job ? (
            <div id="file-list" className="cx-file-list" role="list">
              {job.files.map((file) => (
                <div
                  key={file.id}
                  className="cx-file-row"
                  role="listitem"
                  data-state={file.status === 'success' ? 'ready' : file.status === 'failed' ? 'error' : undefined}
                >
                  <span className="cx-file-type" aria-hidden="true">
                    {(file.outputExt ?? file.sourceExt).slice(0, 5).toUpperCase()}
                  </span>
                  <div className="cx-file-info">
                    <strong title={file.name}>{file.name}</strong>
                    <div className="cx-file-meta">
                      <span>
                        {file.sourceExt.toUpperCase()} · {formatBytes(file.sourceSize)}
                        {file.outputExt ? ` → ${file.outputExt.toUpperCase()} · ${formatBytes(file.outputSize)}` : ''}
                      </span>
                      <span data-upload-status>{STATUS_TEXT[file.status] ?? file.status}</span>
                    </div>
                    <progress
                      max={100}
                      value={file.status === 'success' ? 100 : file.progress}
                      aria-label={`${file.name} 进度`}
                    />
                    {file.error ? <span className="cx-file-error">{file.error}</span> : null}
                  </div>
                  <div className="cx-file-actions">
                    {file.status === 'success' ? (
                      <button type="button" className="cx-text-button" onClick={() => claim(file.id)}>
                        {claimed.includes(file.id) ? '已交付' : '领取'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : picked.length > 0 ? (
            <div id="file-list" className="cx-file-list" role="list">
              {picked.map((item) => (
                <div key={item.key} className="cx-file-row" role="listitem">
                  <span className="cx-file-type" aria-hidden="true">
                    {item.ext.slice(0, 5).toUpperCase()}
                  </span>
                  <div className="cx-file-info">
                    <strong title={item.file.name}>{item.file.name}</strong>
                    <div className="cx-file-meta">
                      <span>{formatBytes(item.file.size)}</span>
                      <span data-upload-status>{uploading ? `上传中 ${uploadProgress}%` : '等待提交'}</span>
                    </div>
                    <progress max={100} value={uploading ? uploadProgress : 0} aria-label={`${item.file.name} 上传进度`} />
                  </div>
                  <div className="cx-file-actions">
                    <button
                      type="button"
                      className="icon-button"
                      title="移除文件"
                      aria-label={`移除 ${item.file.name}`}
                      disabled={uploading}
                      onClick={() => removeFile(item.key)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {notice ? <p className="cx-notice">{notice}</p> : null}
          {error ? <p className="cx-notice cx-notice-error">{error}</p> : null}
          {loadError ? <p className="cx-notice cx-notice-error">{loadError}</p> : null}

          <div className="business-job-progress" id="business-job-progress" hidden={!jobActive}>
            <span className="business-processing-dot" />
            <span id="job-progress-text">
              {uploading && !job
                ? `正在把文件交给鲸鱼娘… ${uploadProgress}%`
                : job
                  ? `鲸鱼娘正在办理中… ${job.doneFiles + job.failedFiles}/${job.totalFiles} 份已处理`
                  : '鲸鱼娘正在办理中…'}
            </span>
            <button
              id="reconnect-job"
              type="button"
              className="cx-text-button"
              hidden={!connectionLost}
              onClick={() => job && watchJob(job.id)}
            >
              重新连接
            </button>
          </div>

          <div className="business-actions">
            <button type="submit" id="convert-submit" className="btn-primary" disabled={!canStart} hidden={!canStart}>
              立即开始办理 <SymbolIcon name="arrow" size={17} />
            </button>
            <button
              type="button"
              id="add-more-files"
              className="btn-secondary"
              hidden={!canStart}
              onClick={openFileChooser}
            >
              继续加文件
            </button>
            <button
              type="button"
              id="retry-business"
              className="btn-secondary"
              hidden={stage !== 'error'}
              onClick={reset}
            >
              重新办一单
            </button>
          </div>
          <p id="selection-status" className="business-selection-status" aria-live="polite">
            {selectionStatus}
          </p>
        </form>

        <section
          id="business-results"
          className="business-results"
          aria-labelledby="business-result-title"
          hidden={!job || !TERMINAL.includes(job.status)}
        >
          <div className="business-result-heading">
            <h3 id="business-result-title">
              {deliverables.length === 0
                ? '这一单没有办成'
                : deliverables.length < (job?.files.length ?? 0)
                  ? '部分文件已办好'
                  : '你的文件已办好'}
            </h3>
            <span id="business-result-count">
              {deliverables.length === 0 ? '可以换一种格式再试' : `${deliverables.length} 份可领取`}
            </span>
          </div>
          <ul id="business-result-list">
            {(job?.files ?? []).map((file) => {
              const done = file.status === 'success';
              const taken = claimed.includes(file.id);
              return (
                <li
                  key={file.id}
                  className="business-result-row"
                  data-state={done ? (taken ? 'claimed' : 'ready') : 'error'}
                >
                  <span title={file.name}>{file.name}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!done || taken}
                    onClick={() => claim(file.id)}
                  >
                    {!done ? '本份未办成' : taken ? '已交付' : '领取文件'}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="business-delivery-actions">
            <button
              type="button"
              id="download-again"
              className="btn-secondary"
              hidden={deliverables.length === 0}
              onClick={() => {
                setClaimed([]);
                setStage('ready');
                setDialogue('没有问题，文件还保留着，再从桌上领取一次吧～');
              }}
            >
              没找到下载？重新取件
            </button>
            <button type="button" id="business-next" className="btn-primary" hidden={stage !== 'idle'} onClick={reset}>
              再办一单
            </button>
            <a href="#/history" className="business-history-link">
              查看历史单据 <SymbolIcon name="arrow" size={15} />
            </a>
          </div>
          <p className="business-download-hint" id="download-hint">
            点击桌上的文件，或在这里领取。交付后仍可从历史记录再次下载。
          </p>
        </section>
      </section>

      <div className="business-facts">
        <span>
          <SymbolIcon name="grid" size={15} />
          {groups.length} 类业务
        </span>
        <span>
          <SymbolIcon name="layers" size={15} />
          {new Set(groups.flatMap((group) => group.formats)).size} 种格式
        </span>
        <span>
          <SymbolIcon name="shield" size={15} />
          文件由当前服务器处理
        </span>
      </div>

      <section className="business-faq" aria-labelledby="business-faq-title">
        <div className="business-faq-heading">
          <div>
            <p className="eyebrow">HELP BEFORE YOU START</p>
            <h2 id="business-faq-title">常见问题</h2>
          </div>
          <span>表格、OCR 与识别效果说明</span>
        </div>
        <div className="business-faq-list">
          <details>
            <summary>PDF 里的表格转成 Word 后会保留表格线吗？</summary>
            <p>
              会。检测到稳定表格结构时，Word 会重建为带边框的可编辑表格，并尽量保留表头、合并单元格和跨页续表；PDF 转 Excel 默认把正文和表格按阅读顺序放在一个工作表里，只有选择“每页一个工作表”时才会拆分。
            </p>
          </details>
          <details>
            <summary>扫描件或图片 PDF 需要开启 OCR 吗？</summary>
            <p>
              需要。扫描件会走 OCR；表格识别会使用 300 dpi 渲染和 RapidTable 结构模型重建网格、合并单元格与中英文内容。电子 PDF 会同时使用 Poppler 线条检测和 pdfplumber 检测结果进行融合。OCR 识别结果仍建议人工校对。
            </p>
          </details>
          <details>
            <summary>哪些情况可能影响识别效果？</summary>
            <ul>
              <li>页面倾斜或旋转、字体过小、手写内容。</li>
              <li>文字颜色过浅、表格线断裂或模糊。</li>
              <li>复杂公式和特殊符号、非标准合并单元格。</li>
              <li>多栏正文与无边框表格混排。</li>
            </ul>
          </details>
        </div>
      </section>

      {groups.length > 0 ? <FormatLibrary groups={groups} /> : null}

      <details className="business-credits">
        <summary>角色素材与演出说明</summary>
        <p>
          DeepSeek、Claude、GPT
          为非官方同人角色形象，工坊里的角色动作仅用于展示实际文件办理状态，不代表任何厂商的官方客服。转换由当前服务器上的转换工具完成。
        </p>
        <a href="/characters/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">
          查看网络图片来源、作者与素材许可
        </a>
      </details>

      <dialog
        id="business-auth-dialog"
        ref={dialogRef}
        className="business-auth-dialog"
        aria-labelledby="business-auth-title"
        aria-describedby="business-auth-description"
      >
        <button
          type="button"
          id="close-business-auth"
          className="icon-button business-auth-close"
          aria-label="关闭登录提示"
          onClick={() => dialogRef.current?.close()}
        >
          <SymbolIcon name="x" size={19} />
        </button>
        <img
          className="business-auth-mascot"
          src="/characters/crop-deepseek-greeting-0.webp"
          alt=""
          aria-hidden="true"
        />
        <p className="eyebrow">CONTINUE YOUR SERVICE</p>
        <h2 id="business-auth-title">登录后，把文件交给我吧</h2>
        <p id="business-auth-description">工坊可以自由浏览；办理文件转换前，请先登录或创建账号。</p>
        <p id="business-auth-selection" className="business-auth-selection">
          {selected ? `已选 ${selected.toUpperCase()}，登录后会继续这项业务。` : '所选目标格式会保留，登录后继续。'}
        </p>
        <div className="business-auth-actions">
          <a id="business-auth-login" className="btn-primary" href="#/login?next=/">
            登录并继续
          </a>
          <a id="business-auth-register" className="btn-secondary" href="#/login?next=/&mode=register">
            注册新账号
          </a>
        </div>
        <button
          type="button"
          id="browse-without-login"
          className="business-auth-browse"
          onClick={() => dialogRef.current?.close()}
        >
          先逛逛，暂不办理
        </button>
      </dialog>
    </main>
  );
}

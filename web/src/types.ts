export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'disabled';

export type User = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
  disabledReason: string | null;
  quotas: { jobs: number | null; uploadBytes: number | null; outputBytes: number | null };
};

export type Usage = { day: string; jobs: number; uploadBytes: number; outputBytes: number };

export type Quotas = { jobs: number; uploadBytes: number; outputBytes: number };

export type MeResponse = {
  user: User | null;
  csrf?: string;
  usage?: Usage;
  quotas?: Quotas;
  registrationOpen: boolean;
};

export type JobStatus = 'queued' | 'processing' | 'success' | 'partial' | 'failed' | 'cancelled';
export type FileStatus = 'pending' | 'processing' | 'success' | 'failed' | 'cancelled';

export type JobFile = {
  id: string;
  name: string;
  sourceExt: string;
  sourceSize: number;
  status: FileStatus;
  progress: number;
  outputExt: string | null;
  outputSize: number | null;
  error: string | null;
  durationMs: number | null;
  expiresAt: number | null;
};

export type Job = {
  id: string;
  status: JobStatus;
  target: string;
  options: Record<string, unknown>;
  totalFiles: number;
  doneFiles: number;
  failedFiles: number;
  progress: number;
  error: string | null;
  cancelRequested: boolean;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  expiresAt: number | null;
  files: JobFile[];
};

export type AdminJob = Job & { email: string | null };

export type FormatInfo = {
  ext: string;
  label: string;
  kind: 'image' | 'pdf' | 'document' | 'audio' | 'video';
  targets: string[];
};

export type CatalogEntry = {
  label: string;
  kind: FormatInfo['kind'];
};

export type FormatLimits = {
  maxFileBytes: number;
  maxFileMb: number;
  maxBatchFiles: number;
  dailyJobs: number;
  dailyUploadBytes: number;
  dailyOutputBytes: number;
  fileTtlHours: number;
};

export type FormatsResponse = {
  formats: FormatInfo[];
  catalog: Record<string, CatalogEntry>;
  limits: FormatLimits;
  registrationOpen: boolean;
};

export type ImageOptions = {
  quality: number;
  maxDimension: number | null;
  background: string;
  preserveAlpha: boolean;
};

export type AudioOptions = {
  bitrateKbps: number;
  sampleRate: number | null;
  channels: 'mono' | 'stereo' | 'source';
};

export type PdfOptions = { mode: 'editable' | 'layout'; dpi: number; ocr?: boolean; sheetMode?: 'single' | 'page' };

export type ConversionOptions = {
  image?: ImageOptions;
  audio?: AudioOptions;
  pdf?: PdfOptions;
  document?: { pdfLayout: 'editable' | 'layout' };
};

export type AdminStats = {
  users: { total: number; activeAdmins: number };
  jobs: Record<string, number>;
  usage: { jobsToday: number; uploadBytesToday: number; outputBytesToday: number };
  storage: { activeOutputBytes: number; activeOutputFiles: number; databaseBytes: number };
  pending: number;
  limits: FormatLimits & { workerConcurrency: number };
};

export type AdminUser = User & { usage: Usage; jobCount: number };

export type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
  ip: string | null;
  created_at: number;
};

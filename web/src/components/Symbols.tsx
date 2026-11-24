export type SymbolName =
  | 'upload'
  | 'arrow'
  | 'file'
  | 'grid'
  | 'history'
  | 'check'
  | 'download'
  | 'trash'
  | 'search'
  | 'shield'
  | 'settings'
  | 'x'
  | 'chevron'
  | 'layers'
  | 'sparkles';

const paths: Record<SymbolName, string> = {
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8m-8 4h5',
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  history: 'M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v5l3 2',
  check: 'm5 12 4 4L19 6',
  download: 'M12 3v13m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  trash: 'M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7',
  search: 'M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0ZM16 16l5 5',
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
  settings:
    'm10 3-.7 2.3-2 .9-2.2-.5-2 3.4 1.6 1.8v2.2l-1.6 1.8 2 3.4 2.3-.5 1.9 1 .7 2.2h4l.7-2.3 2-.9 2.2.5 2-3.4-1.6-1.8v-2.2l1.6-1.8-2-3.4-2.3.5-1.9-1L14 3h-4ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  x: 'm6 6 12 12M6 18 18 6',
  chevron: 'm9 5 7 7-7 7',
  layers: 'm12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  sparkles:
    'm12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Zm7-1v4m-2-2h4M4 18v4m-2-2h4',
};

export function SymbolIcon({ name, size = 20 }: { name: SymbolName; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="symbol-icon"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function WhaleMark({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'app-brand-mark'} viewBox="0 0 48 32" fill="none" aria-hidden="true">
      <path
        d="M37 10c3-5 7-5 9-4-1 6-5 9-10 9-3 10-12 16-24 11C3 22 0 13 4 7c2 9 12 11 17 5 5-5 11-5 16-2Z"
        fill="currentColor"
      />
      <path d="M18 7c-4-4-1-7 2-6m3 5c1-5 5-5 6-3" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <circle cx="29" cy="16" r="1.6" fill="white" />
    </svg>
  );
}

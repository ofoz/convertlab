import { useMemo, useState, type ReactNode } from 'react';
import { formatDescription } from '../data/catalog';
import { SymbolIcon } from './Symbols';

export type TargetChoice = { format: string; engine: string };

const POPULAR = [
  'pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'webp', 'gif', 'txt', 'csv', 'mp4', 'mp3', 'wav', 'flac',
];

export function FormatPicker({
  targets,
  disabled = false,
  selected,
  onSelect,
  advanced,
  loading = false,
}: {
  targets: Record<string, string[]>;
  disabled?: boolean;
  selected: string | null;
  onSelect: (choice: TargetChoice) => void;
  advanced?: ReactNode;
  loading?: boolean;
}) {
  const [query, setQuery] = useState('');

  const choices = useMemo(() => {
    const map = new Map<string, string>();
    for (const [engine, formats] of Object.entries(targets)) {
      for (const format of formats) if (!map.has(format)) map.set(format, engine);
    }
    return [...map].sort(([a], [b]) => {
      const ai = POPULAR.indexOf(a);
      const bi = POPULAR.indexOf(b);
      return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.localeCompare(b);
    });
  }, [targets]);

  const needle = query.trim().replace(/^\./, '').toLowerCase();
  const visible = choices.filter(([format]) =>
    needle ? `${format} ${formatDescription(format)}`.toLowerCase().includes(needle) : true,
  );

  return (
    <article className="cx-picker" data-options-count={choices.length}>
      <label className="cx-search-field" htmlFor="target-search">
        <SymbolIcon name="search" size={18} />
        <input
          id="target-search"
          type="search"
          placeholder="搜索格式，例如 DOCX、PNG、MP3"
          autoComplete="off"
          aria-label="搜索目标格式"
          aria-controls="format-options"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'ArrowDown') {
              const first = visible[0];
              if (!first) return;
              event.preventDefault();
              onSelect({ format: first[0], engine: first[1] });
            }
          }}
        />
        <span className="cx-key-hint" aria-hidden="true">
          ↵
        </span>
      </label>
      <div className="cx-options-caption">
        <span id="format-options-label">
          {disabled
            ? '上传后自动匹配可用格式'
            : loading && choices.length === 0
              ? '正在读取可用格式…'
              : `可选目标格式 · ${choices.length}`}
        </span>
        <span className="cx-options-hint">点击选择</span>
      </div>
      {choices.length > 0 ? (
        <div
          id="format-options"
          className="convert_to_group cx-format-options"
          role="group"
          aria-labelledby="format-options-label"
        >
          {visible.map(([format, engine]) => {
            const isSelected = selected === format;
            return (
              <button
                key={format}
                type="button"
                className={isSelected ? 'target cx-target is-selected' : 'target cx-target'}
                data-value={`${format},${engine}`}
                data-target={format}
                data-converter={engine}
                title={`${format.toUpperCase()} · ${formatDescription(format)}`}
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => onSelect({ format, engine })}
              >
                <span className="cx-target-ext">{format}</span>
                <span className="cx-target-description">{formatDescription(format)}</span>
                <span className="cx-target-check" aria-hidden="true">
                  <SymbolIcon name="check" size={15} />
                </span>
              </button>
            );
          })}
        </div>
      ) : loading ? (
        <div id="format-options" className="cx-picker-empty cx-picker-loading" aria-busy="true">
          <span className="cx-loading-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          正在加载可用格式…
        </div>
      ) : (
        <div className="cx-picker-empty">
          这个文件类型暂时没有可用的转换格式。可在格式库中查看支持范围。
        </div>
      )}
      <p id="target-search-empty" className="cx-picker-empty" hidden={visible.length > 0}>
        没有找到匹配格式，试试其他关键词。
      </p>
      {advanced ? (
        <details className="cx-advanced">
          <summary>
            高级选项 <span>转换设置</span>
          </summary>
          {advanced}
        </details>
      ) : null}
    </article>
  );
}

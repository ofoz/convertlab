import { useMemo, useState } from 'react';
import { catalogStats, type FormatCategory } from '../data/catalog';
import { SymbolIcon } from './Symbols';

const NORMALIZE: Record<string, string> = { jpg: 'jpeg', jfif: 'jpeg', tif: 'tiff' };
const normalize = (text: string) => {
  const value = text.trim().toLowerCase().replace(/^\./, '');
  return NORMALIZE[value] ?? value;
};

export function FormatLibrary({
  groups,
  full = false,
}: {
  groups: FormatCategory[];
  full?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [direction, setDirection] = useState<'all' | 'input' | 'output'>('all');
  const [openIds, setOpenIds] = useState<string[]>([]);
  const stats = catalogStats(groups);

  const matches = useMemo(() => {
    const needle = normalize(query);
    return groups.map((group) => {
      const categoryMatches = category === 'all' || group.id === category;
      const textMatches = `${group.title} ${group.label} ${group.description} ${group.converters.join(' ')}`
        .toLowerCase()
        .includes(needle);
      const tokenMatch = (token: string) => !needle || textMatches || token.includes(needle);
      const inputs = group.inputs.filter((token) => direction !== 'output' && tokenMatch(token));
      const outputs = group.outputs.filter((token) => direction !== 'input' && tokenMatch(token));
      const visible = categoryMatches && inputs.length + outputs.length > 0;
      return { group, inputs, outputs, visible };
    });
  }, [groups, query, category, direction]);

  const visibleGroups = matches.filter((item) => item.visible);
  const formatCount = new Set(
    visibleGroups.flatMap((item) => [...item.inputs, ...item.outputs]),
  ).size;
  const isOpen = (id: string) => openIds.includes(id) || query.trim() !== '' || category !== 'all';
  const allOpen = visibleGroups.length > 0 && visibleGroups.every((item) => isOpen(item.group.id));

  const toggleGroup = (id: string, open: boolean) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return [...next];
    });
  };

  return (
    <section id="formats" className={full ? 'cx-library cx-library-full' : 'cx-library'} data-format-library>
      <div className="cx-section-heading">
        <div>
          <p className="eyebrow">THE FORMAT UNIVERSE</p>
          <h2>{full ? '全部支持格式' : '支持什么格式？这里全部列清楚。'}</h2>
          <p className="muted">按用途浏览，或直接搜索格式。点击输出格式，可带着目标回到转换台。</p>
        </div>
        {!full ? (
          <a className="cx-text-link" href="#/formats">
            打开完整格式库 <SymbolIcon name="arrow" size={16} />
          </a>
        ) : null}
      </div>
      <div className="cx-library-toolbar surface">
        <label className="cx-search-field" htmlFor="catalog-search">
          <SymbolIcon name="search" size={18} />
          <input
            id="catalog-search"
            type="search"
            placeholder="搜索格式或分类，例如 PDF、JPG、视频"
            aria-label="搜索支持格式"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="cx-direction-control" role="group" aria-label="格式方向">
          {(['all', 'input', 'output'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={direction === value ? 'is-active' : undefined}
              aria-pressed={direction === value}
              onClick={() => setDirection(value)}
            >
              {value === 'all' ? '全部' : value === 'input' ? '可输入' : '可输出'}
            </button>
          ))}
        </div>
        <button
          className="cx-expand-button"
          type="button"
          aria-expanded={allOpen}
          onClick={() => {
            setOpenIds(allOpen ? [] : visibleGroups.map((item) => item.group.id));
          }}
        >
          {allOpen ? '全部收起 ' : '全部展开 '}
          <SymbolIcon name="chevron" size={15} />
        </button>
      </div>
      <div className="cx-category-filters" role="group" aria-label="按用途筛选">
        <button
          type="button"
          className={category === 'all' ? 'is-active' : undefined}
          aria-pressed={category === 'all'}
          onClick={() => setCategory('all')}
        >
          全部分类 <span>{groups.length}</span>
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={category === group.id ? 'is-active' : undefined}
            aria-pressed={category === group.id}
            onClick={() => setCategory(group.id)}
          >
            {group.title}
          </button>
        ))}
      </div>
      <p className="cx-catalog-count muted" aria-live="polite">
        {visibleGroups.length} 个分类 · {formatCount} 种格式
      </p>
      <div className="cx-category-grid">
        {matches.map(({ group, inputs, outputs, visible }) => (
          <details
            key={group.id}
            id={`category-${group.id}`}
            className="cx-category surface"
            data-format-category={group.id}
            hidden={!visible}
            open={visible && isOpen(group.id)}
            onToggle={(event) => toggleGroup(group.id, event.currentTarget.open)}
          >
            <summary>
              <span className="cx-category-symbol" aria-hidden="true">
                <SymbolIcon name={group.icon} size={23} />
              </span>
              <span className="cx-category-copy">
                <span className="cx-category-label">{group.label}</span>
                <strong>{group.title}</strong>
                <span className="cx-category-description">{group.description}</span>
                <span className="cx-category-examples">{group.examples.join(' / ')}</span>
              </span>
              <span className="cx-category-meta">
                <b>{group.formats.length}</b>
                <span>种格式</span>
                <SymbolIcon name="chevron" size={17} />
              </span>
            </summary>
            <div className="cx-category-content">
              {inputs.length > 0 ? (
                <div className="cx-format-direction">
                  <h3>
                    <span className="cx-direction-dot" />
                    可输入 <small>{inputs.length}</small>
                  </h3>
                  <div className="cx-format-tags">
                    {inputs.map((format) => (
                      <span key={format} className="cx-format-tag" data-format-token={format}>
                        {format}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {outputs.length > 0 ? (
                <div className="cx-format-direction">
                  <h3>
                    <span className="cx-direction-dot cx-output-dot" />
                    可输出 <small>{outputs.length}</small>
                  </h3>
                  <div className="cx-format-tags">
                    {outputs.map((format) => (
                      <a
                        key={format}
                        className="cx-format-tag cx-format-tag-link"
                        href={`#/?to=${encodeURIComponent(format)}`}
                        title={`选择 ${format.toUpperCase()} 作为输出格式`}
                      >
                        {format}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="cx-category-engines">
                转换引擎 <span>{group.converters.join(' · ')}</span>
              </p>
            </div>
          </details>
        ))}
      </div>
      {visibleGroups.length === 0 ? (
        <div className="cx-catalog-empty surface">
          <SymbolIcon name="search" size={28} />
          <h3>没有找到这个格式</h3>
          <p>试试其他扩展名，或清除分类与方向筛选。</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setCategory('all');
              setDirection('all');
              setQuery('');
            }}
          >
            清除筛选
          </button>
        </div>
      ) : null}
      <p className="cx-catalog-footnote">
        格式清单来自当前服务器的 {stats.converters} 个转换引擎。同一格式可出现在多个用途分类；总数已去重。先选目标格式，上传后会检查这组输入与输出是否支持转换。
      </p>
    </section>
  );
}

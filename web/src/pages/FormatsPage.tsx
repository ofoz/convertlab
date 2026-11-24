import { useEffect, useMemo, useState } from 'react';
import { ApiError, request } from '../api';
import { FormatLibrary } from '../components/FormatLibrary';
import { SymbolIcon } from '../components/Symbols';
import { buildCatalog, catalogStats, type FormatCategory } from '../data/catalog';
import { useRoute } from '../router';
import type { FormatsResponse } from '../types';

type Engine = { code: string; inputs: string[]; outputs: string[] };

/** 每个转换引擎各自能吃进、吐出的格式。 */
function buildEngines(groups: FormatCategory[]): Engine[] {
  const engines: Engine[] = [];
  const documents = groups.find((group) => group.id === 'documents');
  if (documents) {
    const office = documents.inputs.filter((ext) => ext !== 'pdf');
    if (office.length > 0) {
      engines.push({
        code: 'libreoffice',
        inputs: office,
        outputs: documents.outputs,
      });
    }
    if (documents.inputs.includes('pdf')) {
      engines.push({
        code: 'pdf-tables',
        inputs: ['pdf'],
        outputs: documents.outputs.filter((ext) => ext === 'docx' || ext === 'xlsx'),
      });
    }
  }
  for (const group of groups) {
    if (group.id === 'documents') continue;
    for (const converter of group.converters) {
      engines.push({ code: converter, inputs: group.inputs, outputs: group.outputs });
    }
  }
  return engines;
}

export default function FormatsPage() {
  const { go } = useRoute();
  const [payload, setPayload] = useState<FormatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    request<FormatsResponse>('/api/formats')
      .then((data) => {
        if (active) setPayload(data);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiError ? err.message : '无法读取支持的格式列表');
      });
    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo(() => buildCatalog(payload), [payload]);
  const stats = useMemo(() => catalogStats(groups), [groups]);
  const engines = useMemo(() => buildEngines(groups), [groups]);

  return (
    <main id="main-content" className="app-container cx-catalog-page" tabIndex={-1}>
      <div className="cx-catalog-hero">
        <div>
          <p className="eyebrow">EXPLORE THE POSSIBILITIES</p>
          <h1>
            找到你需要的
            <br />
            <span>每一种格式。</span>
          </h1>
          <p className="muted">完整格式清单，按用途分组。搜索扩展名，即可找到输入与输出支持。</p>
        </div>
        <button
          type="button"
          className="cx-back-to-workspace btn-primary"
          onClick={() => go('/')}
        >
          去转换文件 <SymbolIcon name="arrow" size={17} />
        </button>
      </div>

      {error ? (
        <p className="cx-notice cx-notice-error" role="alert">
          {error}
        </p>
      ) : null}

      {!payload && !error ? <p className="cx-catalog-count muted">正在读取格式清单…</p> : null}

      {payload ? (
        <>
          <div className="cx-catalog-stats">
            <div>
              <strong>{stats.inputs}</strong>
              <span>种输入格式</span>
            </div>
            <div>
              <strong>{stats.outputs}</strong>
              <span>种输出格式</span>
            </div>
            <div>
              <strong>{stats.converters}</strong>
              <span>个转换引擎</span>
            </div>
          </div>

          <FormatLibrary groups={groups} full />

          <details className="surface cx-engine-directory">
            <summary>
              <span>
                <b>按转换引擎查看</b>
                <small>高级浏览 · {stats.converters} 个引擎</small>
              </span>
              <SymbolIcon name="chevron" size={18} />
            </summary>
            <div className="cx-engine-grid">
              {engines.map((engine) => (
                <article className="cx-engine-card" key={engine.code} data-engine={engine.code}>
                  <code>{engine.code}</code>
                  <p>
                    输入 <strong>{engine.inputs.length}</strong>
                    <span> / </span>输出 <strong>{engine.outputs.length}</strong>
                  </p>
                  <details>
                    <summary>查看引擎的全部格式</summary>
                    <h3>可输入</h3>
                    <div className="cx-format-tags">
                      {engine.inputs.map((format) => (
                        <span className="cx-format-tag" key={format}>
                          {format}
                        </span>
                      ))}
                    </div>
                    <h3>可输出</h3>
                    <div className="cx-format-tags">
                      {engine.outputs.map((format) => (
                        <span className="cx-format-tag" key={format}>
                          {format}
                        </span>
                      ))}
                    </div>
                  </details>
                </article>
              ))}
            </div>
          </details>
        </>
      ) : null}
    </main>
  );
}

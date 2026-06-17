import { useMemo, useState } from 'react';

const DEFAULT_ENTRY_URL = 'https://example.com/nav';

function quoteShell(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export default function CrawlerOps() {
  const [entryUrl, setEntryUrl] = useState(DEFAULT_ENTRY_URL);
  const [outputDir, setOutputDir] = useState('output');
  const [concurrency, setConcurrency] = useState(3);
  const [requestIntervalMs, setRequestIntervalMs] = useState(500);
  const [limit, setLimit] = useState('');
  const [allowExternal, setAllowExternal] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [copied, setCopied] = useState(false);

  const command = useMemo(() => {
    const parts = [
      'python3 -m scrp crawl',
      quoteShell(entryUrl.trim() || DEFAULT_ENTRY_URL),
      '--output',
      quoteShell(outputDir.trim() || 'output'),
      '--concurrency',
      String(Math.max(1, concurrency || 1)),
      '--request-interval-ms',
      String(Math.max(0, requestIntervalMs || 0)),
    ];

    if (limit.trim()) parts.push('--limit', String(Math.max(0, Number(limit) || 0)));
    if (allowExternal) parts.push('--allow-external');
    if (overwrite) parts.push('--overwrite');

    return parts.join(' ');
  }, [entryUrl, outputDir, concurrency, requestIntervalMs, limit, allowExternal, overwrite]);

  const copyCommand = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div>
      <div className="page-header">
        <h1>🕸️ 爬虫操作后台</h1>
        <p>单机两层网页采集：入口导航页 → 下一层正文页 → Markdown 文件输出。</p>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">采集任务</div>

          <div className="form-group">
            <label>入口导航页 URL</label>
            <input
              value={entryUrl}
              onChange={e => setEntryUrl(e.target.value)}
              placeholder="https://example.com/nav"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label>输出目录</label>
              <input value={outputDir} onChange={e => setOutputDir(e.target.value)} />
            </div>
            <div className="form-group">
              <label>链接上限</label>
              <input
                value={limit}
                onChange={e => setLimit(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="不限制"
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label>并发数</label>
              <input
                type="number"
                min={1}
                value={concurrency}
                onChange={e => setConcurrency(Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>请求间隔 ms</label>
              <input
                type="number"
                min={0}
                value={requestIntervalMs}
                onChange={e => setRequestIntervalMs(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex gap-3" style={{ flexWrap: 'wrap', fontSize: '.84em' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={allowExternal}
                onChange={e => setAllowExternal(e.target.checked)}
                style={{ width: 'auto' }}
              />
              允许跨域链接
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={overwrite}
                onChange={e => setOverwrite(e.target.checked)}
                style={{ width: 'auto' }}
              />
              覆盖已有 Markdown
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-header">执行命令</div>
          <p style={{ color: 'var(--ink-secondary)', fontSize: '.84em', marginTop: 0 }}>
            当前版本先生成本机 CLI 命令。爬虫项目在 <code>/Users/xiaoqin/scrp</code>。
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 14,
              fontSize: '.8em',
              lineHeight: 1.6,
            }}
          >{`cd /Users/xiaoqin/scrp\n${command}`}</pre>
          <button className="btn btn-primary" onClick={copyCommand}>
            {copied ? '已复制' : '复制命令'}
          </button>
        </div>
      </div>

      <div className="grid-2 mt-4">
        <div className="card">
          <div className="card-header">采集规则</div>
          <div style={{ display: 'grid', gap: 10, color: 'var(--ink-secondary)', fontSize: '.86em' }}>
            <div><strong style={{ color: 'var(--ink)' }}>深度：</strong>只爬 2 层，入口页发现链接后进入下一层，不继续递归。</div>
            <div><strong style={{ color: 'var(--ink)' }}>默认范围：</strong>只保留同域名链接，防止跑出目标站点。</div>
            <div><strong style={{ color: 'var(--ink)' }}>抽取字段：</strong>标题、正文、作者、发布时间、图片、来源 URL。</div>
            <div><strong style={{ color: 'var(--ink)' }}>失败处理：</strong>单页失败不会中断整个任务，会写入本地索引。</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">输出结构</div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 14,
              fontSize: '.8em',
              lineHeight: 1.6,
            }}
          >{`output/
  site-name/
    index.json
    articles/
      2026-06-09-title-slug.md
    assets/`}</pre>
        </div>
      </div>
    </div>
  );
}

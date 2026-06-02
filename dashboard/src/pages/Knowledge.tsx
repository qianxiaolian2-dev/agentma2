import { useEffect, useMemo, useState } from 'react';
import { getAuthHeaders } from '../utils/client-runtime';
import { useAuth } from '../contexts/AuthContext';

type KnowledgeSource = {
  id: string;
  name: string;
  path: string;
  readOnly: boolean;
  enabled: boolean;
  createdAt?: number;
  updatedAt?: number;
};

type KnowledgeTestResult = {
  ok: boolean;
  reason?: string;
  fileCount?: number;
  sampleFiles?: string[];
};

type KnowledgeCandidate = {
  name: string;
  path: string;
  fileCount: number;
  sampleFiles: string[];
};

type TestState = {
  loading?: boolean;
  result?: KnowledgeTestResult;
};

const jsonAuthHeaders = () => getAuthHeaders({ 'Content-Type': 'application/json' });

function createSource(): KnowledgeSource {
  return {
    id: crypto.randomUUID(),
    name: '',
    path: '',
    readOnly: true,
    enabled: true,
  };
}

function defaultSourceNameFromPath(sourcePath: string) {
  const normalized = sourcePath.trim().replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '知识库';
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const contentType = response.headers.get('content-type') || '';
      const looksHtml = contentType.includes('text/html') || text.trim().startsWith('<');
      throw new Error(looksHtml
        ? `接口返回了 HTML，说明当前后端没有命中这个 API 路由: ${response.url}`
        : `接口返回了非 JSON 内容: ${text.slice(0, 120)}`);
    }
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data
      ? String((data as Record<string, unknown>).error || '请求失败')
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function normalizeSources(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const path = typeof raw.path === 'string' ? raw.path : '';
    return [{
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      name: typeof raw.name === 'string' ? raw.name : '',
      path,
      readOnly: raw.readOnly !== false,
      enabled: raw.enabled !== false,
      createdAt: Number(raw.createdAt) || undefined,
      updatedAt: Number(raw.updatedAt) || undefined,
    }];
  });
}

export default function Knowledge() {
  const { user } = useAuth();
  const canSave = user?.role === 'tenant_admin';
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [savedSources, setSavedSources] = useState<KnowledgeSource[]>([]);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [scanPath, setScanPath] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [directImportLoading, setDirectImportLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanRoots, setScanRoots] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<KnowledgeCandidate[]>([]);
  const [selectedCandidatePaths, setSelectedCandidatePaths] = useState<string[]>([]);

  const changed = useMemo(() => JSON.stringify(sources) !== JSON.stringify(savedSources), [sources, savedSources]);
  const enabledCount = sources.filter((source) => source.enabled && source.path.trim()).length;
  const existingPaths = useMemo(() => new Set(sources.map((source) => source.path.trim()).filter(Boolean)), [sources]);

  const loadSources = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/knowledge/sources', { headers: getAuthHeaders() });
      const data = await readJson<unknown>(response);
      const next = normalizeSources(data);
      setSources(next);
      setSavedSources(next);
      setTests({});
    } catch (loadError) {
      setError((loadError as Error).message || '加载知识库失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadSources(); }, []);

  const updateSource = (id: string, patch: Partial<KnowledgeSource>) => {
    setSources((current) => current.map((source) => (source.id === id ? { ...source, ...patch } : source)));
  };

  const addSource = () => {
    setSources((current) => [...current, createSource()]);
  };

  const scanLocalSources = async () => {
    setScanLoading(true);
    setScanError('');
    setStatus('');
    try {
      const response = await fetch('/api/knowledge/sources/scan', {
        method: 'POST',
        headers: jsonAuthHeaders(),
        body: JSON.stringify({ path: scanPath.trim() }),
      });
      const data = await readJson<{ roots?: string[]; candidates?: KnowledgeCandidate[] }>(response);
      const nextCandidates = Array.isArray(data.candidates) ? data.candidates : [];
      setScanRoots(Array.isArray(data.roots) ? data.roots : []);
      setCandidates(nextCandidates);
      setSelectedCandidatePaths(nextCandidates.filter((candidate) => !existingPaths.has(candidate.path)).map((candidate) => candidate.path));
      if (!nextCandidates.length) setScanError('没有找到包含 markdown 的候选目录');
    } catch (scanFailure) {
      setScanError((scanFailure as Error).message || '扫描知识库失败');
    } finally {
      setScanLoading(false);
    }
  };

  const toggleCandidate = (candidatePath: string) => {
    setSelectedCandidatePaths((current) => (
      current.includes(candidatePath)
        ? current.filter((item) => item !== candidatePath)
        : [...current, candidatePath]
    ));
  };

  const saveSourceList = async (sourceList: KnowledgeSource[], successMessage: string) => {
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const payload = sourceList
        .filter((source) => source.path.trim())
        .map((source) => ({
          ...source,
          name: source.name.trim(),
          path: source.path.trim(),
          readOnly: true,
        }));
      const response = await fetch('/api/knowledge/sources', {
        method: 'PUT',
        headers: jsonAuthHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await readJson<unknown>(response);
      const next = normalizeSources(data);
      setSources(next);
      setSavedSources(next);
      setStatus(successMessage);
    } catch (saveError) {
      setError((saveError as Error).message || '保存知识库失败');
      throw saveError;
    } finally {
      setSaving(false);
    }
  };

  const importInputPathDirectly = async () => {
    const sourcePath = scanPath.trim();
    if (!sourcePath) {
      setScanError('请输入要导入的本地文件夹路径');
      return;
    }
    if (existingPaths.has(sourcePath)) {
      setScanError('这个文件夹已经在我的知识库里');
      return;
    }
    setDirectImportLoading(true);
    setScanError('');
    setStatus('');
    try {
      const response = await fetch('/api/knowledge/sources/test', {
        method: 'POST',
        headers: jsonAuthHeaders(),
        body: JSON.stringify({ path: sourcePath }),
      });
      const result = await readJson<KnowledgeTestResult>(response);
      if (!result.ok) throw new Error(result.reason || '文件夹不可用');
      const sourceName = defaultSourceNameFromPath(sourcePath);
      const nextSources = [...sources, {
        ...createSource(),
        name: sourceName,
        path: sourcePath,
      }];
      await saveSourceList(nextSources, `已导入「${sourceName}」，现在可以在 Agent 创建页勾选。`);
    } catch (importFailure) {
      setScanError((importFailure as Error).message || '直接导入文件夹失败');
    } finally {
      setDirectImportLoading(false);
    }
  };

  const importSelectedCandidates = async () => {
    const selected = candidates.filter((candidate) => selectedCandidatePaths.includes(candidate.path));
    if (!selected.length) {
      setScanError('请先选择要导入的目录');
      return;
    }
    const paths = new Set(sources.map((source) => source.path.trim()).filter(Boolean));
    const additions = selected
      .filter((candidate) => !paths.has(candidate.path))
      .map((candidate) => ({
        ...createSource(),
        name: candidate.name,
        path: candidate.path,
      }));
    if (!additions.length) {
      setScanError('选中的目录都已经导入');
      return;
    }
    setScanError('');
    try {
      await saveSourceList([...sources, ...additions], `已导入 ${additions.length} 个知识库，现在可以在 Agent 创建页勾选。`);
    } catch {
      // saveSourceList 已写入错误状态。
    }
  };

  const deleteSource = (id: string) => {
    setSources((current) => current.filter((source) => source.id !== id));
    setTests((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const testSource = async (source: KnowledgeSource) => {
    const sourcePath = source.path.trim();
    if (!sourcePath) {
      setTests((current) => ({ ...current, [source.id]: { result: { ok: false, reason: '路径不能为空' } } }));
      return;
    }

    setTests((current) => ({ ...current, [source.id]: { loading: true } }));
    try {
      const response = await fetch('/api/knowledge/sources/test', {
        method: 'POST',
        headers: jsonAuthHeaders(),
        body: JSON.stringify({ path: sourcePath }),
      });
      const result = await readJson<KnowledgeTestResult>(response);
      setTests((current) => ({ ...current, [source.id]: { result } }));
    } catch (testError) {
      setTests((current) => ({ ...current, [source.id]: { result: { ok: false, reason: (testError as Error).message } } }));
    }
  };

  const saveSources = async () => {
    await saveSourceList(sources, '已保存。现在可以在 Agent 创建页按需勾选这些知识库。').catch(() => {});
  };

  return (
    <div>
      <div className="page-header">
        <h1>📚 知识库</h1>
        <p>导入可绑定到 Agent 的本地文件夹，每个知识库对应一个只读目录。</p>
      </div>

      {error && <div className="card mb-4" style={{ borderColor: 'var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}
      {status && <div className="card mb-4" style={{ borderColor: 'var(--success)', background: 'var(--success-bg)', color: 'var(--success)' }}>{status}</div>}
      {!canSave && (
        <div className="card mb-4" style={{ borderColor: 'var(--warning)', background: 'var(--warning-bg)', color: 'var(--warning)' }}>
          当前账号不是租户管理员，可以查看和测试知识库路径，但保存需要管理员权限。
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex-between" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div>
            <div className="card-header" style={{ marginBottom: 4 }}>导入本地文件夹</div>
            <div className="tool-card-desc">
              扫描服务端本机允许目录，把 Obsidian vault 或 markdown 笔记目录加入我的知识库。
            </div>
          </div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => void importInputPathDirectly()} disabled={directImportLoading || !canSave}>
              {directImportLoading ? '导入中...' : '直接导入文件夹'}
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void scanLocalSources()} disabled={scanLoading || !canSave}>
              {scanLoading ? '扫描中...' : '扫描'}
            </button>
          </div>
        </div>
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>本地文件夹或允许根目录</label>
            <input
              value={scanPath}
              onChange={e => setScanPath(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void scanLocalSources(); }}
              placeholder="/Users/xiaoqin/Documents 或 /Users/xiaoqin/Documents/每日AI分享"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }}
              disabled={!canSave}
            />
          </div>
          <div style={{ fontSize: '.76em', color: 'var(--ink-muted)', lineHeight: 1.6 }}>
            {scanRoots.length > 0 ? (
              <>
                <div style={{ fontWeight: 600, color: 'var(--ink-secondary)' }}>允许根目录</div>
                {scanRoots.map((root) => <div key={root} style={{ fontFamily: 'var(--font-mono)' }}>{root}</div>)}
              </>
            ) : (
              <div>可以输入 /Users/xiaoqin/Documents 作为扫描根目录，也可以输入其中任意子文件夹后直接导入。</div>
            )}
          </div>
        </div>
        {scanError && <div style={{ color: 'var(--danger)', fontSize: '.8em', marginTop: 10 }}>{scanError}</div>}
        {candidates.length > 0 && (
          <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div className="flex-between" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '.82em', fontWeight: 600 }}>
                候选目录 {selectedCandidatePaths.length}/{candidates.length}
              </span>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={() => setSelectedCandidatePaths(candidates.filter((candidate) => !existingPaths.has(candidate.path)).map((candidate) => candidate.path))}>全选新目录</button>
                <button className="btn btn-sm" onClick={() => setSelectedCandidatePaths([])}>清空</button>
                <button className="btn btn-sm btn-primary" onClick={() => void importSelectedCandidates()} disabled={saving}>导入选中</button>
              </div>
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {candidates.map((candidate) => {
                const exists = existingPaths.has(candidate.path);
                return (
                  <label
                    key={candidate.path}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                      gap: 10,
                      alignItems: 'start',
                      padding: '10px',
                      borderBottom: '1px solid var(--border)',
                      opacity: exists ? .55 : 1,
                      cursor: exists ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCandidatePaths.includes(candidate.path)}
                      disabled={exists}
                      onChange={() => toggleCandidate(candidate.path)}
                      style={{ width: 'auto', marginTop: 3 }}
                    />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 700 }}>{candidate.name}</span>
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.72em', color: 'var(--ink-secondary)', overflowWrap: 'anywhere', marginTop: 2 }}>
                        {candidate.path}
                      </span>
                      {candidate.sampleFiles.length > 0 && (
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                          {candidate.sampleFiles.slice(0, 4).map((file) => <span className="badge badge-muted" key={file}>{file}</span>)}
                        </span>
                      )}
                    </span>
                    <span className={exists ? 'badge badge-muted' : 'badge badge-info'}>
                      {exists ? '已添加' : `${candidate.fileCount} .md`}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex-between" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div className="card-header" style={{ marginBottom: 4 }}>我的知识库</div>
            <div className="tool-card-desc">已导入 {sources.length} 个知识库，{enabledCount} 个可被 Agent 勾选。保存时会校验目录存在、可读，并且位于服务器允许的根目录内。</div>
          </div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={addSource} disabled={saving}>+ 添加</button>
            <button className="btn btn-sm" onClick={() => void loadSources()} disabled={loading || saving}>刷新</button>
            <button className="btn btn-sm btn-primary" onClick={() => void saveSources()} disabled={!changed || saving || !canSave}>
              {saving ? '保存中...' : '保存知识库'}
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--ink-muted)', padding: 24, textAlign: 'center' }}>加载中...</div>
        ) : sources.length === 0 ? (
          <div style={{ color: 'var(--ink-muted)', padding: 24, textAlign: 'center' }}>
            还没有知识库。导入一个 Obsidian vault 或 markdown 笔记目录后，就能在 Agent 创建页勾选它。
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 170 }}>知识库名称</th>
                  <th>路径</th>
                  <th style={{ width: 90 }}>可选</th>
                  <th style={{ width: 110 }}>只读</th>
                  <th style={{ width: 220 }}>测试</th>
                  <th style={{ width: 90 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => {
                  const test = tests[source.id];
                  return (
                    <tr key={source.id}>
                      <td>
                        <input
                          value={source.name}
                          onChange={e => updateSource(source.id, { name: e.target.value })}
                          placeholder="主 vault"
                        />
                      </td>
                      <td>
                        <input
                          value={source.path}
                          onChange={e => updateSource(source.id, { path: e.target.value })}
                          placeholder="/Users/xiaoqin/Obsidian/MainVault"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }}
                        />
                      </td>
                      <td>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={source.enabled}
                            onChange={e => updateSource(source.id, { enabled: e.target.checked })}
                            style={{ width: 'auto', margin: 0 }}
                          />
                          <span>{source.enabled ? '可选' : '停用'}</span>
                        </label>
                      </td>
                      <td><span className="badge badge-muted">只读</span></td>
                      <td>
                        <div style={{ display: 'grid', gap: 6 }}>
                          <button className="btn btn-sm" onClick={() => void testSource(source)} disabled={test?.loading}>
                            {test?.loading ? '测试中...' : '测试'}
                          </button>
                          {test?.result && (
                            <div style={{ fontSize: '.74em', color: test.result.ok ? 'var(--success)' : 'var(--danger)' }}>
                              {test.result.ok
                                ? `可读 · ${test.result.fileCount || 0} 个 .md`
                                : test.result.reason || '不可用'}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={() => deleteSource(source.id)} disabled={saving}>删除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {Object.values(tests).some((test) => test.result?.ok && test.result.sampleFiles?.length) && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">测试样例</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {sources.map((source) => {
              const result = tests[source.id]?.result;
              if (!result?.ok || !result.sampleFiles?.length) return null;
              return (
                <div key={source.id} className="tool-card" style={{ padding: 12 }}>
                  <div className="tool-card-name">{source.name || source.path}</div>
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {result.sampleFiles.map((file) => <span className="badge badge-info" key={file}>{file}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

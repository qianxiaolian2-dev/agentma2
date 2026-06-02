import { useEffect, useMemo, useRef, useState } from 'react';
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

type UploadSelection = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  selected: boolean;
  file: File;
};

type TestState = {
  loading?: boolean;
  result?: KnowledgeTestResult;
};

const jsonAuthHeaders = () => getAuthHeaders({ 'Content-Type': 'application/json' });
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [savedSources, setSavedSources] = useState<KnowledgeSource[]>([]);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [directImportLoading, setDirectImportLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const [folderName, setFolderName] = useState('');
  const [uploadFiles, setUploadFiles] = useState<UploadSelection[]>([]);

  const changed = useMemo(() => JSON.stringify(sources) !== JSON.stringify(savedSources), [sources, savedSources]);
  const enabledCount = sources.filter((source) => source.enabled && source.path.trim()).length;

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

  const handleFolderPicked = (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    const textFiles = files.filter((file) => {
      const name = file.name.toLowerCase();
      return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt');
    });
    const next = textFiles.map((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return {
        id: `${relativePath}:${file.size}:${file.lastModified}`,
        name: file.name,
        relativePath,
        size: file.size,
        selected: true,
        file,
      };
    });
    const firstPath = next[0]?.relativePath || '';
    setFolderName(firstPath.includes('/') ? firstPath.split('/')[0] : defaultSourceNameFromPath(firstPath || '上传知识库'));
    setUploadFiles(next);
    setScanError(next.length ? '' : '这个文件夹里没有可上传的 markdown 或文本文件');
    setStatus('');
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const toggleUploadFile = (id: string) => {
    setUploadFiles((current) => current.map((item) => (
      item.id === id ? { ...item, selected: !item.selected } : item
    )));
  };

  const uploadSelectedFolderFiles = async () => {
    const selected = uploadFiles.filter((file) => file.selected);
    if (!selected.length) {
      setScanError('请先勾选要上传的文件');
      return;
    }
    const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_UPLOAD_BYTES) {
      setScanError(`选中文件总大小 ${formatBytes(totalBytes)}，单次最多上传 ${formatBytes(MAX_UPLOAD_BYTES)}`);
      return;
    }
    setDirectImportLoading(true);
    setScanError('');
    setStatus('');
    try {
      const files = await Promise.all(selected.map(async (item) => ({
        relativePath: item.relativePath,
        content: await item.file.text(),
      })));
      const response = await fetch('/api/knowledge/sources/upload', {
        method: 'POST',
        headers: jsonAuthHeaders(),
        body: JSON.stringify({
          name: folderName.trim() || '上传知识库',
          files,
        }),
      });
      const data = await readJson<unknown>(response);
      const next = normalizeSources(data);
      setSources(next);
      setSavedSources(next);
      setUploadFiles([]);
      setStatus(`已上传 ${selected.length} 个文件并导入知识库，现在可以在 Agent 创建页勾选。`);
    } catch (uploadFailure) {
      setScanError((uploadFailure as Error).message || '上传知识库失败');
    } finally {
      setDirectImportLoading(false);
    }
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
            <div className="card-header" style={{ marginBottom: 4 }}>上传本地文件夹</div>
            <div className="tool-card-desc">
              打开本地文件夹后勾选要上传的 markdown 或文本文件，上传后会生成一个可绑定到 Agent 的知识库。
            </div>
          </div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              {...{ webkitdirectory: '', directory: '' }}
              onChange={e => handleFolderPicked(e.currentTarget.files)}
              style={{ display: 'none' }}
            />
            <button className="btn btn-sm" onClick={() => folderInputRef.current?.click()} disabled={!canSave || directImportLoading}>
              打开文件夹
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void uploadSelectedFolderFiles()} disabled={!canSave || directImportLoading || uploadFiles.filter(file => file.selected).length === 0}>
              {directImportLoading ? '上传中...' : '上传选中文件'}
            </button>
          </div>
        </div>

        {scanError && <div style={{ color: 'var(--danger)', fontSize: '.8em', marginTop: 10 }}>{scanError}</div>}

        {uploadFiles.length > 0 && (
          <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div className="flex-between" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '.82em', fontWeight: 700 }}>
                  {folderName || '上传知识库'}
                </div>
                <div style={{ fontSize: '.74em', color: 'var(--ink-muted)' }}>
                  已选 {uploadFiles.filter(file => file.selected).length}/{uploadFiles.length} 个文件
                </div>
              </div>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                <input
                  value={folderName}
                  onChange={e => setFolderName(e.target.value)}
                  placeholder="知识库名称"
                  style={{ width: 180 }}
                />
                <button className="btn btn-sm" onClick={() => setUploadFiles(current => current.map(file => ({ ...file, selected: true })))}>全选</button>
                <button className="btn btn-sm" onClick={() => setUploadFiles(current => current.map(file => ({ ...file, selected: false })))}>清空</button>
              </div>
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {uploadFiles.map((item) => (
                <label
                  key={item.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                    gap: 10,
                    alignItems: 'start',
                    padding: '10px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => toggleUploadFile(item.id)}
                    style={{ width: 'auto', marginTop: 3 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700 }}>{item.name}</span>
                    <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.72em', color: 'var(--ink-secondary)', overflowWrap: 'anywhere', marginTop: 2 }}>
                      {item.relativePath}
                    </span>
                  </span>
                  <span className="badge badge-muted">{formatBytes(item.size)}</span>
                </label>
              ))}
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

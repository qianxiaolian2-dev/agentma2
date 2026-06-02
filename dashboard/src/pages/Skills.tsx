import { useState, useEffect } from 'react';
import type { SkillInfo } from '../simulator/types';
import { initSkills, saveSkills } from '../simulator/mock-data';
import { getAuthHeaders } from '../utils/client-runtime';
import StatusBadge from '../components/common/StatusBadge';

const LOCATION_LABELS: Record<string, { label: string; color: string }> = {
  user: { label: '用户级', color: 'var(--info)' },
  project: { label: '项目级', color: 'var(--success)' },
  plugin: { label: '插件', color: 'var(--warning)' },
};

export default function Skills() {
  const [skills, setSkills] = useState<SkillInfo[]>(() => initSkills());

  useEffect(() => {
    saveSkills(skills);
  }, [skills]);

  const toggleSkill = (name: string) => {
    setSkills(prev => prev.map(s => s.name === name ? { ...s, enabled: !s.enabled } : s));
  };

  // GitHub 导入
  const [ghUrl, setGhUrl] = useState('');
  const [ghLoading, setGhLoading] = useState(false);
  const [ghMsg, setGhMsg] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [localMsg, setLocalMsg] = useState('');
  const [localCandidates, setLocalCandidates] = useState<SkillInfo[]>([]);
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<string[]>([]);

  const handleImportFromGitHub = async () => {
    if (!ghUrl.trim()) return;
    setGhLoading(true);
    setGhMsg('');

    try {
      // 自动将 github.com URL 转为 raw URL
      let rawUrl = ghUrl.trim();
      if (rawUrl.includes('github.com') && !rawUrl.includes('raw.githubusercontent.com')) {
        rawUrl = rawUrl
          .replace('https://github.com/', 'https://raw.githubusercontent.com/')
          .replace('/blob/', '/');
      }
      // 如果不是 SKILL.md 结尾，追加
      if (!rawUrl.endsWith('SKILL.md') && !rawUrl.endsWith('.md')) {
        rawUrl = rawUrl.replace(/\/$/, '') + '/SKILL.md';
      }

      const res = await fetch(rawUrl);
      if (!res.ok) {
        setGhMsg(`获取失败: HTTP ${res.status}, 请检查 URL 是否正确`);
        setGhLoading(false);
        return;
      }

      const content = await res.text();
      // 从 URL 路径提取技能名：/owner/repo/main/skill-name/SKILL.md
      const parts = rawUrl.replace('/SKILL.md', '').split('/');
      const skillName = parts[parts.length - 1] || 'imported-skill';

      // 检查是否已存在
      if (skills.find(s => s.name === skillName)) {
        setGhMsg(`技能 "${skillName}" 已存在，跳过导入`);
        setGhLoading(false);
        return;
      }

      // 尝试从 markdown 提取描述（取第一个 # 标题）
      const titleMatch = content.match(/^#\s+(.+)/m);
      const description = titleMatch ? titleMatch[1] : `从 GitHub 导入: ${rawUrl}`;

      const newSkill: SkillInfo = {
        name: skillName,
        description,
        location: 'plugin',
        path: rawUrl.replace('/SKILL.md', '/'),
        enabled: true,
      };

      setSkills(prev => [...prev, newSkill]);
      setGhUrl('');
      setGhMsg(`✓ 已导入 "${skillName}"`);
    } catch (e) {
      setGhMsg(`导入失败: ${(e as Error).message}`);
    }
    setGhLoading(false);
  };

  const toSkillInfo = (data: Record<string, unknown>, fallbackPath: string): SkillInfo => {
    const location = data.location === 'project' || data.location === 'plugin' ? data.location : 'user';
    return {
      name: String(data.name || '').trim() || 'local-skill',
      description: String(data.description || '').trim() || `本地技能: ${fallbackPath}`,
      location,
      path: String(data.path || fallbackPath),
      enabled: true,
    };
  };

  const handleScanLocalPath = async () => {
    const inputPath = localPath.trim();
    if (!inputPath) return;
    setLocalLoading(true);
    setLocalMsg('');
    setLocalCandidates([]);
    setSelectedLocalPaths([]);

    try {
      const res = await fetch('/api/skills/scan-local', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: inputPath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLocalMsg(`扫描失败: ${data.error || `HTTP ${res.status}`}`);
        return;
      }

      const candidates: SkillInfo[] = Array.isArray(data.skills)
        ? data.skills.map((item: Record<string, unknown>) => toSkillInfo(item, inputPath))
        : [];
      if (!candidates.length) {
        setLocalMsg('没有找到可导入的技能');
        return;
      }

      const existingNames = new Set(skills.map(s => s.name));
      const defaultSelected = candidates
        .filter((skill: SkillInfo) => !existingNames.has(skill.name))
        .map((skill: SkillInfo) => skill.path);
      setLocalCandidates(candidates);
      setSelectedLocalPaths(defaultSelected);
      setLocalMsg(`✓ 找到 ${candidates.length} 个技能，已选择 ${defaultSelected.length} 个可导入项`);
    } catch (e) {
      setLocalMsg(`扫描失败: ${(e as Error).message}`);
    } finally {
      setLocalLoading(false);
    }
  };

  const toggleLocalCandidate = (skillPath: string) => {
    setSelectedLocalPaths(prev => (
      prev.includes(skillPath) ? prev.filter(path => path !== skillPath) : [...prev, skillPath]
    ));
  };

  const selectAllLocalCandidates = () => {
    const existingNames = new Set(skills.map(s => s.name));
    setSelectedLocalPaths(localCandidates.filter(skill => !existingNames.has(skill.name)).map(skill => skill.path));
  };

  const importSelectedLocalSkills = () => {
    const selected = localCandidates.filter(skill => selectedLocalPaths.includes(skill.path));
    if (!selected.length) {
      setLocalMsg('请先选择要导入的技能');
      return;
    }

    const existingNames = new Set(skills.map(s => s.name));
    const toAdd = selected.filter(skill => !existingNames.has(skill.name));
    const skipped = selected.length - toAdd.length;
    if (toAdd.length > 0) setSkills(prev => [...prev, ...toAdd]);
    setLocalPath('');
    setLocalCandidates([]);
    setSelectedLocalPaths([]);
    setLocalMsg(`✓ 已导入 ${toAdd.length} 个技能${skipped ? `，跳过 ${skipped} 个已存在` : ''}`);
  };

  const enabledCount = skills.filter(s => s.enabled).length;

  return (
    <div>
      <div className="page-header">
        <h1>🎒 技能背包</h1>
        <p>管理 Agent Skills — 扩展 Agent 的专业能力，模型按需自动调用</p>
      </div>

      {/* 用法说明 */}
      <div className="card mb-4" style={{ background: 'var(--info-bg)', borderColor: 'var(--info)' }}>
        <div className="card-header">Skills 使用方式</div>
        <div style={{ fontSize: '.82em', lineHeight: 1.8 }}>
          <p>Skills 在文件系统中定义为 <code>.claude/skills/&lt;name&gt;/SKILL.md</code>，SDK 启动时自动发现。</p>
          <p>在 SDK Options 中通过 <code>skills</code> 参数控制：</p>
          <ul style={{ paddingLeft: 20, marginTop: 6 }}>
            <li><code>skills: "all"</code> — 启用全部已安装技能</li>
            <li><code>skills: ["pdf", "code-review"]</code> — 只启用指定技能</li>
            <li><code>skills: []</code> 或不传 — 禁用所有技能</li>
          </ul>
        </div>
      </div>

      {/* 从 GitHub 导入 */}
      <div className="card mb-4">
        <div className="card-header">从 GitHub 导入技能</div>
        <div style={{ fontSize: '.82em', color: 'var(--ink-secondary)', marginBottom: 10 }}>
          输入 GitHub 仓库地址或 SKILL.md 原始链接，自动同步技能定义
        </div>
        <div className="flex gap-2" style={{ alignItems: 'flex-start' }}>
          <input
            value={ghUrl}
            onChange={e => setGhUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleImportFromGitHub(); }}
            placeholder="https://github.com/user/skill-repo 或 raw URL"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em', flex: 1 }}
          />
          <button className="btn btn-primary" onClick={handleImportFromGitHub} disabled={ghLoading}>
            {ghLoading ? '导入中...' : '导入'}
          </button>
        </div>
        {ghMsg && (
          <div className="mt-2" style={{
            fontSize: '.8em',
            color: ghMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)',
          }}>
            {ghMsg}
          </div>
        )}
      </div>

      {/* 从本地路径导入 */}
      <div className="card mb-4">
        <div className="card-header">从本地路径导入技能</div>
        <div style={{ fontSize: '.82em', color: 'var(--ink-secondary)', marginBottom: 10 }}>
          输入本机技能目录或 SKILL.md 路径，页面会读取元数据并加入技能列表
        </div>
        <div className="flex gap-2" style={{ alignItems: 'flex-start' }}>
          <input
            value={localPath}
            onChange={e => setLocalPath(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleScanLocalPath(); }}
            placeholder="/Users/xiaoqin/.codex/skills 或 /path/to/SKILL.md"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em', flex: 1 }}
          />
          <button className="btn btn-primary" onClick={handleScanLocalPath} disabled={localLoading}>
            {localLoading ? '扫描中...' : '扫描'}
          </button>
        </div>
        {localCandidates.length > 0 && (
          <div className="mt-3" style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div className="flex-between" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '.82em', fontWeight: 600 }}>
                候选技能 {selectedLocalPaths.length}/{localCandidates.length}
              </span>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={selectAllLocalCandidates}>全选</button>
                <button className="btn btn-sm" onClick={() => setSelectedLocalPaths([])}>清空</button>
                <button className="btn btn-primary btn-sm" onClick={importSelectedLocalSkills}>
                  导入选中
                </button>
              </div>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {localCandidates.map(skill => {
                const exists = skills.some(item => item.name === skill.name);
                return (
                  <label
                    key={skill.path}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: 10,
                      alignItems: 'start',
                      padding: '9px 10px',
                      borderBottom: '1px solid var(--border)',
                      opacity: exists ? .55 : 1,
                      cursor: exists ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedLocalPaths.includes(skill.path)}
                      disabled={exists}
                      onChange={() => toggleLocalCandidate(skill.path)}
                      style={{ width: 'auto', marginTop: 3 }}
                    />
                    <span>
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.82em', fontWeight: 600 }}>
                        {skill.name}
                      </span>
                      <span style={{ display: 'block', fontSize: '.75em', color: 'var(--ink-secondary)', marginTop: 2 }}>
                        {skill.description}
                      </span>
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.68em', color: 'var(--ink-muted)', marginTop: 2 }}>
                        {skill.path}
                      </span>
                    </span>
                    {exists && <span className="badge badge-muted">已存在</span>}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {localMsg && (
          <div className="mt-2" style={{
            fontSize: '.8em',
            color: localMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)',
          }}>
            {localMsg}
          </div>
        )}
      </div>

      {/* 技能统计 */}
      <div className="grid-3 mb-4">
        <div className="kpi-card">
          <div className="kpi-label">已安装</div>
          <div className="kpi-value">{skills.length}</div>
          <div className="kpi-sub">个技能</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">已启用</div>
          <div className="kpi-value" style={{ color: 'var(--success)' }}>{enabledCount}</div>
          <div className="kpi-sub">{skills.length - enabledCount} 个未启用</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">位置分布</div>
          <div className="kpi-value" style={{ fontSize: '.9em', fontFamily: 'var(--font-mono)' }}>
            用户 {skills.filter(s => s.location === 'user').length}
            · 项目 {skills.filter(s => s.location === 'project').length}
            · 插件 {skills.filter(s => s.location === 'plugin').length}
          </div>
        </div>
      </div>

      {/* 技能列表 */}
      <div className="section-title">技能列表</div>
      {['user', 'project', 'plugin'].map(loc => {
        const group = skills.filter(s => s.location === loc);
        if (group.length === 0) return null;
        const locInfo = LOCATION_LABELS[loc];

        return (
          <div key={loc} className="mb-4">
            <div className="flex gap-2 mb-2" style={{ alignItems: 'center' }}>
              <span className="badge" style={{ background: locInfo.color + '20', color: locInfo.color }}>
                {locInfo.label}
              </span>
              <span style={{ fontSize: '.78em', color: 'var(--ink-muted)' }}>
                {loc === 'user' ? '~/.claude/skills/' : loc === 'project' ? '.claude/skills/' : '插件自带'}
              </span>
            </div>
            <div className="grid-2">
              {group.map(skill => (
                <div
                  key={skill.name}
                  className="tool-card"
                  style={{
                    borderColor: skill.enabled ? 'var(--success)' : 'var(--border)',
                    opacity: skill.enabled ? 1 : .6,
                  }}
                >
                  <div className="flex-between">
                    <div>
                      <div className="tool-card-name" style={{ fontFamily: 'var(--font-mono)' }}>
                        {skill.name}
                      </div>
                      <div className="tool-card-desc">{skill.description}</div>
                      <div className="mt-1" style={{ fontSize: '.72em', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}>
                        {skill.path}
                      </div>
                    </div>
                    <div className="flex gap-2" style={{ flexDirection: 'column', alignItems: 'center' }}>
                      <StatusBadge status={skill.enabled ? 'success' : 'disabled'} label={skill.enabled ? '启用' : '禁用'} />
                      <button
                        className={`btn btn-sm ${skill.enabled ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() => toggleSkill(skill.name)}
                      >
                        {skill.enabled ? '停用' : '启用'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

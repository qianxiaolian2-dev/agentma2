import { useState, useEffect } from 'react';
import type { SkillInfo } from '../simulator/types';
import { initSkills, saveSkills } from '../simulator/mock-data';
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

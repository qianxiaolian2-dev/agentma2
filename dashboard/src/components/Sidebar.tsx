import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const SECTIONS = [
  {
    title: '核心',
    items: [
      { path: '/', label: '总览', icon: '◈' },
      { path: '/conversations', label: '会话', icon: '💬' },
      { path: '/agents', label: 'Agent 市场', icon: '🤖' },
      { path: '/playground', label: 'Playground', icon: '▶' },
      { path: '/settings', label: '全局设置', icon: '⚙' },
    ],
  },
  {
    title: '接口',
    items: [
      { path: '/tools', label: '工具背包', icon: '🎒' },
      { path: '/skills', label: '技能背包', icon: '✨' },
      { path: '/hooks', label: 'Hook 系统', icon: '🪝' },
      { path: '/subagents', label: '子代理管理', icon: '🤖' },
      { path: '/permissions', label: '权限系统', icon: '🛡' },
    ],
  },
  {
    title: '运维',
    items: [
      { path: '/observability', label: '可观测性', icon: '📊' },
    ],
  },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  return (
    <nav className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-logo">🐾 AgentMa</div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {SECTIONS.map(section => (
          <div className="sidebar-section" key={section.title}>
            <div className="sidebar-section-title">{section.title}</div>
            {section.items.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={onNavigate}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: '.8em' }}>
        {user && <div style={{ marginBottom: 6, color: 'var(--ink-secondary)' }}>{user.email}</div>}
        <button className="btn btn-sm" onClick={logout} style={{ width: '100%' }}>登出</button>
      </div>
    </nav>
  );
}

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
      { path: '/account', label: '账户管理', icon: '👤' },
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

type SidebarProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
  onToggleCollapsed?: () => void;
};

export default function Sidebar({ collapsed = false, onNavigate, onToggleCollapsed }: SidebarProps) {
  const { user, logout } = useAuth();
  return (
    <nav className="sidebar-body" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-logo-row">
        <div className="sidebar-logo" title="AgentMa">
          <span className="sidebar-logo-mark">🐾</span>
          <span className="sidebar-logo-text">AgentMa</span>
        </div>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
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
                title={collapsed ? item.label : undefined}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              >
                <span className="sidebar-link-icon">{item.icon}</span>
                <span className="sidebar-link-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        {user && <div className="sidebar-user" title={user.email}>{user.email}</div>}
        <button className="btn btn-sm sidebar-logout-btn" onClick={logout} title="登出">
          <span className="sidebar-logout-icon">⎋</span>
          <span className="sidebar-link-label">登出</span>
        </button>
      </div>
    </nav>
  );
}

import { NavLink } from 'react-router-dom';

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

export default function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">🐾 AgentMa</div>
      {SECTIONS.map(section => (
        <div className="sidebar-section" key={section.title}>
          <div className="sidebar-section-title">{section.title}</div>
          {section.items.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

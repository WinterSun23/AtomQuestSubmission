import { useNavigate, useLocation } from 'react-router-dom'
import { signOut } from '../lib/auth'
import { useApp } from '../lib/AppContext'
import './AdminLayout.css'

const NAV = [
  {
    section: 'Overview',
    items: [
      { id: 'dashboard',   label: 'Dashboard',     icon: '📊', path: '/admin' },
      { id: 'reports',     label: 'Reports',       icon: '📈', path: '/admin/reports' },
    ],
  },
  {
    section: 'Organisation',
    items: [
      { id: 'users',       label: 'Users',          icon: '👥', path: '/admin/users' },
      { id: 'thrust',      label: 'Thrust Areas',   icon: '🎯', path: '/admin/thrust-areas' },
    ],
  },
  {
    section: 'Performance',
    items: [
      { id: 'cycles',      label: 'Cycles & Windows', icon: '📅', path: '/admin/cycles' },
      { id: 'unlock',      label: 'Goal Unlock',    icon: '🔓', path: '/admin/goal-unlock' },
    ],
  },
  {
    section: 'Monitoring',
    items: [
      { id: 'escalations', label: 'Escalations',   icon: '🚨', path: '/admin/escalations' },
      { id: 'audit',       label: 'Audit Log',     icon: '📋', path: '/admin/audit-log' },
    ],
  },
  {
    section: 'Config',
    items: [
      { id: 'settings',    label: 'Settings',       icon: '⚙️',  path: '/admin/settings' },
    ],
  }
]

export default function AdminLayout({ children, openEscalations = 0 }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { me, loading } = useApp()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  if (loading) return null

  return (
    <div className="admin-shell">
      {/* ── Top bar ── */}
      <header className="admin-topbar">
        <a className="admin-topbar-logo" href="/admin">
          🎯 GoalFlow <span className="admin-topbar-badge">ADMIN</span>
        </a>
        <div className="admin-topbar-right">
          <button className="admin-topbar-signout" onClick={() => navigate('/dashboard')} style={{ marginRight: '10px', background: '#f3f4f6' }}>
            🏠 Switch to Portal
          </button>
          <span className="admin-topbar-user">{me?.name || me?.email?.split('@')[0]}</span>
          <button className="admin-topbar-signout" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {/* ── Sidebar ── */}
      <nav className="admin-sidebar">
        {NAV.map(group => (
          <div key={group.section}>
            <div className="admin-nav-section">{group.section}</div>
            {group.items.map(item => (
              <button
                key={item.id}
                id={`admin-nav-${item.id}`}
                className={`admin-nav-link ${location.pathname === item.path ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {item.id === 'escalations' && openEscalations > 0 && (
                  <span className="nav-badge">{openEscalations}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* ── Page content ── */}
      <main className="admin-main">
        {children}
      </main>
    </div>
  )
}

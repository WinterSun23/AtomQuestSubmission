import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { signOut } from '../lib/auth'
import { useApp } from '../lib/AppContext'
import './UserLayout.css'

export default function UserLayout({ children }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { me, loading } = useApp()
  
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)

  useEffect(() => {
    if (loading || !me) return

    let channel

    async function loadNotifications() {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', me.auth_id)
        .order('created_at', { ascending: false })
        .limit(5)

      if (data) {
        setNotifications(data)
        setUnreadCount(data.filter(n => !n.is_read).length)
      }

      // Realtime notification sync using Supabase WebSockets
      channel = supabase
        .channel(`user-notifications-${me.auth_id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${me.auth_id}`
          },
          (payload) => {
            setNotifications(prev => [payload.new, ...prev].slice(0, 5))
            setUnreadCount(prev => prev + 1)
          }
        )
        .subscribe()
    }
    
    loadNotifications()
    
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [loading, me])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  // Navigation structure based on role
  const NAV = [
    {
      section: 'My Portal',
      items: [
        { id: 'goals',       label: 'My Goals',         icon: '🎯', path: '/dashboard/my-goals' },
        { id: 'checkins',    label: 'My Check-ins',     icon: '📝', path: '/dashboard/my-checkins' },
        { id: 'preferences', label: 'Preferences',      icon: '⚙️', path: '/dashboard/preferences' },
      ],
    }
  ]

  // Add manager section if role is manager or admin
  if (me?.role === 'manager' || me?.role === 'admin') {
    NAV.push({
      section: 'Team Portal',
      items: [
        { id: 'team-goals',    label: 'Team Goals',     icon: '👥', path: '/dashboard/team-goals' },
        { id: 'team-checkins', label: 'Team Check-ins', icon: '✅', path: '/dashboard/team-checkins' },
        { id: 'reports',       label: 'Reports',        icon: '📊', path: '/dashboard/reports' },
      ]
    })
  }

  if (loading) return null

  return (
    <div className="user-shell">
      {/* ── Top bar ── */}
      <header className="user-topbar">
        <a className="user-topbar-logo" href="/dashboard">
          🎯 GoalFlow <span className="user-topbar-badge">PORTAL</span>
        </a>
        <div className="user-topbar-right">
          <div style={{ position: 'relative', marginRight: '15px' }}>
            <button 
              id="topbar-bell"
              className="user-topbar-signout" 
              style={{ background: 'transparent', fontSize: '1.2rem', padding: '0 8px', position: 'relative', border: 'none', cursor: 'pointer' }}
              onClick={() => setShowDropdown(!showDropdown)}
            >
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: '#ef4444',
                  color: 'white',
                  fontSize: '0.65rem',
                  fontWeight: 'bold',
                  borderRadius: '50%',
                  padding: '1px 5px',
                  lineHeight: 1
                }}>
                  {unreadCount}
                </span>
              )}
            </button>

            {showDropdown && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                width: '280px',
                zIndex: 100,
                marginTop: '8px',
                padding: '8px 0'
              }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 600, color: '#374151', fontSize: '0.85rem', textAlign: 'left' }}>
                  Notifications
                </div>
                {notifications.length === 0 ? (
                  <div style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem' }}>
                    No recent alerts
                  </div>
                ) : (
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {notifications.map(n => (
                      <div 
                        key={n.id} 
                        onClick={async () => {
                          await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
                          setUnreadCount(prev => Math.max(0, prev - 1))
                          setShowDropdown(false)
                          if (n.link) navigate(n.link)
                        }}
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #f9fafb',
                          fontSize: '0.78rem',
                          background: n.is_read ? 'transparent' : '#f0f0ff',
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <div style={{ fontWeight: n.is_read ? 400 : 600, color: '#1f2937' }}>{n.message}</div>
                        <div style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: '2px' }}>{new Date(n.created_at).toLocaleTimeString()}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ padding: '4px 12px', borderTop: '1px solid #f3f4f6', textAlign: 'center' }}>
                  <button 
                    onClick={() => { setShowDropdown(false); navigate('/dashboard/preferences') }}
                    style={{ background: 'none', border: 'none', color: '#4f46e5', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    View All & Settings
                  </button>
                </div>
              </div>
            )}
          </div>
          {me?.role === 'admin' && (
            <button className="user-topbar-signout" onClick={() => navigate('/admin')} style={{ marginRight: '10px', background: '#f3f4f6' }}>
              ⚙️ Switch to Admin
            </button>
          )}
          <span className="user-topbar-user">{me?.name || me?.email?.split('@')[0]}</span>
          <button className="user-topbar-signout" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {/* ── Sidebar ── */}
      <nav className="user-sidebar">
        {NAV.map(group => (
          <div key={group.section}>
            <div className="user-nav-section">{group.section}</div>
            {group.items.map(item => (
              <button
                key={item.id}
                id={`user-nav-${item.id}`}
                className={`user-nav-link ${location.pathname === item.path ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* ── Page content ── */}
      <main className="user-main">
        {children}
      </main>
    </div>
  )
}

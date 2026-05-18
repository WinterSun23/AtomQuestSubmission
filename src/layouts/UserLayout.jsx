import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { signOut } from '../lib/auth'
import { useApp } from '../lib/AppContext'
import './UserLayout.css'

export default function UserLayout({ children }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { me, loading, settings } = useApp()
  
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)

  // 1. Handle Redirections and Notification Loading on Route Navigation
  useEffect(() => {
    if (loading || !me) return

    // Smart Role Redirections
    if (me.role === 'admin') {
      navigate('/admin')
      return
    } else if (me.role === 'manager' && (location.pathname === '/dashboard/my-goals' || location.pathname === '/dashboard')) {
      navigate('/dashboard/overview')
      return
    }

    async function loadNotifications() {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', me.id)
        .order('created_at', { ascending: false })
        .limit(5)

      if (data) {
        setNotifications(data)
        setUnreadCount(data.filter(n => !n.is_read).length)
      }
    }
    
    loadNotifications()
  }, [loading, me, location.pathname])

  // 2. Real-Time WebSockets Notifications Subscription (Persists stably across sub-page navigations)
  useEffect(() => {
    if (loading || !me?.id) return

    const channel = supabase
      .channel(`user-notifications-${me.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${me.id}`
        },
        (payload) => {
          setNotifications(prev => [payload.new, ...prev].slice(0, 5))
          setUnreadCount(prev => prev + 1)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loading, me?.id])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  // Navigation structure based on role
  const NAV = []

  if (me?.role === 'employee') {
    NAV.push({
      section: 'My Portal',
      items: [
        { id: 'goals',       label: 'My Goals',         icon: '🎯', path: '/dashboard/my-goals' },
        { id: 'checkins',    label: 'My Check-ins',     icon: '📝', path: '/dashboard/my-checkins' },
        { id: 'preferences', label: 'Preferences',      icon: '⚙️', path: '/dashboard/preferences' },
      ],
    })
  }

  if (me?.role === 'manager') {
    NAV.push({
      section: 'My Portal',
      items: [
        { id: 'preferences', label: 'Preferences',      icon: '⚙️', path: '/dashboard/preferences' },
      ],
    })

    NAV.push({
      section: 'Team Portal',
      items: [
        { id: 'overview',      label: 'Team Overview',  icon: '📊', path: '/dashboard/overview' },
        { id: 'team-goals',    label: 'Team Goals & Check-ins', icon: '🎯', path: '/dashboard/team-goals' },
        { id: 'team-escalations', label: 'Team Escalations', icon: '🚨', path: '/dashboard/team-escalations' },
        { id: 'reports',       label: 'Reports',        icon: '📋', path: '/dashboard/reports' },
      ]
    })
  }

  if (me?.role === 'admin') {
    NAV.push({
      section: 'Admin Console',
      items: [
        { id: 'admin-home',  label: 'Admin Settings',  icon: '⚙️', path: '/admin' },
        { id: 'preferences', label: 'Preferences',     icon: '🔧', path: '/dashboard/preferences' },
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
                          if (!n.is_read) {
                            await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
                            setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, is_read: true } : item))
                            setUnreadCount(prev => Math.max(0, prev - 1))
                          }
                          setShowDropdown(false)
                          if (n.link) navigate(n.link)
                        }}
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #f9fafb',
                          fontSize: '0.78rem',
                          background: n.is_read ? 'transparent' : '#f0f0ff',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: n.is_read ? 400 : 600, color: '#1f2937' }}>{n.message}</div>
                          <div style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: '2px' }}>{new Date(n.created_at).toLocaleTimeString()}</div>
                        </div>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            await supabase.from('notifications').delete().eq('id', n.id)
                            setNotifications(prev => prev.filter(item => item.id !== n.id))
                            if (!n.is_read) {
                              setUnreadCount(prev => Math.max(0, prev - 1))
                            }
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            fontSize: '0.9rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="Delete notification"
                        >
                          ✕
                        </button>
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

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

import { useApp } from '../../lib/AppContext'

export default function NotificationPrefs() {
  const { me, loading: contextLoading } = useApp()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [teamsEnabled, setTeamsEnabled] = useState(false)
  const [minEmailSeverity, setMinEmailSeverity] = useState('low')
  const [minTeamsSeverity, setMinTeamsSeverity] = useState('low')
  const [reminderDays, setReminderDays] = useState(3)
  const [notifications, setNotifications] = useState([])

  useEffect(() => {
    if (me) {
      loadPreferencesAndNotifications()
    }
  }, [contextLoading, me])

  async function loadPreferencesAndNotifications() {
    setLoading(true)
    try {
      // Fetch preferences using the internal profile ID (me.id)
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', me.id)
        .maybeSingle()

      if (prefs) {
        setEmailEnabled(prefs.email_enabled)
        setTeamsEnabled(prefs.teams_enabled)
        setReminderDays(prefs.reminder_days_before)
        setMinEmailSeverity(prefs.min_email_severity || 'low')
        setMinTeamsSeverity(prefs.min_teams_severity || 'low')
      }

      // Fetch in-app notifications using me.id
      const { data: list } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', me.id)
        .order('created_at', { ascending: false })
      
      if (list) {
        setNotifications(list)
      }
    } catch (err) {
      console.error('Error loading preferences:', err)
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!me) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: me.id,
          email_enabled: emailEnabled,
          teams_enabled: teamsEnabled,
          reminder_days_before: reminderDays,
          min_email_severity: minEmailSeverity,
          min_teams_severity: minTeamsSeverity,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })

      if (error) throw error
      alert('Preferences saved successfully!')
    } catch (err) {
      alert('Error saving preferences: ' + err.message)
    }
    setSaving(false)
  }

  async function handleMarkAllRead() {
    if (!me) return
    if (!confirm('Are you sure you want to clear all alerts?')) return
    try {
      await supabase
        .from('notifications')
        .delete()
        .eq('user_id', me.id)
      
      setNotifications([])
      alert('All alerts cleared successfully!')
    } catch (err) {
      console.error(err)
    }
  }

  async function handleDeleteNotification(id) {
    try {
      await supabase
        .from('notifications')
        .delete()
        .eq('id', id)
      
      setNotifications(prev => prev.filter(n => n.id !== id))
    } catch (err) {
      console.error('Error deleting notification:', err)
    }
  }

  if (loading) return <div className="user-empty">Loading settings...</div>

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="user-page-header">
        <h1 className="user-page-title">Notification Settings & Alerts</h1>
        <p className="user-page-subtitle">Configure how you receive critical alerts and review recent updates.</p>
      </div>

      <div className="user-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#111827' }}>
          ⚙️ Delivery Preferences
        </h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Email Checkbox */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                id="pref-email-enabled"
                type="checkbox"
                checked={emailEnabled}
                onChange={e => setEmailEnabled(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <div>
                <strong style={{ display: 'block', color: '#374151' }}>Email Notifications</strong>
                <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>Receive alerts when sheets are submitted, approved, or managers update goals.</span>
              </div>
            </label>
            {emailEnabled && (
              <div style={{ marginLeft: '2.25rem', marginTop: '0.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                  Minimum Email Severity
                </label>
                <select
                  id="pref-min-email-severity"
                  className="admin-select"
                  value={minEmailSeverity}
                  onChange={e => setMinEmailSeverity(e.target.value)}
                  style={{ maxWidth: '200px' }}
                >
                  <option value="low">Low (Receive all emails)</option>
                  <option value="medium">Medium (Actions & Deadlines)</option>
                  <option value="high">High (Breaches & Violations only)</option>
                </select>
              </div>
            )}
          </div>

          {/* Teams Checkbox */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                id="pref-teams-enabled"
                type="checkbox"
                checked={teamsEnabled}
                onChange={e => setTeamsEnabled(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <div>
                <strong style={{ display: 'block', color: '#374151' }}>Microsoft Teams Alerts</strong>
                <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>Receive interactive adaptive cards directly in your MS Teams chat.</span>
              </div>
            </label>
            {teamsEnabled && (
              <div style={{ marginLeft: '2.25rem', marginTop: '0.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                  Minimum Teams Severity
                </label>
                <select
                  id="pref-min-teams-severity"
                  className="admin-select"
                  value={minTeamsSeverity}
                  onChange={e => setMinTeamsSeverity(e.target.value)}
                  style={{ maxWidth: '200px' }}
                >
                  <option value="low">Low (Receive all messages)</option>
                  <option value="medium">Medium (Actions & Deadlines)</option>
                  <option value="high">High (Breaches & Violations only)</option>
                </select>
              </div>
            )}
          </div>

          {/* Reminder Days Select */}
          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '1.25rem', marginTop: '0.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#374151' }} htmlFor="pref-reminder-days">
              Submission & Check-in Reminders
            </label>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 0.75rem 0' }}>
              Select how many days before a deadline window closes to receive automated friendly reminder alerts.
            </p>
            <select
              id="pref-reminder-days"
              className="admin-select"
              value={reminderDays}
              onChange={e => setReminderDays(Number(e.target.value))}
              style={{ maxWidth: '200px' }}
            >
              <option value={1}>1 Day Before</option>
              <option value={3}>3 Days Before</option>
              <option value={5}>5 Days Before</option>
              <option value={7}>7 Days Before</option>
            </select>
          </div>
        </div>

        <button
          id="btn-save-preferences"
          className="user-btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: '2rem' }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="user-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#111827' }}>
            🔔 Recent In-App Alerts
          </h3>
          {notifications.length > 0 && (
            <button
              id="btn-mark-all-read"
              onClick={handleMarkAllRead}
              style={{ background: 'none', border: 'none', color: '#ef4444', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
            >
              Clear all alerts
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="user-empty" style={{ padding: '2rem' }}>
            You have no notifications at this time.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {notifications.map(n => (
              <div
                key={n.id}
                style={{
                  padding: '1rem',
                  background: n.is_read ? '#f9fafb' : '#f0f0ff',
                  border: n.is_read ? '1px solid #e5e7eb' : '1px solid #c7d2fe',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontWeight: n.is_read ? 500 : 700, color: '#1f2937', marginBottom: '0.25rem' }}>
                    {n.message}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {n.link && (
                    <a
                      href={n.link}
                      style={{ fontSize: '0.85rem', color: '#4f46e5', fontWeight: 600, textDecoration: 'none' }}
                    >
                      View Details →
                    </a>
                  )}
                  <button
                    onClick={() => handleDeleteNotification(n.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: '1rem',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Dismiss alert"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

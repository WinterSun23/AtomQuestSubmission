import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getAllSettings, updateSetting } from '../../lib/adminApi'

const SETTING_META = {
  mfa_required:          { label: 'Require MFA',               type: 'bool',   hint: 'Force all users to set up TOTP after login' },
  mfa_enrollment_grace:  { label: 'MFA grace period (days)',   type: 'number', hint: 'Days before MFA becomes mandatory after first login' },
  goal_window_open:      { label: 'Goal window open',          type: 'bool',   hint: 'Allow employees to create and edit goal sheets' },
  escalation_enabled:    { label: 'Escalation engine',         type: 'bool',   hint: 'Run daily escalation checks and send notifications' },
  escalation_deadline_days:{ label: 'Escalation deadline',    type: 'number', hint: 'Days or hours allowed for submission/approval before escalating' },
  escalation_deadline_unit:{ 
    label: 'Escalation deadline unit', 
    type: 'select', 
    options: [
      { value: 'days', label: 'Days' },
      { value: 'hours', label: 'Hours' }
    ],
    hint: 'Time unit used for escalation calculations (e.g. days or hours)' 
  },
  max_goals_per_sheet:   { label: 'Max goals per sheet',       type: 'number', hint: 'Maximum number of goals an employee can add (guide says 8)' },
  min_goal_weightage:    { label: 'Min weightage per goal (%)', type: 'number', hint: 'Minimum weightage allowed for a single goal (guide says 10%)' },
  autosubmit_drafts_on_close: { label: 'Auto-submit Drafts on Close', type: 'bool', hint: 'Automatically submit all draft goal sheets when the Goal Setting window closes' },
}

export default function AdminSettings() {
  const [settings, setSettings]   = useState([])
  const [saving,   setSaving]     = useState(null)
  const [saved,    setSaved]      = useState(null)

  useEffect(() => { getAllSettings().then(setSettings).catch(console.error) }, [])

  async function handleChange(key, value) {
    setSaving(key)
    try {
      await updateSetting(key, value)
      setSettings(prev => prev.map(s => s.key === key ? { ...s, value: String(value) } : s))
      setSaved(key)
      setTimeout(() => setSaved(null), 1500)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(null)
    }
  }

  return (
    <AdminLayout>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Settings</h1>
        <p className="admin-page-subtitle">App-wide configuration — changes apply immediately</p>
      </div>

      <div className="admin-card">
        <table className="admin-table" style={{ borderRadius: 0 }}>
          <thead>
            <tr>
              <th>Setting</th>
              <th>Description</th>
              <th style={{ width: 180 }}>Value</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {settings
              .filter(s => s.key !== 'active_quarter_override' && s.key !== 'goal_window_open')
              .map(s => {
                const meta = SETTING_META[s.key] ?? { label: s.key, type: 'text', hint: s.description }
                return (
                  <tr key={s.key}>
                    <td style={{ fontWeight: 600, color: '#111827' }}>{meta.label}</td>
                    <td style={{ color: '#6b7280', fontSize: '0.82rem' }}>{meta.hint}</td>
                    <td>
                      {meta.type === 'bool' ? (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={s.value === 'true'}
                            onChange={e => handleChange(s.key, e.target.checked ? 'true' : 'false')}
                            style={{ width: 16, height: 16, accentColor: '#6366f1' }}
                          />
                          <span style={{ fontSize: '0.85rem' }}>{s.value === 'true' ? 'Enabled' : 'Disabled'}</span>
                        </label>
                      ) : meta.type === 'select' ? (
                        <select
                          className="admin-select"
                          value={s.value}
                          onChange={e => handleChange(s.key, e.target.value)}
                          style={{ width: 120, padding: '0.3rem', borderRadius: '6px', border: '1px solid #d1d5db' }}
                        >
                          {meta.options.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="admin-input"
                          type="number"
                          defaultValue={s.value}
                          style={{ width: 100 }}
                          onBlur={e => handleChange(s.key, e.target.value)}
                        />
                      )}
                    </td>
                    <td>
                      {saving === s.key && <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>Saving…</span>}
                      {saved  === s.key && <span style={{ color: '#15803d', fontSize: '0.78rem' }}>✓ Saved</span>}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  )
}

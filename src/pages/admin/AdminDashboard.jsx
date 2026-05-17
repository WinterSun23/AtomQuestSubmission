import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getAdminSummary, getEscalations, resolveEscalation, getQuarterlyAdminStats } from '../../lib/adminApi'

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']
const RULE_LABELS = {
  E1: 'Goals not submitted',
  E2: 'Goals not approved',
  E3: 'Check-in not completed',
  E4: 'Manager review overdue',
}

const LEVEL_LABELS = { '1': 'Notified employee', '2': 'Notified manager', '3': 'Escalated to HR' }

export default function AdminDashboard() {
  const [summary,     setSummary]     = useState(null)
  const [escalations, setEscalations] = useState([])
  const [resolving,   setResolving]   = useState(null)
  const [note,        setNote]        = useState('')

  const [activeTab, setActiveTab] = useState('Q1')
  const [quarterStats, setQuarterStats] = useState(null)

  async function load() {
    const [s, e, qStats] = await Promise.all([
      getAdminSummary(), 
      getEscalations({ resolved: false }),
      getQuarterlyAdminStats(activeTab)
    ])
    setSummary(s)
    setEscalations(e)
    setQuarterStats(qStats)
  }

  useEffect(() => { load() }, [activeTab])

  async function handleResolve(id) {
    if (!note.trim()) return
    setResolving(id)
    await resolveEscalation(id, note)
    setNote('')
    setResolving(null)
    load()
  }

  return (
    <AdminLayout openEscalations={escalations.length}>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Dashboard</h1>
        <p className="admin-page-subtitle">Organisation overview and open escalations</p>
      </div>

      {/* ── Summary cards ── */}
      <div className="admin-summary-grid">
        {[
          { label: 'Total users',       value: summary?.totalUsers      ?? '—', sub: 'in the portal' },
          { label: 'Goal sheets',       value: summary?.totalSheets     ?? '—', sub: 'this cycle' },
          { label: 'Open escalations',  value: summary?.openEscalations ?? '—', sub: 'need attention', alert: true },
          { label: 'Active cycle',      value: summary?.activeCycle?.name ?? 'None', sub: 'current FY', wide: true },
        ].map(c => (
          <div className="admin-stat-card" key={c.label}
            style={c.alert && summary?.openEscalations > 0 ? { borderColor: '#fca5a5' } : {}}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value" style={c.alert && summary?.openEscalations > 0 ? { color: '#ef4444' } : {}}>
              {c.value}
            </div>
            <div className="stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Quarterly Stats Tabs ── */}
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
          {QUARTERS.map(q => (
            <button
              key={q}
              onClick={() => setActiveTab(q)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '1rem', fontWeight: activeTab === q ? 700 : 500,
                color: activeTab === q ? '#4f46e5' : '#6b7280',
                borderBottom: activeTab === q ? '2px solid #4f46e5' : 'none',
                paddingBottom: '0.25rem'
              }}
            >
              {q} Stats
            </button>
          ))}
        </div>
        
        {quarterStats ? (
          <div className="admin-summary-grid">
             <div className="admin-stat-card">
              <div className="stat-label">Total Check-ins</div>
              <div className="stat-value">{quarterStats.total}</div>
            </div>
            <div className="admin-stat-card">
              <div className="stat-label">Goals Achieved</div>
              <div className="stat-value">{quarterStats.completed}</div>
            </div>
            <div className="admin-stat-card">
              <div className="stat-label">Avg. Progress Score</div>
              <div className="stat-value">{quarterStats.avgScore}%</div>
            </div>
          </div>
        ) : (
          <div className="admin-empty" style={{ padding: '1rem' }}>No data for this quarter.</div>
        )}
      </div>

      {/* ── Escalation inbox ── */}
      <div className="admin-card">
        <div className="admin-card-title">🚨 Open Escalations ({escalations.length})</div>

        {escalations.length === 0 && (
          <div className="admin-empty">✅ No open escalations. All caught up!</div>
        )}

        {escalations.map(e => (
          <div key={e.id} style={{
            border: '1px solid #fecaca', borderRadius: 10, padding: '1rem',
            marginBottom: '0.75rem', background: '#fff9f9',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#111827', marginBottom: 2 }}>
                  {RULE_LABELS[e.rule_id] ?? e.rule_id}
                  <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.8rem', color: '#6b7280' }}>
                    Rule {e.rule_id} · Level {e.escalation_level} — {LEVEL_LABELS[e.escalation_level]}
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#374151' }}>
                  Employee: <strong>{e.employee?.name}</strong> ({e.employee?.email})
                </div>
                <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 2 }}>
                  Sent: {new Date(e.sent_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                <input
                  className="admin-input"
                  placeholder="Resolution note…"
                  value={resolving === e.id ? note : ''}
                  onChange={ev => { setResolving(e.id); setNote(ev.target.value) }}
                  style={{ width: 200 }}
                />
                <button
                  className="btn-sm btn-success-sm"
                  disabled={resolving === e.id && !note.trim()}
                  onClick={() => handleResolve(e.id)}
                >
                  Resolve
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AdminLayout>
  )
}

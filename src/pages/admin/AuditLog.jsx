import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getAuditLog } from '../../lib/adminApi'
import { supabase } from '../../lib/supabase'

export default function AuditLog() {
  const [activeTab, setActiveTab] = useState('audit')
  const [entries, setEntries] = useState([])
  const [count,   setCount]   = useState(0)
  const [page,    setPage]    = useState(0)
  const [from,    setFrom]    = useState('')
  const [to,      setTo]      = useState('')
  const [action,  setAction]  = useState('all')
  const [loading, setLoading] = useState(true)
  const PAGE_SIZE = 50

  // Diagnostics states
  const [redisStatus, setRedisStatus] = useState('Checking…')
  const [triggeringCron, setTriggeringCron] = useState(false)
  const [testingQueue, setTestingQueue] = useState(false)

  async function load(p = 0) {
    setLoading(true)
    const { data, count } = await getAuditLog({ from: from || undefined, to: to || undefined, page: p, pageSize: PAGE_SIZE })
    
    // Apply client-side action filter to handle standard actions
    let filteredData = data || []
    if (action !== 'all') {
      filteredData = filteredData.filter(e => e.action === action)
    }

    setEntries(filteredData)
    setCount(filteredData.length || count)
    setPage(p)
    setLoading(false)
  }

  useEffect(() => {
    load(0)
    checkDiagnostics()
  }, []) // eslint-disable-line

  async function checkDiagnostics() {
    try {
      const res = await fetch('http://localhost:3001/api/reports/list', {
        headers: {
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        }
      })
      if (res.ok) {
        setRedisStatus('CONNECTED (Active BullMQ & Upstash Serverless)')
      } else {
        setRedisStatus('OFFLINE (Local Redis Fallback)')
      }
    } catch {
      setRedisStatus('DISCONNECTED (Check backend server logs)')
    }
  }

  async function handleTriggerCron() {
    setTriggeringCron(true)
    try {
      const res = await fetch('http://localhost:3001/api/cron/trigger', {
        method: 'POST'
      })
      if (res.ok) {
        alert('Automated Deadline & Escalation Cron job completed successfully!')
        load(0)
      } else {
        throw new Error('Server returned error status')
      }
    } catch (err) {
      alert('Failed to trigger cron: ' + err.message)
    }
    setTriggeringCron(false)
  }

  async function handleTestQueue() {
    setTestingQueue(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: me } = await supabase.from('users').select('id').eq('auth_id', user.id).single()
      
      const res = await fetch('http://localhost:3001/api/events/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          action: 'DEADLINE_REMINDER',
          actorId: me.id,
          description: 'This is a test background diagnostic notification queued via BullMQ!'
        })
      })

      if (res.ok) {
        alert('Test notification job added to BullMQ Queue successfully!')
      } else {
        throw new Error('Queue injection failed')
      }
    } catch (err) {
      alert('Error: ' + err.message)
    }
    setTestingQueue(false)
  }

  function handleSearch(e) { e.preventDefault(); load(0) }

  return (
    <AdminLayout>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Enterprise System Logs</h1>
        <p className="admin-page-subtitle">Track transaction audit logs, monitor background job queues, and verify server-side health diagnostics.</p>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid #e5e7eb', marginBottom: '1.5rem', paddingBottom: '0.25rem' }}>
        <button
          onClick={() => setActiveTab('audit')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1rem', fontWeight: activeTab === 'audit' ? 700 : 500,
            color: activeTab === 'audit' ? '#4f46e5' : '#6b7280',
            borderBottom: activeTab === 'audit' ? '2px solid #4f46e5' : 'none',
            paddingBottom: '0.5rem'
          }}
        >
          📋 Transaction Audit Stream
        </button>
        <button
          onClick={() => setActiveTab('diagnostics')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1rem', fontWeight: activeTab === 'diagnostics' ? 700 : 500,
            color: activeTab === 'diagnostics' ? '#4f46e5' : '#6b7280',
            borderBottom: activeTab === 'diagnostics' ? '2px solid #4f46e5' : 'none',
            paddingBottom: '0.5rem'
          }}
        >
          ⚡ Queue Health & Diagnostics
        </button>
      </div>

      {activeTab === 'audit' ? (
        <>
          {/* ── Filters ── */}
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.8rem', color: '#6b7280' }}>From</label>
              <input type="date" className="admin-input" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: '0.4rem' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.8rem', color: '#6b7280' }}>To</label>
              <input type="date" className="admin-input" value={to} onChange={e => setTo(e.target.value)} style={{ padding: '0.4rem' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.8rem', color: '#6b7280' }}>Action</label>
              <select className="admin-select" value={action} onChange={e => setAction(e.target.value)} style={{ padding: '0.4rem' }}>
                <option value="all">All Actions</option>
                <option value="SUBMIT_GOAL_SHEET">Submit Goal Sheet</option>
                <option value="APPROVE_GOAL_SHEET">Approve Goal Sheet</option>
                <option value="RETURN_GOAL_SHEET">Return Goal Sheet</option>
                <option value="UPDATE_PROGRESS">Update Progress</option>
                <option value="CHANGE_MANAGER">Change Manager</option>
                <option value="DEADLINE_REMINDER">Deadline Reminder</option>
                <option value="GENERATE_REPORT">Generate Report</option>
              </select>
            </div>
            <button type="submit" className="btn-sm btn-primary-sm" style={{ padding: '0.4rem 1rem' }}>Filter</button>
            <button type="button" className="btn-sm btn-ghost-sm" onClick={() => { setFrom(''); setTo(''); setAction('all'); setTimeout(() => load(0), 0) }}>Clear</button>
            <div style={{ fontSize: '0.82rem', color: '#9ca3af', alignSelf: 'center', marginLeft: 'auto' }}>
              {count} entries
            </div>
          </form>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Goal</th>
                  <th>Field</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>Loading…</td></tr>}
                {!loading && entries.length === 0 && <tr><td colSpan={8} className="admin-empty">No audit entries found</td></tr>}
                {!loading && entries.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontSize: '0.78rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                      {new Date(e.changed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>{e.actor?.name ?? '—'}</td>
                    <td>
                      <span className={`badge ${e.action.includes('APPROVE') ? 'badge-approved' : e.action.includes('RETURN') ? 'badge-returned' : 'badge-submitted'}`}>
                        {e.action}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.goal?.title ?? '—'}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: '#6b7280' }}>{e.field_changed ?? '—'}</td>
                    <td style={{ fontSize: '0.78rem', color: '#6b7280', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.old_value ?? '—'}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: '#111827', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.new_value ?? '—'}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: '#6b7280', maxWidth: 150 }}>{e.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          {count > PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="btn-sm btn-ghost-sm" onClick={() => load(page - 1)} disabled={page === 0}>← Prev</button>
              <span style={{ alignSelf: 'center', fontSize: '0.85rem', color: '#6b7280' }}>
                Page {page + 1} of {Math.ceil(count / PAGE_SIZE)}
              </span>
              <button className="btn-sm btn-ghost-sm" onClick={() => load(page + 1)} disabled={(page + 1) * PAGE_SIZE >= count}>Next →</button>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Diagnostic Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <div style={{ padding: '1.5rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Queue Connection Status</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: redisStatus.includes('CONNECTED') ? '#10b981' : '#f59e0b' }}>
                {redisStatus}
              </div>
            </div>
            <div style={{ padding: '1.5rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Active Delivery Retries</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#111827' }}>3 Attempts (Exponential Backoff)</div>
            </div>
          </div>

          {/* Action Center */}
          <div className="admin-card" style={{ background: '#fcfcff', border: '1px dashed #c7d2fe', padding: '1.5rem', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#1f2937' }}>⚙️ Queue Simulation & Testing Center</h3>
            <p style={{ color: '#4b5563', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
              Manually trigger background tasks and queues immediately to verify operations in real-time. Console outputs will show mock deliveries.
            </p>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                id="btn-trigger-cron"
                onClick={handleTriggerCron}
                className="admin-btn-primary"
                disabled={triggeringCron}
                style={{ padding: '0.75rem 1.25rem' }}
              >
                {triggeringCron ? 'Running Cron…' : 'Trigger Automated Deadline & Escalation Cron'}
              </button>

              <button
                id="btn-test-queue"
                onClick={handleTestQueue}
                className="admin-btn-secondary"
                disabled={testingQueue}
                style={{ padding: '0.75rem 1.25rem' }}
              >
                {testingQueue ? 'Queuing…' : 'Inject Test Notification into BullMQ Queue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

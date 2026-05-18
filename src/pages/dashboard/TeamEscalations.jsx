import { useState, useEffect } from 'react'
import { getTeamEscalations } from '../../lib/managerApi'
import { resolveEscalation } from '../../lib/adminApi'

export default function TeamEscalations() {
  const [escalations, setEscalations] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedEsc, setSelectedEsc] = useState(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await getTeamEscalations()
      setEscalations(data || [])
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleResolve() {
    if (!selectedEsc || !note.trim()) return
    setResolving(true)
    try {
      await resolveEscalation(selectedEsc.id, note)
      alert('Escalation resolved successfully!')
      setSelectedEsc(null)
      setNote('')
      load()
    } catch (err) {
      alert('Error resolving escalation: ' + err.message)
    }
    setResolving(false)
  }

  return (
    <div>
      <style>{`
        /* Slide-over Drawer Overlay & Body Styles */
        .drawer-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(15, 23, 42, 0.4);
          backdrop-filter: blur(4px);
          z-index: 999;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s ease;
        }
        .drawer-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .drawer-body {
          position: fixed;
          top: 0;
          right: 0;
          width: 460px;
          max-width: 100vw;
          height: 100%;
          background: white;
          box-shadow: -10px 0 25px -5px rgba(0, 0, 0, 0.1), -4px 0 10px -5px rgba(0, 0, 0, 0.06);
          z-index: 1000;
          transform: translateX(100%);
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
        }
        .drawer-body.open {
          transform: translateX(0);
        }
        .drawer-header {
          padding: 1.5rem;
          border-bottom: 1px solid #f3f4f6;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .drawer-content {
          flex: 1;
          overflow-y: auto;
          padding: 1.5rem;
        }
        .drawer-footer {
          padding: 1.5rem;
          border-top: 1px solid #f3f4f6;
          background: #f9fafb;
        }
      `}</style>

      <div className="user-page-header" style={{ marginBottom: '2rem' }}>
        <h1 className="user-page-title">Team Escalations</h1>
        <p className="user-page-subtitle">Track and resolve deadline breaches for your assigned employee reports.</p>
      </div>

      <div className="user-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>Sent At</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>Rule ID</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>Level</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>Employee</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>Loading escalations...</td>
                </tr>
              )}
              {!loading && escalations.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🚨</div>
                    No active team escalations found. All goals and approvals are on schedule!
                  </td>
                </tr>
              )}
              {!loading && escalations.map(e => (
                <tr 
                  key={e.id} 
                  style={{ borderBottom: '1px solid #e5e7eb', cursor: 'pointer', transition: 'all 0.15s ease' }}
                  onClick={() => { setSelectedEsc(e); setIsDrawerOpen(true); }}
                  onMouseEnter={(el) => { el.currentTarget.style.background = '#f9fafb'; }}
                  onMouseLeave={(el) => { el.currentTarget.style.background = 'transparent'; }}
                >
                  <td style={{ padding: '1rem', fontSize: '0.82rem', color: '#6b7280' }}>
                    {new Date(e.sent_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span className="badge badge-submitted" style={{ textTransform: 'uppercase' }}>{e.rule_id}</span>
                  </td>
                  <td style={{ padding: '1rem', fontWeight: 600, color: '#111827' }}>L{e.escalation_level}</td>
                  <td style={{ padding: '1rem', color: '#374151' }}>
                    <strong>{e.employee?.name || '—'}</strong>
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{e.employee?.email}</div>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <button
                      className="btn-sm btn-primary-sm"
                      onClick={(el) => { el.stopPropagation(); setSelectedEsc(e); setIsDrawerOpen(true); }}
                      style={{ padding: '0.35rem 0.85rem', cursor: 'pointer' }}
                    >
                      Resolve ✅
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Slide-over Escalation Details Drawer ── */}
      <div 
        className={`drawer-overlay ${isDrawerOpen ? 'open' : ''}`} 
        onClick={() => { setIsDrawerOpen(false); setSelectedEsc(null); setNote(''); }} 
      />
      <div className={`drawer-body ${isDrawerOpen && selectedEsc ? 'open' : ''}`}>
        {selectedEsc && (
          <>
            <div className="drawer-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>🚨</span> Escalation Detail Insights
              </h3>
              <button 
                onClick={() => { setIsDrawerOpen(false); setSelectedEsc(null); setNote(''); }}
                style={{
                  background: '#f3f4f6', border: 'none', borderRadius: '50%',
                  width: '28px', height: '28px', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer', color: '#4b5563', fontWeight: 700
                }}
              >
                ✕
              </button>
            </div>
            
            <div className="drawer-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Badge/Level card */}
              <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 12, padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: '#991b1b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Escalation Severity</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#991b1b', marginTop: '0.15rem' }}>L{selectedEsc.escalation_level} Notification</div>
                </div>
                <span className="badge" style={{ background: '#ef4444', color: '#fff', fontSize: '0.8rem', padding: '0.4rem 0.8rem', borderRadius: 8, fontWeight: 700 }}>
                  Active Breach
                </span>
              </div>

              {/* Rule & Source Details */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  ⚙️ System Escalation Rule
                </h4>
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem 1rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1f2937' }}>Rule Config: {selectedEsc.rule_id}</div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.15rem' }}>
                      {selectedEsc.rule_id === 'E3' ? 'Overdue employee check-in submission' : 
                       selectedEsc.rule_id === 'E4' ? 'Overdue manager review approval' : 
                       'Standard compliance timeline violation'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Employee info */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  👤 Escalated Reportee
                </h4>
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem 1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1f2937' }}>{selectedEsc.employee?.name || '—'}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.15rem' }}>{selectedEsc.employee?.email || 'N/A'}</div>
                </div>
              </div>

              {/* Escalation description / reason */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  📝 Reason for Escalation
                </h4>
                <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 8, padding: '1rem', fontSize: '0.85rem', color: '#991b1b', lineHeight: 1.5, fontWeight: 500 }}>
                  {selectedEsc.trigger_reason || 'Breach trigger date elapsed with no submission logs recorded.'}
                </div>
              </div>

              {/* Timeline Dates */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🗓 Timeline Metadata
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem', color: '#4b5563' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Triggered Date:</span>
                    <strong>{new Date(selectedEsc.sent_at).toLocaleString()}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Resolution Status:</span>
                    <strong style={{ color: '#ef4444' }}>Unresolved</strong>
                  </div>
                </div>
              </div>

              {/* Resolution Form */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  ✅ Submit Resolution Action
                </h4>
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem' }}>
                  <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 0.75rem 0' }}>
                    Submit a resolution note explaining what corrective actions were taken to clear this timeline violation.
                  </p>
                  <textarea
                    className="user-input"
                    rows={3}
                    placeholder="e.g. Discussed with employee, document submitted or manual extension granted."
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.82rem', outline: 'none' }}
                  />
                </div>
              </div>
            </div>

            <div className="drawer-footer" style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                onClick={handleResolve}
                disabled={resolving || !note.trim()}
                className="btn-sm btn-primary-sm"
                style={{ flex: 1, padding: '0.6rem 0', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {resolving ? 'Saving...' : 'Confirm Resolve ✅'}
              </button>
              <button 
                onClick={() => { setIsDrawerOpen(false); setSelectedEsc(null); setNote(''); }}
                className="btn-sm btn-ghost-sm"
                style={{ flex: 1, padding: '0.6rem 0', fontWeight: 700, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

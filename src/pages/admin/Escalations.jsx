import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getEscalations, resolveEscalation } from '../../lib/adminApi'

export default function Escalations() {
  const [escalations, setEscalations] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedEsc, setSelectedEsc] = useState(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolvedView, setResolvedView] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await getEscalations({ resolved: resolvedView })
      setEscalations(data || [])
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [resolvedView])

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
    <AdminLayout openEscalations={resolvedView ? 0 : escalations.length}>
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

      <div className="admin-page-header" style={{ marginBottom: '1.5rem' }}>
        <h1 className="admin-page-title">Escalations Monitor</h1>
        <p className="admin-page-subtitle">Track and resolve deadline violations for goal submissions and manager approvals.</p>
      </div>

      {/* ── Segmented Toggle Tabs ── */}
      <div style={{ display: 'flex', gap: '1.5rem', borderBottom: '2px solid #e5e7eb', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          id="tab-active-escalations"
          onClick={() => setResolvedView(false)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1rem', fontWeight: !resolvedView ? 700 : 500,
            color: !resolvedView ? '#4f46e5' : '#6b7280',
            borderBottom: !resolvedView ? '3px solid #4f46e5' : 'none',
            paddingBottom: '0.4rem', marginBottom: '-0.65rem',
            outline: 'none'
          }}
        >
          Active Escalations
        </button>
        <button
          id="tab-resolved-escalations"
          onClick={() => setResolvedView(true)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1rem', fontWeight: resolvedView ? 700 : 500,
            color: resolvedView ? '#4f46e5' : '#6b7280',
            borderBottom: resolvedView ? '3px solid #4f46e5' : 'none',
            paddingBottom: '0.4rem', marginBottom: '-0.65rem',
            outline: 'none'
          }}
        >
          Resolution History
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            {!resolvedView ? (
              <tr>
                <th>Sent At</th>
                <th>Rule ID</th>
                <th>Level</th>
                <th>Employee</th>
                <th>Notified User</th>
                <th>Action</th>
              </tr>
            ) : (
              <tr>
                <th>Sent At</th>
                <th>Resolved At</th>
                <th>Rule ID</th>
                <th>Level</th>
                <th>Employee</th>
                <th>Resolved By</th>
                <th>Resolution Note</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={resolvedView ? 7 : 6} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                  Loading escalations...
                </td>
              </tr>
            )}
            {!loading && escalations.length === 0 && (
              <tr>
                <td colSpan={resolvedView ? 7 : 6} className="admin-empty">
                  {resolvedView ? 'No resolution history found.' : 'No active escalations found. All systems healthy!'}
                </td>
              </tr>
            )}
            {!loading && escalations.map(e => (
              <tr 
                key={e.id}
                onClick={() => { setSelectedEsc(e); setIsDrawerOpen(true); }}
                style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
                onMouseEnter={(el) => { el.currentTarget.style.background = '#f9fafb'; }}
                onMouseLeave={(el) => { el.currentTarget.style.background = 'transparent'; }}
              >
                <td style={{ fontSize: '0.82rem', color: '#6b7280' }}>
                  {new Date(e.sent_at).toLocaleString()}
                </td>
                {resolvedView && (
                  <td style={{ fontSize: '0.82rem', color: '#16a34a', fontWeight: 500 }}>
                    {e.resolved_at ? new Date(e.resolved_at).toLocaleString() : '—'}
                  </td>
                )}
                <td>
                  <span className="badge badge-submitted" style={{ textTransform: 'uppercase' }}>{e.rule_id}</span>
                </td>
                <td style={{ fontWeight: 600 }}>L{e.escalation_level}</td>
                <td>{e.employee?.name || '—'}</td>
                {!resolvedView ? (
                  <td>{e.notified?.name || '—'}</td>
                ) : (
                  <td style={{ fontWeight: 600, color: '#374151' }}>{e.resolver?.name || 'System'}</td>
                )}
                {!resolvedView ? (
                  <td>
                    <button
                      id={`btn-resolve-${e.id}`}
                      className="btn-sm btn-primary-sm"
                      onClick={(el) => { el.stopPropagation(); setSelectedEsc(e); setIsDrawerOpen(true); }}
                      style={{ padding: '0.25rem 0.75rem', cursor: 'pointer' }}
                    >
                      Resolve ✅
                    </button>
                  </td>
                ) : (
                  <td style={{ fontSize: '0.82rem', color: '#4b5563', maxWidth: '300px', wordWrap: 'break-word', whiteSpace: 'normal' }}>
                    {e.resolve_note || '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
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
              <div style={{ background: resolvedView ? '#ecfdf5' : '#fff1f2', border: '1px solid', borderColor: resolvedView ? '#a7f3d0' : '#fecdd3', borderRadius: 12, padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: resolvedView ? '#065f46' : '#991b1b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Escalation Level</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: resolvedView ? '#065f46' : '#991b1b', marginTop: '0.15rem' }}>L{selectedEsc.escalation_level} Notification</div>
                </div>
                <span className="badge" style={{ background: resolvedView ? '#10b981' : '#ef4444', color: '#fff', fontSize: '0.8rem', padding: '0.4rem 0.8rem', borderRadius: 8, fontWeight: 700 }}>
                  {resolvedView ? 'Resolved' : 'Active'}
                </span>
              </div>

              {/* Rule & Source Details */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  ⚙️ Source / Rule Configuration
                </h4>
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem 1rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1f2937' }}>Rule: {selectedEsc.rule_id}</div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.15rem' }}>
                      {selectedEsc.rule_id === 'E3' ? 'Overdue employee check-in submission' : 
                       selectedEsc.rule_id === 'E4' ? 'Overdue manager review approval' : 
                       'Standard deadline breach escalation'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Employee info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    👤 Escalated Employee
                  </h4>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedEsc.employee?.name || '—'}</div>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedEsc.employee?.email || 'N/A'}</div>
                  </div>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    👥 Notified User
                  </h4>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedEsc.notified?.name || '—'}</div>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedEsc.notified?.email || 'N/A'}</div>
                  </div>
                </div>
              </div>

              {/* Escalation description / reason */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  📝 Trigger Reason & Cause
                </h4>
                <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 8, padding: '1rem', fontSize: '0.85rem', color: '#991b1b', lineHeight: 1.5, fontWeight: 500 }}>
                  {selectedEsc.trigger_reason || 'Deadline elapsed without appropriate compliance check-in logs.'}
                </div>
              </div>

              {/* Timeline Dates */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🗓 Escalation Timeline
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem', color: '#4b5563' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Triggered Date:</span>
                    <strong>{new Date(selectedEsc.sent_at).toLocaleString()}</strong>
                  </div>
                  {resolvedView && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Resolved Date:</span>
                        <strong style={{ color: '#16a34a' }}>{new Date(selectedEsc.resolved_at).toLocaleString()}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Resolved By:</span>
                        <strong>{selectedEsc.resolver?.name || 'System'}</strong>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Resolution Form if resolvedView is false */}
              {!resolvedView ? (
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ✅ Resolve Escalation
                  </h4>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem' }}>
                    <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 0.75rem 0' }}>
                      Add a resolution note explaining what action was taken to resolve this deadline breach.
                    </p>
                    <textarea
                      id="txt-resolve-note"
                      className="admin-input"
                      rows={3}
                      placeholder="Enter resolution actions taken..."
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.82rem', outline: 'none' }}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    📋 Resolution Log Note
                  </h4>
                  <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '1rem', fontSize: '0.82rem', color: '#065f46', lineHeight: 1.5 }}>
                    {selectedEsc.resolve_note || 'Resolved by Administrator.'}
                  </div>
                </div>
              )}
            </div>

            <div className="drawer-footer" style={{ display: 'flex', gap: '0.75rem' }}>
              {!resolvedView ? (
                <>
                  <button 
                    onClick={handleResolve}
                    disabled={resolving || !note.trim()}
                    className="btn-sm btn-primary-sm"
                    style={{ flex: 1, padding: '0.6rem 0', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {resolving ? 'Resolving...' : 'Confirm Resolve ✅'}
                  </button>
                  <button 
                    onClick={() => { setIsDrawerOpen(false); setSelectedEsc(null); setNote(''); }}
                    className="btn-sm btn-ghost-sm"
                    style={{ flex: 1, padding: '0.6rem 0', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => { setIsDrawerOpen(false); setSelectedEsc(null); }}
                  className="btn-sm btn-primary-sm"
                  style={{ width: '100%', padding: '0.6rem 0', fontWeight: 700, cursor: 'pointer' }}
                >
                  Close Details
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  )
}

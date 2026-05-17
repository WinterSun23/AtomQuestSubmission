import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getEscalations, resolveEscalation } from '../../lib/adminApi'

export default function Escalations() {
  const [escalations, setEscalations] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedEsc, setSelectedEsc] = useState(null)
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await getEscalations({ resolved: false })
      setEscalations(data || [])
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

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
    <AdminLayout openEscalations={escalations.length}>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Escalations Monitor</h1>
        <p className="admin-page-subtitle">Track and resolve deadline violations for goal submissions and manager approvals.</p>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Sent At</th>
              <th>Rule ID</th>
              <th>Level</th>
              <th>Employee</th>
              <th>Notified Manager</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>Loading...</td></tr>}
            {!loading && escalations.length === 0 && (
              <tr><td colSpan={6} className="admin-empty">No active escalations found. All systems healthy!</td></tr>
            )}
            {!loading && escalations.map(e => (
              <tr key={e.id}>
                <td style={{ fontSize: '0.82rem', color: '#6b7280' }}>
                  {new Date(e.sent_at).toLocaleString()}
                </td>
                <td>
                  <span className="badge badge-submitted">{e.rule_id}</span>
                </td>
                <td style={{ fontWeight: 600 }}>L{e.escalation_level}</td>
                <td>{e.employee?.name || '—'}</td>
                <td>{e.notified?.name || '—'}</td>
                <td>
                  <button
                    id={`btn-resolve-${e.id}`}
                    className="btn-sm btn-primary-sm"
                    onClick={() => setSelectedEsc(e)}
                    style={{ padding: '0.25rem 0.75rem' }}
                  >
                    Resolve ✅
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedEsc && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="admin-card" style={{ width: '450px', background: 'white', padding: '2rem', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Resolve Escalation</h3>
            <p style={{ fontSize: '0.88rem', color: '#6b7280', marginBottom: '1rem' }}>
              Add a resolution note explaining what action was taken to resolve this deadline breach.
            </p>
            <textarea
              id="txt-resolve-note"
              className="admin-input"
              rows={4}
              placeholder="Enter resolution actions taken..."
              value={note}
              onChange={e => setNote(e.target.value)}
              style={{ width: '100%', marginBottom: '1.5rem', padding: '0.5rem' }}
            />
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button className="admin-btn-secondary" onClick={() => { setSelectedEsc(null); setNote('') }}>Cancel</button>
              <button
                id="btn-confirm-resolve"
                className="admin-btn-primary"
                onClick={handleResolve}
                disabled={resolving || !note.trim()}
              >
                {resolving ? 'Resolving...' : 'Confirm Resolution'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

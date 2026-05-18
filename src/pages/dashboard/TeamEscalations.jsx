import { useState, useEffect } from 'react'
import { getTeamEscalations } from '../../lib/managerApi'
import { resolveEscalation } from '../../lib/adminApi'

export default function TeamEscalations() {
  const [escalations, setEscalations] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedEsc, setSelectedEsc] = useState(null)
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
                <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
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
                      onClick={() => setSelectedEsc(e)}
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

      {selectedEsc && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="user-card" style={{ width: '450px', background: 'white', padding: '2rem', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#111827' }}>Resolve Team Escalations</h3>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1.5rem' }}>
              Submit a resolution note detailing the action taken to address this team member's deadline violation.
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.5rem' }}>
                Resolution Note
              </label>
              <textarea
                className="user-input"
                style={{ width: '100%', height: '90px', boxSizing: 'border-box' }}
                placeholder="e.g. Discussed with employee, document submitted or manual extension granted."
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="btn-sm btn-ghost-sm"
                onClick={() => { setSelectedEsc(null); setNote('') }}
                disabled={resolving}
              >
                Cancel
              </button>
              <button
                className="btn-sm btn-primary-sm"
                onClick={handleResolve}
                disabled={resolving || !note.trim()}
              >
                {resolving ? 'Saving...' : 'Confirm Resolution'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

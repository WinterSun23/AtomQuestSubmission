import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { searchLockedSheets, unlockGoalSheet } from '../../lib/adminApi'
import { logEvent } from '../../lib/userApi'

export default function GoalUnlock() {
  const [query, setQuery] = useState('')
  const [sheets, setSheets] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedSheet, setSelectedSheet] = useState(null)
  const [reason, setReason] = useState('')
  const [unlocking, setUnlocking] = useState(false)

  useEffect(() => {
    handleSearch()
  }, [])

  async function handleSearch(e) {
    if (e) e.preventDefault()
    setLoading(true)
    try {
      const data = await searchLockedSheets(query)
      setSheets(data || [])
    } catch (err) {
      alert('Error searching sheets: ' + err.message)
    }
    setLoading(false)
  }

  async function handleUnlock() {
    if (!selectedSheet || !reason.trim()) return
    setUnlocking(true)
    try {
      await unlockGoalSheet(selectedSheet.id, reason)
      
      await logEvent({
        action: 'RETURN_GOAL_SHEET',
        goalSheetId: selectedSheet.id,
        reason: reason,
        description: `Admin unlocked your goal sheet: Reverted to draft. Reason: "${reason}"`
      })

      alert('Goal sheet unlocked successfully!')
      setSelectedSheet(null)
      setReason('')
      handleSearch()
    } catch (err) {
      alert('Error unlocking sheet: ' + err.message)
    }
    setUnlocking(false)
  }

  return (
    <AdminLayout>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Goal Sheet Unlock</h1>
        <p className="admin-page-subtitle">Revert approved employee goal sheets back to Draft mode so they can be modified.</p>
      </div>

      <div className="admin-card" style={{ marginBottom: '1.5rem', padding: '1.5rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem' }}>
          <input
            id="input-search-sheets"
            type="text"
            className="admin-input"
            placeholder="Search employee name or email..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ flex: 1, padding: '0.5rem' }}
          />
          <button type="submit" className="btn-sm btn-primary-sm" disabled={loading} style={{ padding: '0.5rem 1.25rem' }}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Email</th>
              <th>Status</th>
              <th>Approved At</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sheets.length === 0 ? (
              <tr><td colSpan={5} className="admin-empty">No approved goal sheets found matching search criteria.</td></tr>
            ) : (
              sheets.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.employee?.name || '—'}</td>
                  <td>{s.employee?.email || '—'}</td>
                  <td><span className="badge badge-approved">{s.status}</span></td>
                  <td>{s.approved_at ? new Date(s.approved_at).toLocaleString() : '—'}</td>
                  <td>
                    <button
                      id={`btn-unlock-${s.id}`}
                      className="btn-sm btn-danger-sm"
                      onClick={() => setSelectedSheet(s)}
                      style={{ padding: '0.25rem 0.75rem' }}
                    >
                      🔓 Revert to Draft
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedSheet && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="admin-card" style={{ width: '450px', background: 'white', padding: '2rem', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Provide Reason for Unlock</h3>
            <p style={{ fontSize: '0.88rem', color: '#6b7280', marginBottom: '1rem' }}>
              Explain to <strong>{selectedSheet.employee?.name}</strong> why their goal sheet is being unlocked.
            </p>
            <textarea
              id="txt-unlock-reason"
              className="admin-input"
              rows={4}
              placeholder="Enter unlock explanation..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              style={{ width: '100%', marginBottom: '1.5rem', padding: '0.5rem' }}
            />
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button className="admin-btn-secondary" onClick={() => { setSelectedSheet(null); setReason('') }}>Cancel</button>
              <button
                id="btn-confirm-unlock"
                className="admin-btn-primary"
                onClick={handleUnlock}
                disabled={unlocking || !reason.trim()}
              >
                {unlocking ? 'Unlocking...' : 'Confirm Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

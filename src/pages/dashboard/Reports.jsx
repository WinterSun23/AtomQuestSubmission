import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { API_URL } from '../../lib/userApi'

export default function Reports() {
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState([])

  const [quarter, setQuarter] = useState('')

  useEffect(() => {
    loadReports()
  }, [])

  async function loadReports() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/reports/list`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })
      if (!res.ok) throw new Error('Failed to load reports')
      const json = await res.json()
      // Filter out empty placeholder files
      setReports((json.reports || []).filter(f => f.name !== '.emptyFolderPlaceholder').sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
    } catch (err) {
      console.error('Error loading reports:', err)
    }
  }

  async function handleGenerateReport() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      const qParam = quarter ? `?quarter=${quarter}` : ''
      const res = await fetch(`${API_URL}/api/reports/achievement${qParam}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to generate report')
      }
      
      const json = await res.json()
      if (json.url) {
        window.location.href = json.url // trigger download
      }
      
      // Reload list
      loadReports()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  async function downloadReport(fileName) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/reports/download/${encodeURIComponent(fileName)}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })
      if (!res.ok) throw new Error('Failed to get download link')
      const json = await res.json()
      window.location.href = json.url
    } catch (err) {
      alert('Error downloading: ' + err.message)
    }
  }

  return (
    <div>
      <div className="user-page-header">
        <h1 className="user-page-title">Reports</h1>
        <p className="user-page-subtitle">Generate and download achievement reports.</p>
      </div>

      <div className="user-card" style={{ marginBottom: '2rem' }}>
        <h2 className="user-card-title">Generate New Report</h2>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
          This will generate an Excel file containing Planned vs Actual achievement data for your team (or the entire org if you are an Admin).
        </p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select className="user-select" value={quarter} onChange={(e) => setQuarter(e.target.value)} style={{ width: '150px' }}>
            <option value="">All Check-ins</option>
            <option value="Q1">Q1</option>
            <option value="Q2">Q2</option>
            <option value="Q3">Q3</option>
            <option value="Q4">Q4</option>
          </select>
          <button 
            className="btn-sm btn-primary-sm" 
            onClick={handleGenerateReport}
            disabled={loading}
          >
            {loading ? 'Generating...' : 'Generate Achievement Report'}
          </button>
        </div>
      </div>

      <div className="user-card">
        <h2 className="user-card-title">Past Reports</h2>
        {reports.length === 0 ? (
          <div className="user-empty">No reports have been generated yet.</div>
        ) : (
          <div className="user-table-wrap">
            <table className="user-table">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Generated At</th>
                  <th>Size</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(r => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{(r.metadata?.size / 1024).toFixed(2)} KB</td>
                    <td>
                      <button className="btn-sm btn-ghost-sm" onClick={() => downloadReport(r.name)}>
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

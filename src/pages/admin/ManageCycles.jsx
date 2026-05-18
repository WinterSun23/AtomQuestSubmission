import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getCycles, createCycle, activateCycle, getAllSettings, updateSetting } from '../../lib/adminApi'

export default function ManageCycles() {
  const [cycles,  setCycles]  = useState([])
  const [form,    setForm]    = useState({ name: '' })
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  
  // Settings & Quarters
  const [settings, setSettings] = useState([])
  const [quarterOverride, setQuarterOverride] = useState('')
  const [autoQuarter, setAutoQuarter] = useState('')
 
  async function load() {
    const [cyc, sets] = await Promise.all([getCycles(), getAllSettings()])
    setCycles(cyc)
    setSettings(sets)
    setQuarterOverride(sets.find(s => s.key === 'active_quarter_override')?.value || '')
    setAutoQuarter(sets.find(s => s.key === 'auto_active_quarter')?.value || 'Q1')
  }
  useEffect(() => { load() }, [])
 
  async function handleCreate(e) {
    e.preventDefault(); setError('')
    if (!form.name) { setError('Cycle name is required.'); return }
    setSaving(true)
    try {
      await createCycle({ name: form.name })
      setForm({ name: '' })
      load()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
 
  async function handleActivate(id) {
    if (!confirm('Set this as the active cycle? All other cycles will be deactivated.')) return
    await activateCycle(id); load()
  }
  
  async function handleSaveOverride() {
    try {
      await updateSetting('active_quarter_override', quarterOverride)
      alert('Quarter override saved.')
      load()
    } catch (err) {
      alert('Error saving override: ' + err.message)
    }
  }
 
  const activeQ = (quarterOverride && quarterOverride !== 'auto') ? quarterOverride : autoQuarter

  return (
    <AdminLayout>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Cycles & Windows</h1>
        <p className="admin-page-subtitle">Manage performance cycles, quarters, and reports.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* ── Active Quarter & Override ── */}
        <div className="admin-card" style={{ marginBottom: 0 }}>
          <div className="admin-card-title">Quarter Management</div>
          <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f3f4f6', borderRadius: '8px' }}>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Currently Active Quarter</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#4f46e5' }}>{activeQ === 'phase1' ? 'Goal Setting (Phase 1)' : activeQ}</div>
            {quarterOverride && quarterOverride !== 'auto' && (
              <span className="badge badge-draft" style={{ marginTop: '0.25rem' }}>Manual Override</span>
            )}
          </div>
          
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Force Active Quarter</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select className="admin-select" value={quarterOverride} onChange={e => setQuarterOverride(e.target.value)} style={{ flex: 1 }}>
              <option value="">Auto (Cron Job)</option>
              <option value="phase1">Goal Setting (Phase 1)</option>
              <option value="Q1">Q1</option>
              <option value="Q2">Q2</option>
              <option value="Q3">Q3</option>
              <option value="Q4">Q4</option>
            </select>
            <button className="btn-sm btn-primary-sm" onClick={handleSaveOverride}>Save</button>
          </div>
        </div>
      </div>

      {/* ── Create cycle ── */}
      <div className="admin-card">
        <div className="admin-card-title">Create new cycle</div>
        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '0.6rem 0.9rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</div>}
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input className="admin-input" placeholder="Cycle name e.g. FY 2026-27" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 2, minWidth: 180 }} />
          <button type="submit" className="btn-sm btn-primary-sm" disabled={saving}>
            {saving ? 'Creating…' : 'Create cycle'}
          </button>
        </form>
      </div>

      {/* ── Cycle list ── */}
      {cycles.map(cycle => (
        <div key={cycle.id} className="admin-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontWeight: 700, fontSize: '1rem', color: '#111827' }}>{cycle.name}</span>
                {cycle.is_active
                  ? <span className="badge badge-approved">● Active</span>
                  : <span className="badge badge-draft">Inactive</span>}
              </div>
              {cycle.is_active && (
                <div style={{ fontSize: '0.78rem', color: '#4f46e5', marginTop: 4, fontWeight: 500 }}>
                  Active Quarter: {activeQ === 'phase1' ? 'Goal Setting (Phase 1)' : activeQ}
                </div>
              )}
            </div>
            {!cycle.is_active && (
              <button className="btn-sm btn-primary-sm" onClick={() => handleActivate(cycle.id)}>
                Set as active
              </button>
            )}
          </div>

        </div>
      ))}

      {cycles.length === 0 && (
        <div className="admin-card"><div className="admin-empty">No cycles yet. Create one above.</div></div>
      )}
    </AdminLayout>
  )
}

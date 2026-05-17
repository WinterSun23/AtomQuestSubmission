import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getThrustAreas, createThrustArea, deleteThrustArea } from '../../lib/adminApi'

const PRESETS = ['Revenue', 'Operations', 'Safety', 'Customer Success', 'People & Culture', 'Technology', 'Compliance', 'Innovation']

export default function ThrustAreas() {
  const [areas,   setAreas]   = useState([])
  const [newName, setNewName] = useState('')
  const [adding,  setAdding]  = useState(false)
  const [error,   setError]   = useState('')

  async function load() { setAreas(await getThrustAreas()) }
  useEffect(() => { load() }, [])

  async function handleAdd(name) {
    const trimmed = (name ?? newName).trim()
    if (!trimmed) return
    setAdding(true); setError('')
    try {
      await createThrustArea(trimmed)
      setNewName('')
      await load()
    } catch (e) {
      setError(e.message?.includes('unique') ? `"${trimmed}" already exists.` : e.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete thrust area "${name}"? Goals using it will lose their category.`)) return
    await deleteThrustArea(id)
    load()
  }

  const existing = new Set(areas.map(a => a.name.toLowerCase()))

  return (
    <AdminLayout>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Thrust Areas</h1>
        <p className="admin-page-subtitle">Goal categories employees can assign to their goals</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
        {/* ── Current areas ── */}
        <div className="admin-card" style={{ margin: 0 }}>
          <div className="admin-card-title">Active thrust areas ({areas.length})</div>
          {areas.length === 0 && <div className="admin-empty">No thrust areas yet. Add some below.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {areas.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: '#f9fafb', borderRadius: 8 }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#111827' }}>🎯 {a.name}</span>
                <button className="btn-sm btn-danger-sm" onClick={() => handleDelete(a.id, a.name)}>Remove</button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Add new ── */}
        <div className="admin-card" style={{ margin: 0 }}>
          <div className="admin-card-title">Add a thrust area</div>
          {error && <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '0.6rem 0.9rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              id="new-thrust-area"
              className="admin-input"
              placeholder="e.g. Market Expansion"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              style={{ flex: 1 }}
            />
            <button className="btn-sm btn-primary-sm" onClick={() => handleAdd()} disabled={adding || !newName.trim()}>
              {adding ? '…' : 'Add'}
            </button>
          </div>

          <div className="admin-card-title" style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>Quick presets</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {PRESETS.map(p => (
              <button
                key={p}
                className="btn-sm btn-ghost-sm"
                style={{ opacity: existing.has(p.toLowerCase()) ? 0.4 : 1 }}
                disabled={existing.has(p.toLowerCase())}
                onClick={() => handleAdd(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

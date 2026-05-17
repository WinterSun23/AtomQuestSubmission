import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { createMfaChallenge, verifyMfaCode, listMfaFactors } from '../lib/auth'
import './Login.css'

export default function VerifyMfa() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const [code,      setCode]      = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [challenge, setChallenge] = useState(null)  // { factorId, challengeId }

  // Create the challenge as soon as the page loads
  useEffect(() => {
    async function init() {
      try {
        const factors = await listMfaFactors()
        const totp = factors.find(f => f.factor_type === 'totp' && f.status === 'verified')
        if (!totp) { navigate('/dashboard', { replace: true }); return }
        const ch = await createMfaChallenge(totp.id)
        setChallenge({ factorId: totp.id, challengeId: ch.id })
      } catch (err) {
        setError('Failed to start MFA challenge. Please try again.')
      }
    }
    init()
  }, [navigate])

  async function handleVerify(e) {
    e.preventDefault()
    if (!challenge) return
    setError('')
    setLoading(true)
    try {
      await verifyMfaCode(challenge.factorId, challenge.challengeId, code)
      // After verification Supabase upgrades the session to AAL2
      const from = location.state?.from ?? '/dashboard'
      navigate(from, { replace: true })
    } catch (err) {
      setError('Invalid code. Check your authenticator app and try again.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="brand-logo">
          <div className="brand-logo-icon">🎯</div>
          <span className="brand-logo-name">GoalFlow</span>
        </div>
        <div className="brand-tagline">
          <h1>Two-factor <span>authentication</span></h1>
          <p>Your account has MFA enabled. Enter the 6-digit code from your authenticator app to continue.</p>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <h2 className="auth-card-title">Verify your identity</h2>
          <p className="auth-card-subtitle">
            Open Google Authenticator or Authy and enter the 6-digit code for GoalFlow.
          </p>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <form onSubmit={handleVerify} noValidate>
            <div className="auth-field">
              <label className="auth-label" htmlFor="mfa-code">Authenticator code</label>
              <input
                id="mfa-code"
                className="auth-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                autoComplete="one-time-code"
                required
              />
            </div>

            <button
              id="btn-verify-mfa"
              type="submit"
              className="btn-primary"
              disabled={loading || code.length !== 6 || !challenge}
            >
              {loading ? <span className="spinner" /> : 'Verify & continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

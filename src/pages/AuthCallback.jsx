import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ensurePortalUser } from '../lib/auth'

/**
 * Supabase redirects here after Microsoft OAuth completes.
 * We:
 *   1. Wait for the session to be detected
 *   2. Call ensurePortalUser() to provision the user + optionally link Azure manager
 *   3. Navigate to dashboard
 */
export default function AuthCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Completing sign-in…')

  useEffect(() => {
    async function handleCallback() {
      // Supabase automatically processes the URL hash/code on client load
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error || !session) {
        setStatus('Sign-in failed. Redirecting…')
        setTimeout(() => navigate('/login'), 2000)
        return
      }

      try {
        setStatus('Setting up your profile…')
        // provider_token is the Microsoft access_token — used for Graph API calls
        await ensurePortalUser(session.user, session.provider_token)
        navigate('/dashboard', { replace: true })
      } catch (err) {
        console.error('User provisioning error:', err)
        // Don't block login for provisioning errors — user is authenticated
        navigate('/dashboard', { replace: true })
      }
    }

    handleCallback()
  }, [navigate])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, sans-serif',
      color: '#6b7280',
      gap: '1rem',
    }}>
      <div style={{
        width: 36, height: 36,
        border: '3px solid #e5e7eb',
        borderTopColor: '#6366f1',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
      <p style={{ margin: 0, fontSize: '0.95rem' }}>{status}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

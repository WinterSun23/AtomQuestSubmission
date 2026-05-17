import { supabase } from './supabase'

// ─── Email / Password ────────────────────────────────────────────────────────

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error

  // Provision into public.users if not already there
  // (The DB trigger handles this too, but this covers edge cases on first login)
  if (data.session) {
    await ensurePortalUser(data.session.user)
  }

  // Check if MFA challenge is required (full check including app_settings)
  const mfaStatus = await getPostLoginMfaStatus()
  if (mfaStatus !== 'none') {
    return { requiresMfa: true, mfaStatus, session: data.session }
  }

  return { requiresMfa: false, session: data.session }
}

export async function signUpWithEmail(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) throw error
  // public.users row is created by the DB trigger on auth.users INSERT
  return data
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Supabase will append a token to this URL and email it to the user.
    // The user clicks → lands here → our ResetPassword page reads the token
    // from the URL hash and calls updatePassword().
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw error
}

export async function updatePassword(newPassword) {
  // Only works when called within an active recovery session
  // (i.e. after user clicks the reset link and Supabase sets the session)
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

// ─── Microsoft SSO ───────────────────────────────────────────────────────────

export async function signInWithMicrosoft() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'openid email profile User.Read',
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) throw error
}

// ─── Sign out ────────────────────────────────────────────────────────────────

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// ─── MFA (TOTP — Google Authenticator / Authy) ───────────────────────────────

/**
 * Step 1 of MFA setup: enroll the user's device.
 * Returns a QR code URI and a secret for manual entry.
 * Show the QR code to the user so they scan it in their authenticator app.
 */
export async function enrollMfa() {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'GoalFlow',
  })
  if (error) throw error
  // data.totp.qr_code  → a data URI you can put in <img src={...}>
  // data.totp.secret   → manual entry fallback
  // data.id            → factorId, save this for the verify step
  return data
}

/**
 * Step 2 of MFA setup / login challenge:
 * Creates a challenge (tells Supabase "we are about to verify this factor")
 */
export async function createMfaChallenge(factorId) {
  const { data, error } = await supabase.auth.mfa.challenge({ factorId })
  if (error) throw error
  return data  // contains challengeId
}

/**
 * Step 3: verify the OTP code the user typed from their authenticator app.
 * Use this both during enrollment verification AND during login challenge.
 */
export async function verifyMfaCode(factorId, challengeId, code) {
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code,
  })
  if (error) throw error
  return data
}

/**
 * Unenroll (remove) a TOTP factor — used in settings if user wants to disable MFA.
 */
export async function unenrollMfa(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw error
}

/**
 * Get all enrolled MFA factors for the current user.
 */
export async function listMfaFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return data.all  // array of { id, type, status, ... }
}

/**
 * Check what MFA action (if any) the current session needs.
 *
 * Returns one of:
 *   'none'    → no MFA action needed
 *   'verify'  → user has TOTP enrolled but hasn't verified this session → /verify-mfa
 *
 * NOTE: The 'enroll' path (mfa_required=true but no TOTP set up) is checked
 * separately after login — not here — to avoid slow DB calls on every navigation.
 */
export async function sessionNeedsMfa() {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.currentLevel !== aal?.nextLevel) return 'verify'
  return 'none'
}

/**
 * Full MFA check including the app_settings DB call.
 * Call this once after a successful login, not on every route guard.
 */
export async function getPostLoginMfaStatus() {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.currentLevel !== aal?.nextLevel) return 'verify'

  const required = await isMfaRequired()
  if (required) {
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const hasVerifiedTotp = factors?.all?.some(f => f.factor_type === 'totp' && f.status === 'verified')
    if (!hasVerifiedTotp) return 'enroll'
  }

  return 'none'
}

// ─── App Settings helpers ─────────────────────────────────────────────────────

export async function getSetting(key) {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single()
  return data?.value ?? null
}

export async function isMfaRequired() {
  const val = await getSetting('mfa_required')
  return val === 'true'
}

// ─── Azure AD: pull manager via Microsoft Graph ──────────────────────────────

export async function fetchAzureManager(providerToken) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/manager', {
      headers: { Authorization: `Bearer ${providerToken}` },
    })
    if (res.status === 404) return null   // no manager set in AD
    if (!res.ok) return null
    const manager = await res.json()
    return {
      email: manager.mail ?? manager.userPrincipalName,
      displayName: manager.displayName,
      azureOid: manager.id,
    }
  } catch {
    return null  // Graph call is best-effort — never block login
  }
}

// ─── Portal user provisioning ─────────────────────────────────────────────────
// Ensures the user exists in public.users. For email users the DB trigger does
// this on INSERT into auth.users, but we call this defensively on login too.

export async function ensurePortalUser(supabaseUser, providerToken = null) {
  const authId = supabaseUser.id
  const email = supabaseUser.email
  const name = supabaseUser.user_metadata?.full_name
    ?? supabaseUser.user_metadata?.name
    ?? email.split('@')[0]

  // 1. Check if already in our users table
  const { data: existing } = await supabase
    .from('users')
    .select('id, manager_id')
    .eq('auth_id', authId)
    .maybeSingle()

  if (existing) {
    // Already exists — optionally update manager if not yet linked and SSO
    if (!existing.manager_id && providerToken) {
      await linkAzureManager(existing.id, providerToken)
    }
    return existing
  }

  // 2. New user — the DB trigger may have already inserted a row, but if not:
  const newUser = { auth_id: authId, email, name, role: 'employee' }

  if (providerToken) {
    const azureOid = supabaseUser.identities?.find(i => i.provider === 'azure')?.id
    if (azureOid) newUser.azure_oid = azureOid
    await linkAzureManager(null, providerToken, newUser)
  }

  const { data: created, error } = await supabase
    .from('users')
    .insert(newUser)
    .select()
    .single()

  if (error && error.code !== '23505') throw error  // ignore duplicate key
  return created
}

// Internal helper: find manager in portal by email and link
async function linkAzureManager(userId, providerToken, pendingUser = null) {
  const managerInfo = await fetchAzureManager(providerToken)
  if (!managerInfo) return

  const { data: managerRow } = await supabase
    .from('users')
    .select('id')
    .eq('email', managerInfo.email)
    .maybeSingle()

  if (!managerRow) return  // manager not in portal yet

  if (userId) {
    // Update existing row
    await supabase.from('users').update({ manager_id: managerRow.id }).eq('id', userId)
  } else if (pendingUser) {
    // Set on new user object before insert
    pendingUser.manager_id = managerRow.id
  }
}
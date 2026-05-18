import { supabase } from './supabase'
import { API_URL } from './userApi'

async function getHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    'Authorization': session ? `Bearer ${session.access_token}` : ''
  }
}

export async function generateAchievementReport(cycleId, quarter) {
  const headers = await getHeaders()
  const params = new URLSearchParams()
  if (cycleId) params.append('cycleId', cycleId)
  if (quarter) params.append('quarter', quarter)

  const url = `${API_URL}/api/reports/achievement?${params.toString()}`
  const res = await fetch(url, { headers })
  
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to generate Excel report')
  }
  
  return await res.json() // { success: true, url: signedUrl }
}

/**
 * Fetches the list of all past generated reports from S3 or Supabase Storage
 */
export async function getReportsList() {
  const headers = await getHeaders()
  const res = await fetch(`${API_URL}/api/reports/list`, { headers })
  
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to retrieve reports list')
  }
  
  const data = await res.json()
  return data.reports || []
}

/**
 * Generates a fresh temporary signed URL to download a past report
 */
export async function downloadReport(fileName) {
  const headers = await getHeaders()
  const res = await fetch(`${API_URL}/api/reports/download/${encodeURIComponent(fileName)}`, { headers })
  
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to get download URL')
  }
  
  const data = await res.json()
  return data.url
}

/**
 * Triggers background cron jobs (escalations checks, automated quarters transition)
 */
export async function triggerBackgroundCron() {
  const headers = await getHeaders()
  const res = await fetch(`${API_URL}/api/cron/trigger`, {
    method: 'POST',
    headers
  })
  
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to trigger background cron pipeline')
  }
  
  return await res.json() // { success: true, message: 'Cron job executed' }
}

/**
 * Logs a transaction/audit event and queues user notifications via BullMQ
 */
export async function logEvent(payload) {
  const headers = await getHeaders()
  const res = await fetch(`${API_URL}/api/events/log`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })
  
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to write audit event log')
  }
  
  return await res.json()
}

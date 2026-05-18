const nodemailer = require('nodemailer')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Create Nodemailer Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'wintersun23@gmail.com',
    pass: process.env.APP_PASSWORD
  }
})

/**
 * Fetch the current email notification setting level from the database.
 */
async function getEmailNotificationLevel() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'email_notifications_level')
      .single()

    if (error || !data) return 'important' // Fallback to 'important'
    return data.value
  } catch (err) {
    console.error('[EmailService] Error fetching notification level:', err.message)
    return 'important'
  }
}

/**
 * Checks if a specific notification is considered "important"
 */
function isImportantNotification(actionType, message, subject) {
  const text = `${actionType || ''} ${message || ''} ${subject || ''}`.toLowerCase()
  
  // Important categories: Level 3 escalations, Goal sheet approvals, goal rework requests
  if (text.includes('level 3') || text.includes('admin') || text.includes('escalation level 3')) {
    return true
  }
  if (text.includes('approved') || text.includes('approval') || text.includes('returned') || text.includes('rework') || text.includes('reject')) {
    return true
  }
  return false
}

/**
 * Dispatches a real email if preferences and levels allow.
 */
async function sendActualEmail({ to, subject, htmlBody, message, actionType }) {
  try {
    const settingLevel = await getEmailNotificationLevel()
    
    if (settingLevel === 'none') {
      console.log(`[EmailService] Skipping email to ${to} (Level is configured to 'none')`)
      return false
    }

    if (settingLevel === 'important') {
      const important = isImportantNotification(actionType, message, subject)
      if (!important) {
        console.log(`[EmailService] Skipping email to ${to} (Level is 'important', and this notification is considered low priority: "${subject}")`)
        return false
      }
    }

    // Attempt actual sending
    console.log(`[EmailService] Sending actual email to ${to} | Subject: "${subject}"...`)
    const info = await transporter.sendMail({
      from: `"Performance Portal" <${process.env.EMAIL_USER || 'wintersun23@gmail.com'}>`,
      to,
      subject: subject || 'Performance Portal Alert',
      html: htmlBody || `<p>${message}</p>`
    })

    console.log(`[EmailService] Email sent successfully! MessageId: ${info.messageId}`)
    return true
  } catch (err) {
    console.error(`[EmailService] Failed to send actual email:`, err.message)
    return false
  }
}

module.exports = { sendActualEmail, getEmailNotificationLevel }

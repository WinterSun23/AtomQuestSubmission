const { Queue } = require('bullmq')
require('dotenv').config()

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
console.log(`[Queue] Initializing BullMQ Connection with: ${redisUrl.split('@')[1] ? 'Cloud Redis' : 'Local Redis'}`)

let connectionOpts = {}
try {
  const url = new URL(redisUrl)
  connectionOpts = {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    // Add connection timeout properties
    connectTimeout: 10000,
    maxRetriesPerRequest: null
  }
} catch (err) {
  console.warn(`[Queue] Failed to parse REDIS_URL, falling back to localhost connection:`, err.message)
  connectionOpts = { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null }
}

const notificationQueue = new Queue('notification-queue', {
  connection: connectionOpts
})

/**
 * Enqueue a notification job with automated retry settings.
 */
async function enqueueNotificationJob(data) {
  console.log(`[Queue] Enqueuing notification job for recipient: ${data.recipientId}`)
  try {
    await notificationQueue.add('send-notification', data, {
      attempts: 3, // Retry up to 3 times on failure
      backoff: {
        type: 'exponential',
        delay: 5000 // Wait 5s, then 10s, then 20s
      }
    })
  } catch (err) {
    console.error(`[Queue] Failed to add job to BullMQ queue:`, err.message)
  }
}

module.exports = { enqueueNotificationJob, connectionOpts }

import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

// drizzle-orm/node-postgres creates and manages the pg Pool internally.
// Just pass the connection string — no need to import or configure pg directly.
export const db = drizzle(process.env.DATABASE_URL, { schema })

// Re-export all tables so callers can do:
//   import { db, users, goals } from './drizzle/db.js'
export * from './schema.js'

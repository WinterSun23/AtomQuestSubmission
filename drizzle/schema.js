import {
    pgTable,
    pgEnum,
    uuid,
    text,
    varchar,
    boolean,
    numeric,
    integer,
    timestamp,
    date,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['employee', 'manager', 'admin'])

export const uomTypeEnum = pgEnum('uom_type', [
    'numeric_min',   // Higher is better (e.g. Sales Revenue)
    'numeric_max',   // Lower is better (e.g. TAT, Cost)
    'percent_min',   // Higher % is better
    'percent_max',   // Lower % is better
    'timeline',      // Date-based completion
    'zero_based',    // Zero = success (e.g. Safety incidents)
])

export const sheetStatusEnum = pgEnum('sheet_status', [
    'draft',
    'submitted',
    'returned',
    'approved',
])

export const goalStatusEnum = pgEnum('goal_status', [
    'not_started',
    'on_track',
    'completed',
])

export const quarterEnum = pgEnum('quarter', ['Q1', 'Q2', 'Q3', 'Q4'])

export const escalationLevelEnum = pgEnum('escalation_level', ['1', '2', '3'])

// ─────────────────────────────────────────────
// DEPARTMENTS  (A3)
// ─────────────────────────────────────────────

export const departments = pgTable('departments', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 150 }).notNull().unique(),
    description: text('description'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─────────────────────────────────────────────
// USERS  (A1, A2, A3)
// ─────────────────────────────────────────────

export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    // Matches Supabase auth.users id so we can join across
    authId: uuid('auth_id').unique(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 150 }).notNull(),
    role: roleEnum('role').notNull().default('employee'),
    departmentId: uuid('department_id').references(() => departments.id),
    // Self-referencing: who is this user's L1 manager?
    managerId: uuid('manager_id'),
    // Microsoft Entra ID / Azure AD object id (bonus D1)
    azureOid: varchar('azure_oid', { length: 100 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─────────────────────────────────────────────
// THRUST AREAS  (B1)
// ─────────────────────────────────────────────

export const thrustAreas = pgTable('thrust_areas', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull().unique(), // e.g. Revenue, Safety, Operations
})

// ─────────────────────────────────────────────
// CYCLES & CHECK-IN WINDOWS  (C4)
// ─────────────────────────────────────────────

export const cycles = pgTable('cycles', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(), // e.g. "FY 2026-27"
    isActive: boolean('is_active').notNull().default(false),
    goalWindowStart: date('goal_window_start').notNull(),
    goalWindowEnd: date('goal_window_end').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const checkInWindows = pgTable('check_in_windows', {
    id: uuid('id').primaryKey().defaultRandom(),
    cycleId: uuid('cycle_id').notNull().references(() => cycles.id),
    quarter: quarterEnum('quarter').notNull(),
    windowOpen: date('window_open').notNull(),
    windowClose: date('window_close').notNull(),
})

// ─────────────────────────────────────────────
// GOAL SHEETS  (B1, B2)
// ─────────────────────────────────────────────

export const goalSheets = pgTable('goal_sheets', {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull().references(() => users.id),
    cycleId: uuid('cycle_id').notNull().references(() => cycles.id),
    status: sheetStatusEnum('status').notNull().default('draft'),
    // Manager's rework comment when returning a sheet
    reworkNote: text('rework_note'),
    submittedAt: timestamp('submitted_at'),
    approvedAt: timestamp('approved_at'),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─────────────────────────────────────────────
// GOALS  (B1, B3, B4)
// ─────────────────────────────────────────────

export const goals = pgTable('goals', {
    id: uuid('id').primaryKey().defaultRandom(),
    goalSheetId: uuid('goal_sheet_id').notNull().references(() => goalSheets.id),
    thrustAreaId: uuid('thrust_area_id').references(() => thrustAreas.id),
    title: varchar('title', { length: 150 }).notNull(),
    description: text('description'),
    uomType: uomTypeEnum('uom_type').notNull(),
    // Numeric target; for Timeline UoM store as Unix epoch (days). Use varchar for date strings.
    target: numeric('target', { precision: 15, scale: 4 }),
    targetDate: date('target_date'),  // used when uom_type = 'timeline'
    weightage: numeric('weightage', { precision: 5, scale: 2 }).notNull(), // 10.00 – 100.00
    isLocked: boolean('is_locked').notNull().default(false),
    // Shared Goals (B3)
    isShared: boolean('is_shared').notNull().default(false),
    sharedSourceId: uuid('shared_source_id'), // FK → goals.id of the primary/source goal
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─────────────────────────────────────────────
// CHECK-INS  (C1, C2, C3)
// ─────────────────────────────────────────────

export const checkIns = pgTable('check_ins', {
    id: uuid('id').primaryKey().defaultRandom(),
    goalId: uuid('goal_id').notNull().references(() => goals.id),
    windowId: uuid('window_id').notNull().references(() => checkInWindows.id),
    actualAchievement: numeric('actual_achievement', { precision: 15, scale: 4 }),
    actualDate: date('actual_date'),   // used when uom_type = 'timeline'
    status: goalStatusEnum('status').notNull().default('not_started'),
    // C3: auto-computed score (0–100)
    computedScore: numeric('computed_score', { precision: 6, scale: 2 }),
    // weightage × computedScore / 100
    weightedScore: numeric('weighted_score', { precision: 6, scale: 2 }),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─────────────────────────────────────────────
// MANAGER COMMENTS  (C2)
// ─────────────────────────────────────────────

export const managerComments = pgTable('manager_comments', {
    id: uuid('id').primaryKey().defaultRandom(),
    // Which employee's check-in this comment is attached to
    employeeId: uuid('employee_id').notNull().references(() => users.id),
    managerId: uuid('manager_id').notNull().references(() => users.id),
    windowId: uuid('window_id').notNull().references(() => checkInWindows.id),
    comment: text('comment').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    // Comments are immutable — no updatedAt intentionally
})

// ─────────────────────────────────────────────
// AUDIT LOG  (C7)
// ─────────────────────────────────────────────

export const auditLog = pgTable('audit_log', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    goalId: uuid('goal_id').references(() => goals.id),
    goalSheetId: uuid('goal_sheet_id').references(() => goalSheets.id),
    action: varchar('action', { length: 100 }).notNull(), // e.g. 'unlock', 'target_change'
    fieldChanged: varchar('field_changed', { length: 100 }),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    reason: text('reason'),  // Admin must provide reason on unlock
    changedAt: timestamp('changed_at').notNull().defaultNow(),
})

// ─────────────────────────────────────────────
// ESCALATION LOG  (D4)
// ─────────────────────────────────────────────

export const escalationLog = pgTable('escalation_log', {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: varchar('rule_id', { length: 10 }).notNull(), // E1, E2, E3, E4
    employeeId: uuid('employee_id').notNull().references(() => users.id),
    notifiedUserId: uuid('notified_user_id').notNull().references(() => users.id),
    escalationLevel: escalationLevelEnum('escalation_level').notNull(),
    sentAt: timestamp('sent_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolveNote: text('resolve_note'),
})

// ─────────────────────────────────────────────
// TEAMS BOT: User account linking  (D3)
// ─────────────────────────────────────────────

export const botUserLinks = pgTable('bot_user_links', {
    id: uuid('id').primaryKey().defaultRandom(),
    portalUserId: uuid('portal_user_id').notNull().references(() => users.id),
    teamsUserId: varchar('teams_user_id', { length: 255 }).notNull().unique(),
    linkedAt: timestamp('linked_at').notNull().defaultNow(),
})

// ─────────────────────────────────────────────
// APP SETTINGS  (global key-value config)
// ─────────────────────────────────────────────
// Keys: mfa_required, mfa_enrollment_grace, goal_window_open,
//       escalation_enabled, max_goals_per_sheet, min_goal_weightage

export const appSettings = pgTable('app_settings', {
    key:         varchar('key', { length: 100 }).primaryKey(),
    value:       text('value').notNull(),
    description: text('description'),
    updatedAt:   timestamp('updated_at').notNull().defaultNow(),
    updatedBy:   uuid('updated_by').references(() => users.id),
})

// ─────────────────────────────────────────────
// RELATIONS  (for Drizzle relational query API)
// ─────────────────────────────────────────────

export const departmentRelations = relations(departments, ({ many }) => ({
    users: many(users),
}))

export const userRelations = relations(users, ({ one, many }) => ({
    department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
    manager: one(users, { fields: [users.managerId], references: [users.id], relationName: 'manager' }),
    directReports: many(users, { relationName: 'manager' }),
    goalSheets: many(goalSheets),
    checkIns: many(checkIns),
    botLink: one(botUserLinks, { fields: [users.id], references: [botUserLinks.portalUserId] }),
}))

export const cycleRelations = relations(cycles, ({ many }) => ({
    goalSheets: many(goalSheets),
    checkInWindows: many(checkInWindows),
}))

export const checkInWindowRelations = relations(checkInWindows, ({ one, many }) => ({
    cycle: one(cycles, { fields: [checkInWindows.cycleId], references: [cycles.id] }),
    checkIns: many(checkIns),
    comments: many(managerComments),
}))

export const goalSheetRelations = relations(goalSheets, ({ one, many }) => ({
    employee: one(users, { fields: [goalSheets.employeeId], references: [users.id] }),
    approvedBy: one(users, { fields: [goalSheets.approvedBy], references: [users.id] }),
    cycle: one(cycles, { fields: [goalSheets.cycleId], references: [cycles.id] }),
    goals: many(goals),
}))

export const goalRelations = relations(goals, ({ one, many }) => ({
    goalSheet: one(goalSheets, { fields: [goals.goalSheetId], references: [goalSheets.id] }),
    thrustArea: one(thrustAreas, { fields: [goals.thrustAreaId], references: [thrustAreas.id] }),
    checkIns: many(checkIns),
    sharedCopies: many(goals, { relationName: 'sharedSource' }),
    sharedSource: one(goals, { fields: [goals.sharedSourceId], references: [goals.id], relationName: 'sharedSource' }),
}))

export const checkInRelations = relations(checkIns, ({ one }) => ({
    goal: one(goals, { fields: [checkIns.goalId], references: [goals.id] }),
    window: one(checkInWindows, { fields: [checkIns.windowId], references: [checkInWindows.id] }),
}))

export const managerCommentRelations = relations(managerComments, ({ one }) => ({
    employee: one(users, { fields: [managerComments.employeeId], references: [users.id] }),
    manager: one(users, { fields: [managerComments.managerId], references: [users.id] }),
    window: one(checkInWindows, { fields: [managerComments.windowId], references: [checkInWindows.id] }),
}))
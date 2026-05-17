# Detailed Feature Specification — Part 1: Core Modules

---

## Module A1: Auth & Session Management

**Purpose:** Secure login/logout with role-based session handling.

**Functional Requirements:**
- Email + password registration and login via Supabase Auth
- On signup, Admin assigns role (`employee`, `manager`, `admin`) stored in `user_metadata`
- JWT tokens issued by Supabase; refresh tokens handled automatically by Supabase client SDK
- Protected routes on frontend: redirect unauthenticated users to `/login`
- Backend middleware extracts JWT from `Authorization` header, verifies with Supabase, and attaches `user` object to request

**Key Screens:**
- `/login` — Email + password form; "Sign in with Microsoft" button (bonus SSO)
- `/register` — Admin-only; create new user accounts with role assignment

**Edge Cases:**
- Expired tokens → auto-refresh or redirect to login
- Multiple tabs → shared session state via Supabase `onAuthStateChange` listener
- Password reset flow via Supabase built-in email recovery

---

## Module A2: Role-Based Access Control (RBAC)

**Purpose:** Enforce what each role can see and do across the entire app.

**Role Permissions Matrix:**

| Action | Employee | Manager | Admin |
|---|:---:|:---:|:---:|
| Create own goals | ✅ | ✅ | ❌ |
| Submit goal sheet | ✅ | ✅ | ❌ |
| View own goals | ✅ | ✅ | ✅ |
| View team goals | ❌ | ✅ | ✅ |
| Approve/reject goals | ❌ | ✅ | ❌ |
| Push shared goals | ❌ | ✅ | ✅ |
| Log achievement | ✅ | ✅ | ❌ |
| Add check-in comment | ❌ | ✅ | ❌ |
| Manage users/depts | ❌ | ❌ | ✅ |
| Configure cycles | ❌ | ❌ | ✅ |
| Unlock locked goals | ❌ | ❌ | ✅ |
| View audit log | ❌ | ❌ | ✅ |
| Export reports | ❌ | ✅ | ✅ |

**Implementation:**
- **Frontend:** Route guards using a `<ProtectedRoute role={['admin']}>` wrapper component
- **Backend:** Express middleware `requireRole('admin')` checks JWT claims before processing
- **Database:** Supabase Row Level Security (RLS) policies on every table. Example: `goals` table policy allows `SELECT` only if `auth.uid() = goal_sheets.employee_id` OR user is the employee's manager OR user is admin

---

## Module A3: Org Hierarchy & User Management

**Purpose:** Admin defines the company structure — departments and reporting lines.

**Functional Requirements:**
- Admin CRUD for **Departments** (name, description)
- Admin CRUD for **Users** (name, email, role, department, manager assignment)
- Each Employee has exactly one L1 Manager (`manager_id` foreign key on `users` table)
- Each Manager can have multiple direct reports
- Admin can reassign an employee to a different manager or department

**Key Screens:**
- `/admin/departments` — List, create, edit, delete departments
- `/admin/users` — Paginated table of all users with filters by role/department. Inline editing for manager assignment via a searchable dropdown
- `/admin/org-chart` — (Optional) Visual tree view of the reporting hierarchy

**API Endpoints:**
- `GET /api/departments` — List all departments
- `POST /api/departments` — Create department (Admin only)
- `PUT /api/departments/:id` — Update department (Admin only)
- `GET /api/users` — List users with query filters (`?role=employee&department_id=xxx`)
- `POST /api/users` — Create user (Admin only; triggers Supabase Auth invite email)
- `PUT /api/users/:id` — Update user profile/role/manager (Admin only)
- `GET /api/users/:id/direct-reports` — List all employees reporting to a manager

---

## Module A4: UI Shell & Navigation

**Purpose:** The app layout that wraps all pages; adapts based on role.

**Structure:**
- **Sidebar Navigation** (collapsible on mobile):
  - Employee sees: My Goals, My Check-ins, Profile
  - Manager sees: My Goals, My Check-ins, Team Dashboard, Team Goals, Profile
  - Admin sees: All of the above + Users, Departments, Cycles, Reports, Audit Log
- **Top Bar:** App logo, current cycle indicator (e.g., "FY 2026-27"), notification bell, user avatar with dropdown (profile, logout)
- **Breadcrumbs** on inner pages for navigation context
- **Responsive:** Sidebar collapses to hamburger menu below 768px

---

## Module B1: Goal Creation & Submission

**Purpose:** Employee creates their annual Goal Sheet with up to 8 weighted goals.

**Functional Requirements:**
- Employee navigates to "My Goals" and clicks "Create Goal Sheet" (only available if no sheet exists for the current cycle)
- A Goal Sheet is a container holding 1–8 individual goals
- For each goal, the employee fills in:
  - **Thrust Area** — Selected from a predefined dropdown (e.g., Revenue, Operations, Safety, Customer). Admin configures the list.
  - **Goal Title** — Free text, max 150 characters
  - **Description** — Free text, max 500 characters
  - **Unit of Measurement (UoM)** — Dropdown: `Numeric (Min)`, `Numeric (Max)`, `Percentage (Min)`, `Percentage (Max)`, `Timeline`, `Zero-based`
  - **Target** — Numeric input (or date picker for Timeline UoM)
  - **Weightage** — Numeric input (percentage, e.g., 25)

**Validation Rules (System-Enforced):**

| Rule | Trigger | Error Message |
|---|---|---|
| Max 8 goals | Employee tries to add a 9th | "Maximum of 8 goals allowed per sheet" |
| Min 10% weightage | Any goal has weightage < 10 | "Each goal must have at least 10% weightage" |
| Total = 100% | On submission, sum ≠ 100 | "Total weightage must equal exactly 100%. Current: {sum}%" |
| Required fields | Any field is empty | "{field} is required" |

**Goal Sheet Statuses:**
- `draft` — Employee is still editing; not yet submitted
- `submitted` — Sent to manager for review
- `returned` — Manager sent it back for rework (with comments)
- `approved` — Manager approved; all goals are now locked
- `locked` — System state after approval; immutable without Admin unlock

**Key Screen: Goal Editor**
- A dynamic form where the employee can add/remove goal rows
- Real-time weightage counter at the bottom showing `Current Total: 65% / 100%` with a progress bar
- "Save Draft" button (saves without validation) and "Submit for Approval" button (triggers all validations)
- If sheet is in `returned` status, show manager's rework comments at the top in a yellow banner

**API Endpoints:**
- `POST /api/goal-sheets` — Create a new goal sheet for the current cycle
- `GET /api/goal-sheets/mine` — Get the current employee's sheet for the active cycle
- `PUT /api/goal-sheets/:id` — Update sheet status (submit, return)
- `POST /api/goals` — Add a goal to a sheet
- `PUT /api/goals/:id` — Edit a goal (only if sheet is `draft` or `returned`)
- `DELETE /api/goals/:id` — Remove a goal from the sheet

---

## Module B2: Manager Approval Workflow

**Purpose:** Manager reviews, edits, or returns each team member's submitted Goal Sheet.

**Functional Requirements:**
- Manager navigates to "Team Goals" and sees a list of their direct reports with sheet status
- Clicking on an employee opens their submitted Goal Sheet in a **review mode**
- Manager can:
  - **Approve** — Locks the sheet; goals become immutable
  - **Return for Rework** — Sends it back to the employee with a mandatory comment explaining what needs to change
  - **Inline Edit** — Manager can directly modify Targets and Weightages before approving. The employee sees the manager's edits highlighted.
- On approval, a `goal_locked` event is fired; the Audit Trail logs the lock timestamp

**Key Screen: Team Goals Dashboard**
- Table with columns: Employee Name | Department | Sheet Status | Submitted On | Actions
- Status badges: 🟡 Submitted, 🔴 Returned, 🟢 Approved, ⚪ Not Started
- Clicking an employee expands or navigates to their full Goal Sheet in review mode

**Key Screen: Goal Sheet Review Mode**
- Read-only view of all goals with an "Edit" toggle per row for inline editing
- Editable fields (for manager): Target, Weightage
- Non-editable fields: Thrust Area, Title, Description, UoM (manager sees these but cannot change them)
- Bottom section: Comment box (required if returning) + Approve / Return buttons
- If manager edits weightage, real-time validation still enforces the 100% rule

**API Endpoints:**
- `GET /api/goal-sheets/team` — List all sheets from direct reports
- `PUT /api/goal-sheets/:id/approve` — Approve and lock the sheet
- `PUT /api/goal-sheets/:id/return` — Return with rework comment
- `PUT /api/goals/:id/manager-edit` — Manager inline edit (only for submitted sheets)

---

## Module B3: Shared Goals

**Purpose:** Push a common departmental KPI to multiple employees so everyone tracks against the same target.

**Functional Requirements:**
- Admin or Manager creates a **Shared Goal** — a goal template with a fixed Title, Description, UoM, and Target
- They then select which employees receive it (by individual selection or by department)
- The shared goal appears on each selected employee's Goal Sheet automatically
- **Restrictions for recipients:**
  - Title and Target are **read-only** (greyed out in the UI)
  - Weightage is **editable** (so the employee can decide how much of their 100% this goal occupies)
- **Achievement Sync:** When the primary owner (the person who created the shared goal) updates the achievement, it propagates to all linked copies

**Data Model:**
- `goals` table has `is_shared: boolean` and `shared_source_id: uuid` (references the original goal)
- When the primary goal's achievement is updated, a database trigger (or backend logic) updates all goals where `shared_source_id` matches

**Key Screen: Shared Goal Push**
- Accessible from Manager's "Team Goals" or Admin's "Goals" section
- Form: Goal Title, Description, Thrust Area, UoM, Target
- Employee selector: Multi-select dropdown or department-level checkbox
- "Push to Employees" button

**API Endpoints:**
- `POST /api/goals/shared` — Create and push a shared goal to selected employees
- `GET /api/goals/shared` — List all shared goals created by the current user
- `PUT /api/goals/:id/achievement-sync` — Update achievement on primary; triggers sync

---

## Module B4: Goal Locking & Admin Unlock

**Purpose:** Prevent tampering with approved goals; allow Admin exceptions.

**Functional Requirements:**
- Once a Manager approves a Goal Sheet, every goal on it gets `is_locked: true`
- Locked goals cannot be edited by the employee or manager through any API endpoint
- Backend middleware checks `is_locked` before allowing any `PUT` on a goal
- **Admin Unlock:** Admin navigates to a specific employee's goal sheet and clicks "Unlock for Editing." This:
  - Sets `is_locked: false` on all goals in the sheet
  - Logs the unlock event in the Audit Trail (who unlocked, when, reason)
  - Changes sheet status back to `draft`
  - The employee can now edit and must re-submit for approval

**API Endpoints:**
- `PUT /api/goal-sheets/:id/unlock` — Admin only; unlocks sheet + logs audit entry

---

## Module C1: Quarterly Check-in (Employee)

**Purpose:** Employee logs actual progress against each goal during the active quarterly window.

**Functional Requirements:**
- The system checks if the current date falls within an active Check-in Window (configured by Admin)
- If yes, the employee sees a "Log Q{n} Progress" button on their Goal Sheet
- For each goal, the employee enters:
  - **Actual Achievement** — Numeric value (or date for Timeline UoM)
  - **Status** — Dropdown: `Not Started`, `On Track`, `Completed`
- On save, the system computes a **Progress Score** per goal (see Module C3)
- Employee can update their check-in multiple times within the open window
- Once the window closes, check-in data becomes read-only

**Key Screen: Check-in Form**
- Table layout showing all goals with columns: Goal Title | Target | Actual (editable input) | Status (dropdown) | Score (auto-computed, read-only)
- "Save Progress" button at the bottom
- Banner at the top: "Q1 Check-in Window: July 1 – July 31. {X} days remaining"

**API Endpoints:**
- `GET /api/check-in-windows/active` — Get the currently active window (if any)
- `POST /api/check-ins` — Create or update check-in entry for a goal
- `GET /api/check-ins/mine?window_id=xxx` — Get all check-ins for the current employee in a specific window

---

## Module C2: Manager Check-in & Feedback

**Purpose:** Manager reviews each employee's quarterly progress and documents the discussion.

**Functional Requirements:**
- Manager navigates to "Team Dashboard" and sees each direct report's check-in status for the active quarter
- Clicking an employee shows their Planned vs. Actual data in a read-only table
- Manager adds a **structured Check-in Comment** per employee (not per goal) — a single text block documenting the review discussion
- Comments are timestamped and immutable once saved (no edits; but manager can add another comment)

**Key Screen: Team Check-in Dashboard**
- Table: Employee Name | Check-in Status (Pending / Completed) | Overall Score | Actions
- Clicking "Review" opens the employee's check-in detail with the comment form

**API Endpoints:**
- `GET /api/manager-reviews/team?window_id=xxx` — Get team check-in summary
- `POST /api/manager-reviews` — Add a check-in comment for an employee
- `GET /api/manager-reviews/:employee_id?window_id=xxx` — Get all comments for an employee in a window

---

## Module C3: Progress Score Engine

**Purpose:** Automatically compute a progress score for each goal based on its UoM type.

**Formulas:**

| UoM Type | Logic | Formula | Example |
|---|---|---|---|
| **Numeric / % (Min)** | Higher is better | `(Actual / Target) × 100` | Target: 100 sales, Actual: 80 → Score: 80% |
| **Numeric / % (Max)** | Lower is better | `(Target / Actual) × 100` | Target: 5 days TAT, Actual: 4 → Score: 125% (capped at 100%) |
| **Timeline** | Date comparison | If completed on or before deadline → 100%. If after → 0% (or proportional) | Deadline: July 31, Completed: July 20 → 100% |
| **Zero-based** | Zero = success | If Actual = 0 → 100%. If Actual > 0 → 0% | Safety incidents target: 0, Actual: 0 → 100% |

**Implementation:**
- Score computation runs in the backend on every check-in save (`POST /api/check-ins`)
- The computed score is stored in `check_ins.computed_score`
- **Weighted Score** per goal = `computed_score × (weightage / 100)`
- **Overall Sheet Score** = Sum of all weighted scores
- Scores are for tracking purposes only — not used as official ratings (as stated in the guide)

**Score Capping:** Max score per goal is capped at 100% to prevent gaming (e.g., someone achieving 200% of a "Max" target)

---

## Module C4: Cycle Management (Admin)

**Purpose:** Admin configures the annual performance cycle and its quarterly check-in windows.

**Functional Requirements:**
- Admin creates a **Cycle** (e.g., "FY 2026-27") with:
  - Goal Setting Window: Start date, End date
- Admin creates **Check-in Windows** within a cycle:
  - Q1: Open date, Close date
  - Q2: Open date, Close date
  - Q3: Open date, Close date
  - Q4: Open date, Close date
- Only one cycle can be "active" at a time
- The system uses the active cycle and its windows to determine what actions are available

**API Endpoints:**
- `POST /api/cycles` — Create a new cycle
- `PUT /api/cycles/:id/activate` — Set a cycle as active
- `POST /api/check-in-windows` — Create a check-in window within a cycle
- `PUT /api/check-in-windows/:id` — Edit window dates

---

## Module C5: Achievement Report Export

**Purpose:** Exportable CSV/Excel report of Planned vs. Actual for all employees.

**Functional Requirements:**
- Available to Manager (their team only) and Admin (entire org)
- Filters: Department, Quarter, Employee
- Columns: Employee Name | Department | Goal Title | Thrust Area | UoM | Target | Actual | Score | Weightage | Weighted Score
- Export formats: CSV and Excel (.xlsx)
- Backend generates the file and returns it as a download

**Implementation:**
- Use the `exceljs` npm package for Excel generation
- API endpoint streams the file: `GET /api/reports/achievement?format=xlsx&quarter=Q1&department_id=xxx`

---

## Module C6: Completion Dashboard

**Purpose:** Real-time view showing who has and hasn't completed their quarterly check-ins.

**Functional Requirements:**
- Admin/Manager screen showing completion rates
- Metrics:
  - Total employees in scope
  - Number who have completed check-in
  - Number pending
  - Percentage complete
- Drill-down by department
- Color-coded: Green (>80% complete), Yellow (50-80%), Red (<50%)

**Key Screen:**
- Summary cards at the top (total, completed, pending, % complete)
- Department-wise breakdown table below
- Clicking a department shows the individual employee list with their status

---

## Module C7: Audit Trail

**Purpose:** Log every modification made to goals after they are locked.

**Functional Requirements:**
- Any change to a locked goal (via Admin unlock or system override) is logged with:
  - `user_id` — Who made the change
  - `goal_id` — Which goal was changed
  - `field_changed` — e.g., "target", "weightage", "is_locked"
  - `old_value` — Previous value
  - `new_value` — Updated value
  - `changed_at` — Timestamp
- Admin can view the full audit log with filters: Date range, Employee, Goal
- Log is append-only; entries cannot be edited or deleted

**Implementation:**
- Backend inserts an audit entry in the same database transaction as the goal update
- Alternatively, use a Supabase database trigger on the `goals` table that fires on UPDATE when `is_locked` was previously true

**API Endpoints:**
- `GET /api/audit-log?employee_id=xxx&from=2026-01-01&to=2026-03-31` — Filtered audit log (Admin only)

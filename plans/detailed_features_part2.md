# Detailed Feature Specification — Part 2: Bonus Modules

---

## Module D1: Microsoft Entra ID (Azure AD) SSO

**Purpose:** Allow employees to log in with their corporate Microsoft account instead of a separate email/password.

**Functional Requirements:**
- "Sign in with Microsoft" button on the login page
- Uses OAuth 2.0 / OpenID Connect flow via Microsoft Entra ID
- Supabase Auth supports custom OAuth providers — configure Entra ID as a provider
- On first SSO login, auto-create the user in the `users` table with data from the Azure AD token:
  - `email` from token claims
  - `name` from `displayName`
  - `department` from `department` claim (if available)
  - `manager_id` resolved from `manager` Graph API call (if available)
- Role mapping: Map Azure AD group memberships to portal roles. E.g., users in the "HR-Admins" group get `admin` role

**Implementation Steps:**
1. Register the app in Azure Portal → App Registrations
2. Configure redirect URI to `https://your-supabase-project.supabase.co/auth/v1/callback`
3. Add Entra ID as a Supabase Auth provider with Client ID, Client Secret, and Tenant ID
4. On the backend, after first login, call Microsoft Graph API `/me/manager` to auto-populate reporting lines

**Edge Cases:**
- User exists in Azure AD but not in the portal → auto-provision with `employee` role
- User's manager changes in Azure AD → periodic sync job (daily cron) or manual "Sync from AD" button for Admin

---

## Module D2: Email Notifications

**Purpose:** Automated transactional emails for key workflow events.

**Trigger Events:**

| Event | Recipient | Email Subject |
|---|---|---|
| Goal sheet submitted | Manager | "{Employee} has submitted their goal sheet for review" |
| Goal sheet approved | Employee | "Your goal sheet has been approved by {Manager}" |
| Goal sheet returned | Employee | "Your goal sheet needs revision — feedback from {Manager}" |
| Check-in window opens | All employees | "Q{n} Check-in is now open — log your progress by {deadline}" |
| Check-in reminder (3 days before close) | Employees who haven't completed | "Reminder: Q{n} check-in closes in 3 days" |
| Escalation triggered | Manager / HR | "Action required: {Employee} has not completed {action}" |

**Implementation:**
- Use **Resend** (free tier: 100 emails/day) or Supabase Edge Functions with an SMTP provider
- Email templates stored as HTML files in the backend (`/templates/email/`)
- Backend service `emailService.send(templateName, recipientEmail, variables)` handles all sends
- Emails are queued — if the send fails, retry up to 3 times with exponential backoff

**API Endpoints:**
- No public API — emails are triggered internally by other modules
- `GET /api/admin/email-log` — Admin can view sent email history (optional)

---

## Module D3: Teams Bot Agent

**Purpose:** A conversational bot in Microsoft Teams that lets users interact with the portal without opening the web app.

### Supported Conversations

**For Employees:**

| User Says (Example) | Bot Action | Bot Response |
|---|---|---|
| "Show my goals" | Fetches goal sheet for active cycle | Adaptive Card with goal list table |
| "Update Q1 progress for Sales Revenue to 45000" | Parses goal name + value, calls check-in API | "✅ Updated Sales Revenue: 45,000 / 100,000 (45%). Status: On Track" |
| "What's my overall score?" | Fetches computed scores | "Your overall weighted score for Q1 is 72%" |
| "Help me write a goal about reducing costs" | Calls AI SMART Goal Assistant | Suggests a SMART goal with title, description, UoM, and target |

**For Managers:**

| User Says (Example) | Bot Action | Bot Response |
|---|---|---|
| "Show team status" | Fetches team check-in completion | Adaptive Card with team table: Name, Status, Score |
| "Who hasn't submitted goals?" | Queries goal sheets with status ≠ approved | List of employees with pending sheets |
| "Approve goals for Rahul" | Fetches Rahul's sheet, shows summary | Adaptive Card with Approve / Return buttons |

### Architecture

```
User in Teams → Azure Bot Service → Bot Framework SDK (Node.js)
    → Intent Parser (AI Agent / Gemini API)
    → Action Router (maps intent to API call)
    → Express API (same backend as web app)
    → Response formatted as Adaptive Card → sent back to Teams
```

**Key Components:**
1. **Bot Entry Point** (`/api/bot/messages`) — Webhook that Azure Bot Service calls when a user sends a message
2. **Intent Parser** — Sends the user's message to Gemini API with a system prompt listing all possible intents and their required parameters. Returns structured JSON: `{ intent: "update_checkin", goal_name: "Sales Revenue", value: 45000 }`
3. **Action Router** — Maps the parsed intent to the correct internal API call. Uses the same service layer as the web app (not duplicated logic)
4. **Adaptive Card Builder** — Formats responses as Teams Adaptive Cards (rich, interactive UI elements within the chat)
5. **Auth Linking** — On first interaction, the bot asks the user to link their portal account. Uses Bot Framework's OAuth prompt to authenticate via Supabase Auth or Entra ID. After linking, the bot stores the mapping `teams_user_id → portal_user_id`

**Implementation Steps:**
1. Create a Bot Registration in Azure Portal
2. Install `botbuilder` npm package in the Node.js backend
3. Create a `TeamsBot` class extending `ActivityHandler`
4. Implement `onMessage` handler that pipes messages through Intent Parser → Action Router → Response Builder
5. Deploy the bot endpoint and register the Teams channel in Azure Bot Service
6. Create the Teams App Manifest (manifest.json) and sideload it into a Teams tenant for testing

---

## Module D4: Escalation Engine

**Purpose:** Automatically nudge people who are falling behind on deadlines.

### Escalation Rules

| Rule ID | Condition | Escalation Chain | Intervals |
|---|---|---|---|
| E1 | Employee has not submitted goals within N days of goal window opening | Notify Employee → Notify Manager → Notify HR | Day 3, Day 5, Day 7 |
| E2 | Manager has not approved goals within N days of submission | Notify Manager → Notify Skip-level Manager → Notify HR | Day 2, Day 4, Day 6 |
| E3 | Employee has not completed quarterly check-in within the active window | Notify Employee → Notify Manager → Notify HR | 7 days before close, 3 days before, 1 day before |
| E4 | Manager has not completed team check-in review | Notify Manager → Notify HR | 5 days before close, 2 days before |

### Implementation

- **Cron Job:** A scheduled job runs daily (using `node-cron` or a Supabase Edge Function on a schedule)
- The job queries:
  - Active cycle windows and their deadlines
  - Goal sheets with status `draft` (not submitted)
  - Goal sheets with status `submitted` (not approved)
  - Check-ins not yet completed for the active window
- For each violation, it checks the `escalation_log` table to see what level has already been sent
- If the next escalation level is due (based on intervals), it:
  - Sends the appropriate email/Teams notification
  - Inserts a record into `escalation_log`

**Escalation Log Table:**
- `id`, `rule_id`, `employee_id`, `escalation_level` (1, 2, 3), `notified_user_id`, `sent_at`, `resolved_at`

**Admin Screen:**
- `/admin/escalations` — Table showing all active escalations with filters
- Admin can manually mark an escalation as "Resolved" with a comment

**API Endpoints:**
- `GET /api/escalations` — List escalations (Admin only)
- `PUT /api/escalations/:id/resolve` — Mark as resolved
- `GET /api/admin/escalation-rules` — View/edit configurable intervals (N days)

---

## Module D5: Analytics Dashboard

**Purpose:** Visual analytics showing organizational goal health and trends.

### Dashboard Widgets

**1. QoQ Achievement Trend (Line Chart)**
- X-axis: Quarters (Q1, Q2, Q3, Q4)
- Y-axis: Average weighted score
- Lines: Individual employee, team average, department average, org average
- Use: Spot improving or declining performance over time

**2. Completion Rate Heatmap (Grid)**
- Rows: Departments
- Columns: Quarters
- Cell color: Green (>90%), Yellow (60-90%), Red (<60%)
- Use: Quickly identify departments that are lagging on check-ins

**3. Goal Distribution (Pie / Donut Charts)**
- By Thrust Area: What % of all goals fall under Revenue vs. Operations vs. Safety etc.
- By UoM Type: Distribution of Numeric vs. Timeline vs. Zero-based goals
- By Status: Not Started vs. On Track vs. Completed across the org

**4. Manager Effectiveness (Bar Chart)**
- X-axis: Manager names
- Y-axis: % of their team's check-ins completed on time
- Use: Identify managers who are consistently late on reviews

### Implementation
- Use **Recharts** (React charting library) for all visualizations
- Backend provides aggregated data via dedicated report endpoints
- Dashboard is accessible to Admin (full org) and Manager (their team only)

**API Endpoints:**
- `GET /api/reports/qoq-trend?department_id=xxx` — QoQ score averages
- `GET /api/reports/completion-heatmap` — Completion rates by dept × quarter
- `GET /api/reports/goal-distribution` — Goal breakdown by thrust area, UoM, status
- `GET /api/reports/manager-effectiveness` — Check-in completion rates per manager

---

## Module D6: AI — SMART Goal Assistant

**Purpose:** Help employees write better, measurable goals using an LLM.

**Functional Requirements:**
- On the Goal Creation form, a "✨ Improve with AI" button appears next to the Goal Title/Description fields
- Clicking it sends the employee's draft text to the Gemini API with a prompt:

```
You are an HR performance management expert. The employee has written 
the following goal. Rewrite it as a SMART goal (Specific, Measurable, 
Achievable, Relevant, Time-bound). Also suggest an appropriate Unit of 
Measurement and a realistic Target value.

Employee's draft: "{user_input}"
Department: "{department}"
Thrust Area: "{thrust_area}"

Respond in JSON: { title, description, suggested_uom, suggested_target }
```

- The AI response is shown in a preview modal. The employee can:
  - **Accept** — Auto-fills the form fields with the AI suggestion
  - **Edit** — Modify the suggestion before accepting
  - **Dismiss** — Close the modal and keep their original text

**API Endpoint:**
- `POST /api/ai/smart-goal` — Body: `{ draft_text, department, thrust_area }` → Returns AI-suggested goal

---

## Module D7: AI — Feedback Summarizer

**Purpose:** Help managers write professional check-in comments from rough notes.

**Functional Requirements:**
- On the Manager Check-in Comment form, a "✨ Polish Feedback" button appears
- Manager types quick rough notes (e.g., "doing ok, sales numbers low, needs to focus on client retention, good attitude though")
- Clicking the button sends it to Gemini API:

```
You are an HR expert. A manager has written the following rough notes 
about an employee's quarterly performance review. Rewrite these notes 
as a professional, constructive, and balanced performance check-in comment. 
Keep it under 200 words. Maintain the original sentiment.

Manager's notes: "{rough_notes}"
```

- The polished comment replaces the text in the input field. Manager can edit before saving.

**API Endpoint:**
- `POST /api/ai/polish-feedback` — Body: `{ rough_notes }` → Returns polished comment string

**ATOMQUEST HACKATHON 1.0**

Problem Statement

**In-House Goal Setting & Tracking Portal**

# 1\. Background & Problem Context

Organizations that rely on manual or fragmented goal-tracking methods often struggle with alignment, visibility, and accountability. Spreadsheets, emails, and offline review cycles create blind spots - managers cannot monitor team progress in real time, employees lack clarity on how their work connects to organizational priorities, and HR teams are left piecing together data at appraisal time.

The challenge is to build a structured, digital Goal Setting & Tracking Portal that eliminates these pain points. The system must support the full lifecycle of employee goals - from creation and alignment to quarterly check-ins and performance visibility - while being intuitive, reliable, and audit-ready.

# 2\. What You Need to Build

Participants are required to design and develop a functional web-based portal that fulfils the following core requirements.

## 2.1 Phase 1 - Goal Creation & Approval (Must-Have)

- Employee-facing interface to create and submit a Goal Sheet
- Select a Thrust Area and define Goal Title / Description
- Assign Unit of Measurement (UoM): Numeric, %, Timeline, or Zero-based
- Set Targets and Weightage per goal
- System-enforced validation rules:
- Total weightage across all goals must equal 100%
- Minimum weightage per individual goal: 10%
- Maximum number of goals per employee: 8
- Manager (L1) Approval Workflow:
- Review submitted goals; ability to edit targets / weightages inline or return for rework
- On approval, goals are locked - no further edits without Admin intervention
- Shared Goals functionality:
- Admin or manager can push a departmental KPI to multiple employees
- Recipients may adjust weightage only; Goal Title and Target are read-only
- Achievement updates by the primary owner sync across all linked goal sheets

## 2.2 Phase 2 - Achievement Tracking & Quarterly Check-ins (Must-Have)

- Quarterly update interface for employees to log Actual Achievement against Planned Targets
- Status selection per goal: Not Started / On Track / Completed
- Manager Check-in module:
- View Planned vs. Achievement data for each team member
- Add a structured Check-in Comment to document the discussion
- System-computed progress scores (for tracking only, not ratings):

| **UoM Type**      | **Description**                         | **Formula**                  |
| ----------------- | --------------------------------------- | ---------------------------- |
| Min (Numeric / %) | Higher is better - e.g., Sales Revenue  | Achievement ÷ Target         |
| Max (Numeric / %) | Lower is better - e.g., TAT, Cost       | Target ÷ Achievement         |
| Timeline          | Date-based completion                   | Completion date vs. Deadline |
| Zero              | Zero = Success - e.g., Safety incidents | If 0 → 100%, else 0%         |

## 2.3 Check-in Schedule

The portal must enforce the following quarterly windows for achievement capture:

| **Period**                 | **Window Opens** | **Action**                           |
| -------------------------- | ---------------- | ------------------------------------ |
| **Phase 1 - Goal Setting** | 1st May          | Goal Creation, Submission & Approval |
| **Q1 Check-in**            | July             | Progress Update - Planned vs. Actual |
| **Q2 Check-in**            | October          | Progress Update - Planned vs. Actual |
| **Q3 Check-in**            | January          | Progress Update - Planned vs. Actual |
| **Q4 / Annual**            | March / April    | Final Achievement Capture            |

# 3\. User Roles & Personas

The portal must support three distinct user roles, each with clearly differentiated access and capabilities:

| **Role**         | **Responsibilities**                                              | **Required System Capabilities**                                         |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Employee**     | Draft goals; enter quarterly achievement; update progress status  | Create & edit goals pre-submission; view locked goals; input actuals     |
| **Manager (L1)** | Review & approve goals; conduct quarterly check-ins; log feedback | Team dashboard; inline editing during approval; comment / feedback logs  |
| **Admin / HR**   | Configure cycles; manage org hierarchy; oversee completion rates  | Cycle management; exception handling; audit logs; goal unlock capability |

# 4\. Reporting & Governance Requirements

- Achievement Report: Exportable (CSV / Excel) showing Planned Target vs. Actual Achievement for all employees
- Completion Dashboard: Real-time view of which employees and managers have completed quarterly check-ins
- Audit Trail: System must log all changes made to goals after the lock date - capturing who changed what and when

# 5\. Good-to-Have Features (Bonus Points)

While not mandatory, the following enhancements will be positively evaluated and can differentiate your solution. Teams that implement any of these will earn additional credit under the evaluation criteria.

## 5.1 Microsoft Entra ID (Azure AD) Integration

- Single Sign-On (SSO) for employees and managers via Microsoft Entra ID
- Automatic org hierarchy sync - reporting lines derived from Azure AD attributes
- Role assignment mapped from Azure AD group membership

## 5.2 Email & Microsoft Teams Integration

- Automated email notifications for key events: goal submission, approval, rejection, check-in reminders
- Teams bot or adaptive card notifications for managers when a team member submits or updates goals
- Deep-link support so users can navigate directly from a Teams notification to the relevant goal sheet

## 5.3 Escalation Module (Rule-Based)

- Configurable escalation rules triggered by defined conditions, for example:
- Employee has not submitted goals within N days of cycle open
- Manager has not approved goals within N days of submission
- Quarterly check-in not completed within the active window
- Escalation chain: auto-notification to employee → manager → skip-level / HR after defined intervals
- Escalation log visible to Admin / HR for tracking and resolution

## 5.4 Analytics Module

- Quarter-on-Quarter (QoQ) goal achievement trends at individual, team, and department levels
- Heatmaps or progress charts showing completion rates across the organization
- Goal distribution analysis - breakdown by Thrust Area, UoM type, and status
- Manager effectiveness dashboard - comparison of check-in completion rates across L1 managers

# 6\. Evaluation Parameters & Scoring

Submissions will be judged by a panel against the following criteria. Each parameter carries equal weight unless otherwise announced on the day:

| **#** | **Parameter**                   | **What Evaluators Will Look For**                                                                                                                              |
| ----- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Functionality of the Portal** | Does the portal work end-to-end? Can an employee create goals, a manager approve them, and check-ins be completed without errors?                              |
| 2     | **Adherence to BRD**            | Are all Phase 1 and Phase 2 requirements implemented? Are validation rules (weightage = 100%, max 8 goals, min 10%) correctly enforced?                        |
| 3     | **User Friendliness**           | Is the UI intuitive for non-technical users? Are workflows logical, error messages helpful, and the experience consistent across roles?                        |
| 4     | **Presence of Bugs**            | Does the portal behave predictably under normal and edge-case inputs? Are there no broken flows, data inconsistencies, or unhandled errors?                    |
| 5     | **Good-to-Have Features**       | Has the team implemented any bonus features from Section 5? Depth and quality of implementation will be assessed.                                              |
| 6     | **Cost Optimisation**           | Is the solution architected efficiently? Evaluators will consider infrastructure choices, API call efficiency, caching strategies, and hosting cost awareness. |

# 7\. Constraints & Ground Rules

- Participants may use any technology stack of their choice (web frameworks, databases, cloud services)
- The portal must be accessible via a web browser - no desktop-only applications
- **A working demo with at least one complete user journey per role (Employee, Manager, Admin) must be presented**
- Code must be version-controlled and the repository link submitted before the deadline
- Participants must provide a brief architecture diagram explaining their technology and hosting choices

# 8\. Submission Deliverables

- Live / hosted demo URL of the portal
- Source code repository (GitHub / GitLab / Bitbucket)
- Architecture diagram (PDF or image)
- Login credentials of the 3 roles (Employee, Manager, Admin) or option to switch between user journeys
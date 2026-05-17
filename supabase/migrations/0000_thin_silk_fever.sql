CREATE TYPE "public"."escalation_level" AS ENUM('1', '2', '3');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('not_started', 'on_track', 'completed');--> statement-breakpoint
CREATE TYPE "public"."quarter" AS ENUM('Q1', 'Q2', 'Q3', 'Q4');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('employee', 'manager', 'admin');--> statement-breakpoint
CREATE TYPE "public"."sheet_status" AS ENUM('draft', 'submitted', 'returned', 'approved');--> statement-breakpoint
CREATE TYPE "public"."uom_type" AS ENUM('numeric_min', 'numeric_max', 'percent_min', 'percent_max', 'timeline', 'zero_based');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"goal_sheet_id" uuid,
	"action" varchar(100) NOT NULL,
	"field_changed" varchar(100),
	"old_value" text,
	"new_value" text,
	"reason" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_user_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_user_id" uuid NOT NULL,
	"teams_user_id" varchar(255) NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_user_links_teams_user_id_unique" UNIQUE("teams_user_id")
);
--> statement-breakpoint
CREATE TABLE "check_in_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"quarter" "quarter" NOT NULL,
	"window_open" date NOT NULL,
	"window_close" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"window_id" uuid NOT NULL,
	"actual_achievement" numeric(15, 4),
	"actual_date" date,
	"status" "goal_status" DEFAULT 'not_started' NOT NULL,
	"computed_score" numeric(6, 2),
	"weighted_score" numeric(6, 2),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"goal_window_start" date NOT NULL,
	"goal_window_end" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "escalation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" varchar(10) NOT NULL,
	"employee_id" uuid NOT NULL,
	"notified_user_id" uuid NOT NULL,
	"escalation_level" "escalation_level" NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" uuid,
	"resolve_note" text
);
--> statement-breakpoint
CREATE TABLE "goal_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"status" "sheet_status" DEFAULT 'draft' NOT NULL,
	"rework_note" text,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"approved_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_sheet_id" uuid NOT NULL,
	"thrust_area_id" uuid,
	"title" varchar(150) NOT NULL,
	"description" text,
	"uom_type" "uom_type" NOT NULL,
	"target" numeric(15, 4),
	"target_date" date,
	"weightage" numeric(5, 2) NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"shared_source_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"manager_id" uuid NOT NULL,
	"window_id" uuid NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thrust_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "thrust_areas_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" uuid,
	"email" varchar(255) NOT NULL,
	"name" varchar(150) NOT NULL,
	"role" "role" DEFAULT 'employee' NOT NULL,
	"department_id" uuid,
	"manager_id" uuid,
	"azure_oid" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_id_unique" UNIQUE("auth_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_goal_sheet_id_goal_sheets_id_fk" FOREIGN KEY ("goal_sheet_id") REFERENCES "public"."goal_sheets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_user_links" ADD CONSTRAINT "bot_user_links_portal_user_id_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_windows" ADD CONSTRAINT "check_in_windows_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_window_id_check_in_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."check_in_windows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_log" ADD CONSTRAINT "escalation_log_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_log" ADD CONSTRAINT "escalation_log_notified_user_id_users_id_fk" FOREIGN KEY ("notified_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_log" ADD CONSTRAINT "escalation_log_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_sheets" ADD CONSTRAINT "goal_sheets_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_sheets" ADD CONSTRAINT "goal_sheets_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_sheets" ADD CONSTRAINT "goal_sheets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_goal_sheet_id_goal_sheets_id_fk" FOREIGN KEY ("goal_sheet_id") REFERENCES "public"."goal_sheets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_thrust_area_id_thrust_areas_id_fk" FOREIGN KEY ("thrust_area_id") REFERENCES "public"."thrust_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_comments" ADD CONSTRAINT "manager_comments_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_comments" ADD CONSTRAINT "manager_comments_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_comments" ADD CONSTRAINT "manager_comments_window_id_check_in_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."check_in_windows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
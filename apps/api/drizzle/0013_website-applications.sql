-- Applications sent from the academy website, followed up by staff on the Requests page.
CREATE TYPE "public"."application_status" AS ENUM('NEW', 'CONTACTED', 'TRIAL_BOOKED', 'CONVERTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "application_status" DEFAULT 'NEW' NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"country" text,
	"timezone" text,
	"curriculum" text,
	"preferred_times" text,
	"student_age" text,
	"level" text,
	"message" text,
	"source" text,
	"utm" text,
	"notes" text,
	"student_id" uuid,
	"handled_at" timestamp with time zone,
	"handled_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status","created_at");
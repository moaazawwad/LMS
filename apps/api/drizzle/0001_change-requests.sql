CREATE TYPE "public"."request_kind" AS ENUM('CANCEL', 'RESCHEDULE');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('OPEN', 'APPROVED', 'DECLINED', 'WITHDRAWN');--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"kind" "request_kind" NOT NULL,
	"status" "request_status" DEFAULT 'OPEN' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"requester_kind" "actor_kind" NOT NULL,
	"message" text NOT NULL,
	"preferred_times" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"result_lesson_id" uuid
);
--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_result_lesson_id_lessons_id_fk" FOREIGN KEY ("result_lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_requests_status_idx" ON "change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "change_requests_requester_idx" ON "change_requests" USING btree ("requested_by_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "change_requests_one_open_idx" ON "change_requests" USING btree ("lesson_id") WHERE status = 'OPEN';
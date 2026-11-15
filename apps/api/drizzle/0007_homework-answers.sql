ALTER TABLE "lessons" ADD COLUMN "homework_answer" text;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "homework_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "homework_feedback" text;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "homework_checked_at" timestamp with time zone;
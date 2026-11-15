-- Payments (how each invoice was paid), lessons on hold for an unpaid invoice, the notification bell, and a fuller student file with staff notes.
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"dedup_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_dedup" UNIQUE("user_id","dedup_key")
);
--> statement-breakpoint
CREATE TABLE "student_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_note" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_by_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "guardian_name" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "guardian_relation" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "guardian_phone" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "guardian_email" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "native_language" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "other_languages" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "level" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "goals" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "joined_on" date;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "held_for_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "student_notes_student_idx" ON "student_notes" USING btree ("student_id","created_at");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_by_id_users_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_held_for_invoice_id_invoices_id_fk" FOREIGN KEY ("held_for_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
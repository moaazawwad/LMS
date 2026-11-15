-- Teacher profile: personal details, how they are paid (admins only), and staff notes.
CREATE TABLE "teacher_bank_details" (
	"teacher_id" uuid PRIMARY KEY NOT NULL,
	"method" text,
	"bank_name" text,
	"account_holder" text,
	"account_number" text,
	"iban" text,
	"instapay" text,
	"wallet" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "languages" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "education" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "experience_years" integer;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "joined_on" date;--> statement-breakpoint
ALTER TABLE "teacher_bank_details" ADD CONSTRAINT "teacher_bank_details_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_notes" ADD CONSTRAINT "teacher_notes_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_notes" ADD CONSTRAINT "teacher_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teacher_notes_teacher_idx" ON "teacher_notes" USING btree ("teacher_id","created_at");--> statement-breakpoint
-- Existing teachers joined when their account was made.
UPDATE "teachers" SET "joined_on" = (SELECT ("created_at" AT TIME ZONE 'Africa/Cairo')::date FROM "users" WHERE "users"."id" = "teachers"."user_id") WHERE "joined_on" IS NULL;

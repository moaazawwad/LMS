-- Students get an address and a country (separate from the time zone). Trial lessons: free, one-off.
ALTER TYPE "public"."lesson_type" ADD VALUE 'TRIAL';--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "country" text;
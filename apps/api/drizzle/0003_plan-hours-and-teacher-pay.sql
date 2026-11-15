-- Plans now say how many hours a cycle gives. Existing plans get the academy's hours by level.
ALTER TABLE "plans" ADD COLUMN "hours_per_cycle" integer;--> statement-breakpoint
UPDATE "plans" SET "hours_per_cycle" = CASE "tier" WHEN 'BASIC' THEN 4 WHEN 'STANDARD' THEN 8 ELSE 12 END;--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "hours_per_cycle" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "hourly_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "rate_currency" text DEFAULT 'EGP' NOT NULL;

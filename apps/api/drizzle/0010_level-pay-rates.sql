-- Pay per hour by teacher level. Teachers without their own rate get their level's rate.
CREATE TABLE "level_pay_rates" (
	"level" "tier" PRIMARY KEY NOT NULL,
	"hourly_rate_cents" integer NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "level_pay_rates" ADD CONSTRAINT "level_pay_rates_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
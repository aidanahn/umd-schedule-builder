CREATE TABLE "course_requirements" (
	"semester_code" text NOT NULL,
	"course_id" text NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "course_requirements_pk" PRIMARY KEY("semester_code","course_id","position"),
	CONSTRAINT "course_requirements_position_check" CHECK ("course_requirements"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"semester_code" text NOT NULL,
	"course_id" text NOT NULL,
	"department_code" text NOT NULL,
	"title" text NOT NULL,
	"credits_min" numeric(6, 2) NOT NULL,
	"credits_max" numeric(6, 2) NOT NULL,
	"grading_methods" text[] NOT NULL,
	"gen_ed_codes" text[] NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_ingestion_id" uuid NOT NULL,
	CONSTRAINT "courses_pk" PRIMARY KEY("semester_code","course_id"),
	CONSTRAINT "courses_credit_order_check" CHECK ("courses"."credits_min" >= 0 and "courses"."credits_max" >= "courses"."credits_min")
);
--> statement-breakpoint
CREATE TABLE "department_ingestion_heads" (
	"semester_code" text NOT NULL,
	"department_code" text NOT NULL,
	"latest_ingestion_id" uuid,
	"latest_collected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_ingestion_heads_pk" PRIMARY KEY("semester_code","department_code"),
	CONSTRAINT "department_ingestion_heads_latest_pair_check" CHECK (("department_ingestion_heads"."latest_ingestion_id" is null) = ("department_ingestion_heads"."latest_collected_at" is null))
);
--> statement-breakpoint
CREATE TABLE "department_ingestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"semester_code" text NOT NULL,
	"department_code" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"source_url" text NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_ingestions_snapshot_key" UNIQUE("semester_code","department_code","collected_at"),
	CONSTRAINT "department_ingestions_status_check" CHECK ("department_ingestions"."status" = 'complete')
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"code" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_check" CHECK ("departments"."code" ~ '^[A-Z]{4}$')
);
--> statement-breakpoint
CREATE TABLE "seat_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"semester_code" text NOT NULL,
	"department_code" text NOT NULL,
	"course_id" text NOT NULL,
	"section_id" text NOT NULL,
	"section_number" text NOT NULL,
	"event_type" text NOT NULL,
	"previous_ingestion_id" uuid NOT NULL,
	"current_ingestion_id" uuid NOT NULL,
	"previous_value" jsonb,
	"current_value" jsonb,
	"delta" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_events_current_section_type_key" UNIQUE("current_ingestion_id","section_id","event_type"),
	CONSTRAINT "seat_events_type_check" CHECK ("seat_events"."event_type" in ('SEATS_OPENED', 'SECTION_FILLED', 'OPEN_SEATS_CHANGED', 'TOTAL_SEATS_CHANGED', 'WAITLIST_CHANGED', 'HOLD_FILE_CHANGED', 'SECTION_ADDED', 'SECTION_REMOVED'))
);
--> statement-breakpoint
CREATE TABLE "seat_observations" (
	"ingestion_id" uuid NOT NULL,
	"semester_code" text NOT NULL,
	"section_id" text NOT NULL,
	"course_id" text NOT NULL,
	"total_seats" integer NOT NULL,
	"open_seats" integer NOT NULL,
	"waitlist_count" integer,
	"hold_file_count" integer,
	CONSTRAINT "seat_observations_pk" PRIMARY KEY("ingestion_id","semester_code","section_id"),
	CONSTRAINT "seat_observations_counts_check" CHECK ("seat_observations"."total_seats" >= 0 and "seat_observations"."open_seats" >= 0 and ("seat_observations"."waitlist_count" is null or "seat_observations"."waitlist_count" >= 0) and ("seat_observations"."hold_file_count" is null or "seat_observations"."hold_file_count" >= 0))
);
--> statement-breakpoint
CREATE TABLE "section_instructors" (
	"semester_code" text NOT NULL,
	"section_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "section_instructors_pk" PRIMARY KEY("semester_code","section_id","position"),
	CONSTRAINT "section_instructors_position_check" CHECK ("section_instructors"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "section_meetings" (
	"semester_code" text NOT NULL,
	"section_id" text NOT NULL,
	"position" integer NOT NULL,
	"days" text[] NOT NULL,
	"start_minutes" integer,
	"end_minutes" integer,
	"display_time" text,
	"building" text,
	"room" text,
	"meeting_type" text,
	CONSTRAINT "section_meetings_pk" PRIMARY KEY("semester_code","section_id","position"),
	CONSTRAINT "section_meetings_position_check" CHECK ("section_meetings"."position" >= 0),
	CONSTRAINT "section_meetings_time_pair_check" CHECK (("section_meetings"."start_minutes" is null) = ("section_meetings"."end_minutes" is null)),
	CONSTRAINT "section_meetings_time_range_check" CHECK ("section_meetings"."start_minutes" between 0 and 1439 and "section_meetings"."end_minutes" between "section_meetings"."start_minutes" and 1439)
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"semester_code" text NOT NULL,
	"section_id" text NOT NULL,
	"course_id" text NOT NULL,
	"section_number" text NOT NULL,
	"delivery_mode" text NOT NULL,
	"notes" text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_ingestion_id" uuid NOT NULL,
	CONSTRAINT "sections_pk" PRIMARY KEY("semester_code","section_id"),
	CONSTRAINT "sections_delivery_mode_check" CHECK ("sections"."delivery_mode" in ('face-to-face', 'blended', 'online', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "semesters" (
	"code" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semesters_code_check" CHECK ("semesters"."code" ~ '^[0-9]{6}$')
);
--> statement-breakpoint
ALTER TABLE "course_requirements" ADD CONSTRAINT "course_requirements_course_fk" FOREIGN KEY ("semester_code","course_id") REFERENCES "public"."courses"("semester_code","course_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_semester_code_semesters_code_fk" FOREIGN KEY ("semester_code") REFERENCES "public"."semesters"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_department_code_departments_code_fk" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_last_seen_ingestion_id_department_ingestions_id_fk" FOREIGN KEY ("last_seen_ingestion_id") REFERENCES "public"."department_ingestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_ingestion_heads" ADD CONSTRAINT "department_ingestion_heads_semester_code_semesters_code_fk" FOREIGN KEY ("semester_code") REFERENCES "public"."semesters"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_ingestion_heads" ADD CONSTRAINT "department_ingestion_heads_department_code_departments_code_fk" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_ingestion_heads" ADD CONSTRAINT "department_ingestion_heads_latest_ingestion_id_department_ingestions_id_fk" FOREIGN KEY ("latest_ingestion_id") REFERENCES "public"."department_ingestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_ingestions" ADD CONSTRAINT "department_ingestions_semester_code_semesters_code_fk" FOREIGN KEY ("semester_code") REFERENCES "public"."semesters"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_ingestions" ADD CONSTRAINT "department_ingestions_department_code_departments_code_fk" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_events" ADD CONSTRAINT "seat_events_semester_code_semesters_code_fk" FOREIGN KEY ("semester_code") REFERENCES "public"."semesters"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_events" ADD CONSTRAINT "seat_events_department_code_departments_code_fk" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_events" ADD CONSTRAINT "seat_events_previous_ingestion_id_department_ingestions_id_fk" FOREIGN KEY ("previous_ingestion_id") REFERENCES "public"."department_ingestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_events" ADD CONSTRAINT "seat_events_current_ingestion_id_department_ingestions_id_fk" FOREIGN KEY ("current_ingestion_id") REFERENCES "public"."department_ingestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_events" ADD CONSTRAINT "seat_events_section_fk" FOREIGN KEY ("semester_code","section_id") REFERENCES "public"."sections"("semester_code","section_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_events" ADD CONSTRAINT "seat_events_course_fk" FOREIGN KEY ("semester_code","course_id") REFERENCES "public"."courses"("semester_code","course_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_observations" ADD CONSTRAINT "seat_observations_ingestion_id_department_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."department_ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_observations" ADD CONSTRAINT "seat_observations_section_fk" FOREIGN KEY ("semester_code","section_id") REFERENCES "public"."sections"("semester_code","section_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_observations" ADD CONSTRAINT "seat_observations_course_fk" FOREIGN KEY ("semester_code","course_id") REFERENCES "public"."courses"("semester_code","course_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_instructors" ADD CONSTRAINT "section_instructors_section_fk" FOREIGN KEY ("semester_code","section_id") REFERENCES "public"."sections"("semester_code","section_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_meetings" ADD CONSTRAINT "section_meetings_section_fk" FOREIGN KEY ("semester_code","section_id") REFERENCES "public"."sections"("semester_code","section_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_last_seen_ingestion_id_department_ingestions_id_fk" FOREIGN KEY ("last_seen_ingestion_id") REFERENCES "public"."department_ingestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_course_fk" FOREIGN KEY ("semester_code","course_id") REFERENCES "public"."courses"("semester_code","course_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courses_active_department_idx" ON "courses" USING btree ("semester_code","department_code","is_active");--> statement-breakpoint
CREATE INDEX "courses_course_id_idx" ON "courses" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "department_ingestions_department_collected_idx" ON "department_ingestions" USING btree ("semester_code","department_code","collected_at");--> statement-breakpoint
CREATE INDEX "seat_events_section_created_idx" ON "seat_events" USING btree ("semester_code","section_id","created_at");--> statement-breakpoint
CREATE INDEX "seat_events_type_created_idx" ON "seat_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "seat_events_current_ingestion_idx" ON "seat_events" USING btree ("current_ingestion_id");--> statement-breakpoint
CREATE INDEX "seat_observations_section_history_idx" ON "seat_observations" USING btree ("semester_code","section_id","ingestion_id");--> statement-breakpoint
CREATE INDEX "sections_active_course_idx" ON "sections" USING btree ("semester_code","course_id","is_active");--> statement-breakpoint
CREATE INDEX "sections_section_id_idx" ON "sections" USING btree ("section_id");
CREATE TABLE "registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"display_name" text,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" jsonb NOT NULL,
	"transport" jsonb NOT NULL,
	"env" jsonb DEFAULT '{}' NOT NULL,
	"env_meta" jsonb DEFAULT '{}' NOT NULL,
	"idle_timeout_ms" integer,
	"call_timeout_ms" integer,
	"oauth" jsonb,
	"discovered" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"port" integer DEFAULT 3000 NOT NULL,
	"auth_token" text,
	"auth_enabled" boolean DEFAULT true NOT NULL,
	"host" text,
	"allowed_origins" jsonb DEFAULT '[]' NOT NULL,
	"idle_timeout_ms" integer DEFAULT 300000 NOT NULL,
	"session_idle_timeout_ms" integer DEFAULT 1800000 NOT NULL,
	"max_sessions" integer DEFAULT 1000 NOT NULL,
	"connect_timeout_ms" integer DEFAULT 60000 NOT NULL,
	"call_timeout_ms" integer DEFAULT 600000 NOT NULL,
	"public_url" text,
	"instance_id" text,
	"lan_advertise" boolean DEFAULT false NOT NULL,
	"lan_discovery" boolean DEFAULT true NOT NULL,
	"lan_dismissed" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_settings_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"env" jsonb,
	"args" jsonb,
	"headers" jsonb,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_registries_name" ON "registries" ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_servers_name" ON "servers" ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspace_members_workspace_id_server_id" ON "workspace_members" ("workspace_id","server_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_members_server_id" ON "workspace_members" ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspaces_slug" ON "workspaces" ("slug");--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_server_id_servers_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE;
CREATE TABLE "workspace_contact_usage" (
  "workspace_id" UUID NOT NULL,
  "month" DATE NOT NULL,
  "contact_id" VARCHAR(24) NOT NULL,
  CONSTRAINT "workspace_contact_usage_pkey" PRIMARY KEY ("workspace_id", "month", "contact_id"),
  CONSTRAINT "workspace_contact_usage_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_contact_usage_contact_check" CHECK ("contact_id" ~ '^[0-9a-f]{24}$'),
  CONSTRAINT "workspace_contact_usage_month_check" CHECK (EXTRACT(DAY FROM "month") = 1)
);

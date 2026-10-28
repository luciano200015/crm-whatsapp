-- Funnels ("Embudos"): Kanban boards of leads per WhatsApp line, their
-- stages, who sees which stage, the status → stage automation rules and the
-- board preferences of each member. The leads live in MongoDB. Additive only.

-- CreateTable
CREATE TABLE "funnels" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300) NOT NULL DEFAULT '',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "archive_after_days" INTEGER,
    "sync_rules" JSONB NOT NULL DEFAULT '[]',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "funnels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_stages" (
    "id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "funnel_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_stage_access" (
    "funnel_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,

    CONSTRAINT "funnel_stage_access_pkey" PRIMARY KEY ("funnel_id","membership_id","stage_id")
);

-- CreateTable
CREATE TABLE "funnel_automation_rules" (
    "id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "funnel_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_board_preferences" (
    "user_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "show_value" BOOLEAN NOT NULL DEFAULT false,
    "show_agent" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "funnel_board_preferences_pkey" PRIMARY KEY ("user_id","funnel_id")
);

-- CreateIndex
CREATE INDEX "funnels_workspace_id_idx" ON "funnels"("workspace_id");

-- CreateIndex
CREATE INDEX "funnels_line_id_idx" ON "funnels"("line_id");

-- CreateIndex
CREATE UNIQUE INDEX "funnels_line_primary_key" ON "funnels"("line_id") WHERE ("is_primary" = true);

-- CreateIndex
CREATE INDEX "funnel_stages_funnel_id_position_idx" ON "funnel_stages"("funnel_id", "position");

-- CreateIndex
CREATE INDEX "funnel_stage_access_membership_id_idx" ON "funnel_stage_access"("membership_id");

-- CreateIndex
CREATE INDEX "funnel_stage_access_stage_id_idx" ON "funnel_stage_access"("stage_id");

-- CreateIndex
CREATE INDEX "funnel_automation_rules_funnel_id_idx" ON "funnel_automation_rules"("funnel_id");

-- CreateIndex
CREATE INDEX "funnel_automation_rules_stage_id_idx" ON "funnel_automation_rules"("stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "funnel_automation_rules_line_id_status_key" ON "funnel_automation_rules"("line_id", "status");

-- AddForeignKey
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "channel_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_stages" ADD CONSTRAINT "funnel_stages_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_stage_access" ADD CONSTRAINT "funnel_stage_access_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_stage_access" ADD CONSTRAINT "funnel_stage_access_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "workspace_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_stage_access" ADD CONSTRAINT "funnel_stage_access_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "funnel_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_automation_rules" ADD CONSTRAINT "funnel_automation_rules_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "channel_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_automation_rules" ADD CONSTRAINT "funnel_automation_rules_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_automation_rules" ADD CONSTRAINT "funnel_automation_rules_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "funnel_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_board_preferences" ADD CONSTRAINT "funnel_board_preferences_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules map a conversation status; auto-archive between 1 and 365 days.
ALTER TABLE "funnel_automation_rules" ADD CONSTRAINT "funnel_automation_rules_status_check" CHECK ("status" IN ('OPEN', 'ON_HOLD', 'CLOSED'));

ALTER TABLE "funnels" ADD CONSTRAINT "funnels_archive_after_days_check" CHECK ("archive_after_days" IS NULL OR "archive_after_days" BETWEEN 1 AND 365);

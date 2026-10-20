-- CreateEnum
CREATE TYPE "ChannelProvider" AS ENUM ('WHATSAPP_CLOUD');

-- CreateEnum
CREATE TYPE "LineStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISABLED');

-- CreateTable
CREATE TABLE "channel_lines" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "provider" "ChannelProvider" NOT NULL DEFAULT 'WHATSAPP_CLOUD',
    "phone_number_id" VARCHAR(32) NOT NULL,
    "waba_id" VARCHAR(32),
    "display_phone" VARCHAR(32),
    "verified_name" VARCHAR(120),
    "access_token_enc" TEXT NOT NULL,
    "access_token_last4" VARCHAR(4) NOT NULL,
    "app_secret_enc" TEXT NOT NULL,
    "webhook_verify_token" VARCHAR(64) NOT NULL,
    "status" "LineStatus" NOT NULL DEFAULT 'PENDING',
    "last_error" VARCHAR(500),
    "last_webhook_at" TIMESTAMPTZ(3),
    "auto_assign" BOOLEAN NOT NULL DEFAULT false,
    "last_assigned_membership_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channel_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_line_agents" (
    "line_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_line_agents_pkey" PRIMARY KEY ("line_id","membership_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_lines_phone_number_id_key" ON "channel_lines"("phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_lines_webhook_verify_token_key" ON "channel_lines"("webhook_verify_token");

-- CreateIndex
CREATE INDEX "channel_lines_workspace_id_idx" ON "channel_lines"("workspace_id");

-- CreateIndex
CREATE INDEX "channel_line_agents_membership_id_idx" ON "channel_line_agents"("membership_id");

-- AddForeignKey
ALTER TABLE "channel_lines" ADD CONSTRAINT "channel_lines_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_line_agents" ADD CONSTRAINT "channel_line_agents_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "channel_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_line_agents" ADD CONSTRAINT "channel_line_agents_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "workspace_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Hand-written constraints (not expressible in schema.prisma) ───
-- Meta ids are numeric strings.
ALTER TABLE "channel_lines" ADD CONSTRAINT "channel_lines_phone_number_id_check" CHECK ("phone_number_id" ~ '^[0-9]{5,32}$');
ALTER TABLE "channel_lines" ADD CONSTRAINT "channel_lines_waba_id_check" CHECK ("waba_id" IS NULL OR "waba_id" ~ '^[0-9]{5,32}$');

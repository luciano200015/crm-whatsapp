-- Chatbots: a flow (nodes and edges of the editor) that answers the
-- customers of the lines pointing to it. One chatbot per line.
CREATE TABLE "chatbots" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "graph" JSONB NOT NULL,
    "schedule" JSONB,
    "restart_after_minutes" INTEGER NOT NULL DEFAULT 60,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chatbots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chatbots_workspace_id_idx" ON "chatbots"("workspace_id");

ALTER TABLE "chatbots" ADD CONSTRAINT "chatbots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The chatbot of each line (null: none).
ALTER TABLE "channel_lines" ADD COLUMN "chatbot_id" UUID;

CREATE INDEX "channel_lines_chatbot_id_idx" ON "channel_lines"("chatbot_id");

ALTER TABLE "channel_lines" ADD CONSTRAINT "channel_lines_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

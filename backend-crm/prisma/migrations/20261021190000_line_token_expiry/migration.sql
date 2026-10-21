-- When the WhatsApp access token expires (read from Meta by the connection test).
ALTER TABLE "channel_lines" ADD COLUMN "access_token_expires_at" TIMESTAMPTZ(3);

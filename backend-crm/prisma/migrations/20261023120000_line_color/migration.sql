-- Color of the line: frames its chats in the inbox (null: the default WhatsApp green).
ALTER TABLE "channel_lines" ADD COLUMN "color" VARCHAR(7);

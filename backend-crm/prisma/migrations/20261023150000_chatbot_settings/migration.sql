-- General settings of a chatbot (wasapi's "Configuración del Chatbot") and
-- its own variables. Only new columns; existing bots keep working as before.
ALTER TABLE "chatbots" ADD COLUMN "description" VARCHAR(300) NOT NULL DEFAULT '';
-- Sent when the customer writes something the flow does not expect.
ALTER TABLE "chatbots" ADD COLUMN "fallback_text" VARCHAR(1024) NOT NULL DEFAULT 'Mensaje inválido. Por favor escoge una de las opciones.';
-- Words that send the customer back to the greeting ("menu").
ALTER TABLE "chatbots" ADD COLUMN "restart_keywords" TEXT[] NOT NULL DEFAULT ARRAY['menu']::TEXT[];
-- Minutes without an answer before the inactivity message (null: never).
ALTER TABLE "chatbots" ADD COLUMN "inactivity_minutes" INTEGER;
ALTER TABLE "chatbots" ADD COLUMN "inactivity_text" VARCHAR(1024) NOT NULL DEFAULT 'Parece que te detuviste un momento. ¿Quieres que avancemos?';
-- [{ name, type: text | number | boolean, defaultValue, description }]
ALTER TABLE "chatbots" ADD COLUMN "variables" JSONB NOT NULL DEFAULT '[]';
-- New chatbots restart an idle conversation after 30 minutes, like wasapi.
ALTER TABLE "chatbots" ALTER COLUMN "restart_after_minutes" SET DEFAULT 30;

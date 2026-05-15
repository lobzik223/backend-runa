ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "has_image_attachment" BOOLEAN NOT NULL DEFAULT false;

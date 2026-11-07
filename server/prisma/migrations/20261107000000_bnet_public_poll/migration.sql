-- S-20: public profile readings (docs/02 « Fiche publique », « Sources et rythme des relevés »).

-- CreateTable
CREATE TABLE "bnet_public_poll" (
    "character_id" BIGINT NOT NULL,
    "last_modified" TEXT,
    "last_login_at" TIMESTAMPTZ(6),
    "changed_at" TIMESTAMPTZ(6),
    "next_poll_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bnet_public_poll_pkey" PRIMARY KEY ("character_id")
);

-- CreateIndex
CREATE INDEX "bnet_public_poll_next_poll_at_idx" ON "bnet_public_poll"("next_poll_at");

-- AddForeignKey
ALTER TABLE "bnet_public_poll" ADD CONSTRAINT "bnet_public_poll_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

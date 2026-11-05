-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "guild_config" (
    "guild_id" TEXT NOT NULL,
    "board_channel_id" TEXT,
    "board_message_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logs_channel_id" TEXT,
    "level_announce_step" INTEGER NOT NULL DEFAULT 1,
    "log_deaths" BOOLEAN NOT NULL DEFAULT false,
    "board_sort" TEXT NOT NULL DEFAULT 'level',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_config_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "player" (
    "discord_user_id" TEXT NOT NULL,
    "hide_money" BOOLEAN NOT NULL DEFAULT false,
    "hide_zone" BOOLEAN NOT NULL DEFAULT false,
    "hide_presence" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_pkey" PRIMARY KEY ("discord_user_id")
);

-- CreateTable
CREATE TABLE "membership" (
    "guild_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("guild_id","discord_user_id")
);

-- CreateTable
CREATE TABLE "character" (
    "id" BIGSERIAL NOT NULL,
    "region" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "guid" TEXT,
    "realm_name" TEXT,
    "ruleset" TEXT,
    "class_file" TEXT,
    "race_file" TEXT,
    "faction" TEXT,
    "owner_id" TEXT,
    "role" TEXT,
    "bnet_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_snapshot_id" BIGINT,

    CONSTRAINT "character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "token_sha256" TEXT NOT NULL,
    "name" TEXT,
    "app_version" TEXT,
    "os" TEXT,
    "last_seen_at" TIMESTAMPTZ(6),
    "game_running" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_code" (
    "code_sha256" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "pairing_code_pkey" PRIMARY KEY ("code_sha256")
);

-- CreateTable
CREATE TABLE "snapshot" (
    "id" BIGSERIAL NOT NULL,
    "character_id" BIGINT NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "level" INTEGER NOT NULL,
    "xp" INTEGER,
    "xp_max" INTEGER,
    "money" BIGINT,
    "played_total" INTEGER,
    "zone" TEXT,
    "sub_zone" TEXT,
    "detail" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'app',
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_session" (
    "id" BIGSERIAL NOT NULL,
    "owner_id" TEXT NOT NULL,
    "character_id" BIGINT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" TEXT,
    "level_start" INTEGER,
    "level_end" INTEGER,
    "money_start" BIGINT,
    "money_end" BIGINT,
    "played_start" INTEGER,
    "played_end" INTEGER,

    CONSTRAINT "game_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_event" (
    "id" BIGSERIAL NOT NULL,
    "character_id" BIGINT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "data" JSONB NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "game_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bnet_token" (
    "owner_id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "token_encrypted" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bnet_token_pkey" PRIMARY KEY ("owner_id")
);

-- CreateTable
CREATE TABLE "oauth_state" (
    "state_sha256" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "guild_id" TEXT,
    "region" TEXT NOT NULL,
    "interaction_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "oauth_state_pkey" PRIMARY KEY ("state_sha256")
);

-- CreateIndex
CREATE UNIQUE INDEX "character_one_main_per_owner" ON "character"("owner_id") WHERE (role = 'main');

-- CreateIndex
CREATE UNIQUE INDEX "character_one_alt_per_owner" ON "character"("owner_id") WHERE (role = 'alt');

-- CreateIndex
CREATE UNIQUE INDEX "device_token_sha256_key" ON "device"("token_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "game_event_character_id_event_id_key" ON "game_event"("character_id", "event_id");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_config"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "player"("discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character" ADD CONSTRAINT "character_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "player"("discord_user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "player"("discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_code" ADD CONSTRAINT "pairing_code_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "player"("discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "player"("discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_event" ADD CONSTRAINT "game_event_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bnet_token" ADD CONSTRAINT "bnet_token_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "player"("discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_state" ADD CONSTRAINT "oauth_state_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "player"("discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Raw SQL: constraints Prisma schema language cannot express (keep in sync with
-- the header comment of prisma/schema.prisma).
-- ---------------------------------------------------------------------------

-- A character is identified by its region and case-insensitive names.
CREATE UNIQUE INDEX "character_identity_key" ON "character" ("region", lower("first_name"), lower("surname"));

-- Allowed roles; NULL is allowed for characters never assigned.
ALTER TABLE "character" ADD CONSTRAINT "character_role_check" CHECK ("role" IN ('main', 'alt', 'untracked'));

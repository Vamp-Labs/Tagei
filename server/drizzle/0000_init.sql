CREATE TABLE "oracle_proofs" (
	"hash" text PRIMARY KEY NOT NULL,
	"sec" bigint NOT NULL,
	"proof" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"first_seen_ms" bigint NOT NULL,
	"source" text NOT NULL,
	"referenced" boolean DEFAULT false NOT NULL,
	"recorded_tx" text
);
--> statement-breakpoint
CREATE TABLE "oracle_rounds" (
	"pair_id" integer NOT NULL,
	"sec" bigint NOT NULL,
	"round_ms" bigint NOT NULL,
	"ts_ms" bigint NOT NULL,
	"price18" numeric(78, 0) NOT NULL,
	"proof_hash" text NOT NULL,
	"received_at_ms" bigint NOT NULL,
	CONSTRAINT "oracle_rounds_pair_id_sec_pk" PRIMARY KEY("pair_id","sec")
);
--> statement-breakpoint
CREATE TABLE "relayer_txs" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"selector" text NOT NULL,
	"data_hash" text NOT NULL,
	"data" text,
	"priority" integer NOT NULL,
	"round_id" numeric(78, 0),
	"intent_id" text,
	"status" text NOT NULL,
	"nonce" bigint,
	"gas_limit" bigint,
	"gas_price_wei" numeric(78, 0),
	"tx_hash" text,
	"tx_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"block_number" bigint,
	"gas_used" bigint,
	"error" text,
	"error_code" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"submitted_at_ms" bigint,
	"confirmed_at_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "lane_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" smallint NOT NULL,
	"tier" smallint NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer,
	"sigma_recent_ppm" double precision NOT NULL,
	"sigma_base_ppm" double precision NOT NULL,
	"samples" integer NOT NULL,
	"k" double precision NOT NULL,
	"k_prev" double precision NOT NULL,
	"target_ppm_before" integer NOT NULL,
	"stop_ppm_before" integer NOT NULL,
	"target_ppm_after" integer NOT NULL,
	"stop_ppm_after" integer NOT NULL,
	"gap_margin_ppm" integer NOT NULL,
	"status" text NOT NULL,
	"tx_id" text,
	"tx_hash" text,
	"error" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"round_id" numeric(78, 0) PRIMARY KEY NOT NULL,
	"player" text NOT NULL,
	"asset_id" smallint NOT NULL,
	"pair_id" integer NOT NULL,
	"tier" smallint NOT NULL,
	"direction" smallint NOT NULL,
	"stake" numeric(78, 0) NOT NULL,
	"max_payout" numeric(78, 0) NOT NULL,
	"entry_sec" bigint NOT NULL,
	"end_sec" bigint NOT NULL,
	"exit_sec" bigint,
	"lane_version" integer NOT NULL,
	"oracle_idx" smallint NOT NULL,
	"target_ppm" integer NOT NULL,
	"stop_ppm" integer NOT NULL,
	"multiplier_bps" integer NOT NULL,
	"fee_bps" integer NOT NULL,
	"max_jump_ppm" integer NOT NULL,
	"cash_out_requested" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"outcome" smallint,
	"void_reason" smallint,
	"payout" numeric(78, 0),
	"pnl" numeric(78, 0),
	"entry_price" numeric(78, 0),
	"exit_price" numeric(78, 0),
	"decision_sec" bigint,
	"open_tx" text NOT NULL,
	"open_block" bigint NOT NULL,
	"open_log_index" integer NOT NULL,
	"cash_out_tx" text,
	"settle_tx" text,
	"settle_block" bigint,
	"opened_at_ms" bigint NOT NULL,
	"settled_at_ms" bigint,
	"settle_finalized" boolean DEFAULT false NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_blocks" (
	"number" bigint PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"parent_hash" text NOT NULL,
	"timestamp_sec" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"address" text NOT NULL,
	"name" text NOT NULL,
	"args" jsonb NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"created_at_ms" bigint NOT NULL,
	CONSTRAINT "chain_events_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"id" text PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"finalized_block" bigint,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"salt" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"address" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_session_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "player_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faucet_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"player" text NOT NULL,
	"ip_hash" text,
	"amount" numeric(78, 0) NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"tx_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debrief_reviews" (
	"player" text NOT NULL,
	"round_id" numeric(78, 0) NOT NULL,
	"reviewed_at_ms" bigint NOT NULL,
	"credited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "debrief_reviews_player_round_id_pk" PRIMARY KEY("player","round_id")
);
--> statement-breakpoint
CREATE TABLE "player_badges" (
	"player" text NOT NULL,
	"badge_id" text NOT NULL,
	"round_id" numeric(78, 0),
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_badges_player_badge_id_pk" PRIMARY KEY("player","badge_id")
);
--> statement-breakpoint
CREATE TABLE "player_days" (
	"player" text NOT NULL,
	"day" text NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"directions" integer DEFAULT 0 NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"missions_completed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "player_days_player_day_pk" PRIMARY KEY("player","day")
);
--> statement-breakpoint
CREATE TABLE "player_progress" (
	"player" text PRIMARY KEY NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"streak_days" integer DEFAULT 0 NOT NULL,
	"last_active_day" text,
	"rounds" integer DEFAULT 0 NOT NULL,
	"target_hits" integer DEFAULT 0 NOT NULL,
	"disciplined_exits" integer DEFAULT 0 NOT NULL,
	"best_payout_x_bps" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progression_rounds" (
	"round_id" numeric(78, 0) PRIMARY KEY NOT NULL,
	"player" text NOT NULL,
	"asset_id" integer NOT NULL,
	"tier" integer NOT NULL,
	"direction" text NOT NULL,
	"outcome" text NOT NULL,
	"stake" numeric(78, 0) NOT NULL,
	"payout" numeric(78, 0) NOT NULL,
	"payout_x_bps" integer NOT NULL,
	"disciplined" boolean NOT NULL,
	"day" text NOT NULL,
	"day_index" integer DEFAULT 0 NOT NULL,
	"settled_at_ms" bigint NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"round" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player" text NOT NULL,
	"round_id" numeric(78, 0) DEFAULT '0' NOT NULL,
	"reason" text NOT NULL,
	"amount" integer NOT NULL,
	"day" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"player" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pix_chat_quota" (
	"player" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pix_chat_quota_player_day_pk" PRIMARY KEY("player","day")
);
--> statement-breakpoint
CREATE TABLE "pix_debriefs" (
	"round_id" numeric(78, 0) PRIMARY KEY NOT NULL,
	"player" text NOT NULL,
	"debrief" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "oracle_proofs_sec_idx" ON "oracle_proofs" USING btree ("sec");--> statement-breakpoint
CREATE INDEX "oracle_proofs_prune_idx" ON "oracle_proofs" USING btree ("referenced","first_seen_ms");--> statement-breakpoint
CREATE INDEX "oracle_rounds_sec_idx" ON "oracle_rounds" USING btree ("sec");--> statement-breakpoint
CREATE INDEX "relayer_txs_key_status_idx" ON "relayer_txs" USING btree ("key","status");--> statement-breakpoint
CREATE INDEX "relayer_txs_round_idx" ON "relayer_txs" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "relayer_txs_intent_idx" ON "relayer_txs" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "relayer_txs_created_idx" ON "relayer_txs" USING btree ("created_at_ms");--> statement-breakpoint
CREATE INDEX "lane_changes_asset_tier_idx" ON "lane_changes" USING btree ("asset_id","tier","created_at_ms");--> statement-breakpoint
CREATE INDEX "rounds_player_opened_idx" ON "rounds" USING btree ("player","opened_at_ms");--> statement-breakpoint
CREATE INDEX "rounds_status_idx" ON "rounds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rounds_open_block_idx" ON "rounds" USING btree ("open_block");--> statement-breakpoint
CREATE INDEX "chain_events_block_idx" ON "chain_events" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "chain_events_name_idx" ON "chain_events" USING btree ("name","block_number");--> statement-breakpoint
CREATE INDEX "chain_events_unfinalized_idx" ON "chain_events" USING btree ("finalized","block_number");--> statement-breakpoint
CREATE INDEX "auth_challenges_expires_idx" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "player_events_player_id_idx" ON "player_events" USING btree ("player","id");--> statement-breakpoint
CREATE INDEX "player_events_created_idx" ON "player_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "faucet_claims_player_idx" ON "faucet_claims" USING btree ("player","created_at");--> statement-breakpoint
CREATE INDEX "faucet_claims_ip_idx" ON "faucet_claims" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "faucet_claims_created_idx" ON "faucet_claims" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "player_progress_xp_idx" ON "player_progress" USING btree ("xp");--> statement-breakpoint
CREATE INDEX "progression_rounds_player_idx" ON "progression_rounds" USING btree ("player","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_ledger_player_round_reason_uq" ON "xp_ledger" USING btree ("player","round_id","reason");--> statement-breakpoint
CREATE INDEX "xp_ledger_day_idx" ON "xp_ledger" USING btree ("day");--> statement-breakpoint
CREATE INDEX "xp_ledger_player_idx" ON "xp_ledger" USING btree ("player");--> statement-breakpoint
CREATE INDEX "llm_usage_day_idx" ON "llm_usage" USING btree ("day");
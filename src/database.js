import { Pool } from "pg";
import { config } from "./config.js";

let pool = null;

function getPool() {
  if (!config.databaseUrl) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes("railway.app")
        ? {
            rejectUnauthorized: false
          }
        : undefined
    });
  }

  return pool;
}

export function isDatabaseConfigured() {
  return Boolean(config.databaseUrl);
}

export async function initializeDatabase() {
  const currentPool = getPool();
  if (!currentPool) {
    return false;
  }

  await currentPool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await currentPool.query(`
    CREATE TABLE IF NOT EXISTS podcast_episodes (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      episode_kind TEXT NOT NULL,
      renderer TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      memory TEXT NOT NULL,
      transcript TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  return true;
}

export async function loadAppState(key) {
  const currentPool = getPool();
  if (!currentPool) {
    return null;
  }

  const result = await currentPool.query(
    "SELECT value FROM app_state WHERE key = $1",
    [key]
  );

  return result.rows[0]?.value ?? null;
}

export async function saveAppState(key, value) {
  const currentPool = getPool();
  if (!currentPool) {
    return false;
  }

  await currentPool.query(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [key, JSON.stringify(value)]
  );

  return true;
}

export async function savePodcastEpisode({
  guildId,
  episodeKind,
  renderer,
  title,
  summary,
  memory,
  transcript
}) {
  const currentPool = getPool();
  if (!currentPool) {
    return false;
  }

  await currentPool.query(
    `
      INSERT INTO podcast_episodes (
        guild_id,
        episode_kind,
        renderer,
        title,
        summary,
        memory,
        transcript
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [guildId, episodeKind, renderer, title, summary, memory, transcript]
  );

  return true;
}

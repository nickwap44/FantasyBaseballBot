import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve("data");
const guildConfigPath = path.join(dataDir, "guild-config.json");
const reminderStatePath = path.join(dataDir, "reminder-state.json");
const fantasyStatePath = path.join(dataDir, "fantasy-state.json");
const mediaRegistryPath = path.join(dataDir, "media-registry.json");

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function writeJson(filePath, value) {
  await ensureDataDir();
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function getGuildConfigs() {
  return readJson(guildConfigPath, {});
}

export async function getGuildConfig(guildId) {
  const configs = await getGuildConfigs();
  return configs[guildId] || null;
}

export async function saveGuildConfig(guildId, config) {
  const configs = await getGuildConfigs();
  configs[guildId] = config;
  await writeJson(guildConfigPath, configs);
  return config;
}

export async function getReminderState() {
  return readJson(reminderStatePath, {});
}

export async function markReminderSent(guildId, gameKey) {
  const state = await getReminderState();
  state[guildId] = {
    ...(state[guildId] || {}),
    [gameKey]: new Date().toISOString()
  };
  await writeJson(reminderStatePath, state);
}

export async function wasReminderSent(guildId, gameKey) {
  const state = await getReminderState();
  return Boolean(state[guildId]?.[gameKey]);
}

export async function getFantasyState() {
  return readJson(fantasyStatePath, {});
}

export async function saveFantasyState(nextState) {
  await writeJson(fantasyStatePath, nextState);
  return nextState;
}

export async function updateFantasyState(updater) {
  const current = await getFantasyState();
  const next = await updater(current);
  await saveFantasyState(next);
  return next;
}

export async function getMediaRegistry() {
  return readJson(mediaRegistryPath, {});
}

export async function saveMediaRegistry(nextRegistry) {
  await writeJson(mediaRegistryPath, nextRegistry);
  return nextRegistry;
}

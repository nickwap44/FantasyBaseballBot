import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppState, saveAppState } from "./database.js";

const dataDir = path.resolve("data");
const guildConfigPath = path.join(dataDir, "guild-config.json");
const reminderStatePath = path.join(dataDir, "reminder-state.json");
const fantasyStatePath = path.join(dataDir, "fantasy-state.json");
const mediaRegistryPath = path.join(dataDir, "media-registry.json");
const reporterStatePath = path.join(dataDir, "reporter-state.json");
const mailbagStatePath = path.join(dataDir, "mailbag-state.json");

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

async function readState(key, filePath, fallback) {
  const dbValue = await loadAppState(key);
  if (dbValue !== null) {
    return dbValue;
  }

  return readJson(filePath, fallback);
}

async function writeJson(filePath, value) {
  await ensureDataDir();
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeState(key, filePath, value) {
  const savedToDb = await saveAppState(key, value);
  if (!savedToDb) {
    await writeJson(filePath, value);
  }
}

export async function getGuildConfigs() {
  return readState("guild-config", guildConfigPath, {});
}

export async function getGuildConfig(guildId) {
  const configs = await getGuildConfigs();
  return configs[guildId] || null;
}

export async function saveGuildConfig(guildId, config) {
  const configs = await getGuildConfigs();
  configs[guildId] = config;
  await writeState("guild-config", guildConfigPath, configs);
  return config;
}

export async function getReminderState() {
  return readState("reminder-state", reminderStatePath, {});
}

export async function markReminderSent(guildId, gameKey) {
  const state = await getReminderState();
  state[guildId] = {
    ...(state[guildId] || {}),
    [gameKey]: new Date().toISOString()
  };
  await writeState("reminder-state", reminderStatePath, state);
}

export async function wasReminderSent(guildId, gameKey) {
  const state = await getReminderState();
  return Boolean(state[guildId]?.[gameKey]);
}

export async function getFantasyState() {
  return readState("fantasy-state", fantasyStatePath, {});
}

export async function saveFantasyState(nextState) {
  await writeState("fantasy-state", fantasyStatePath, nextState);
  return nextState;
}

export async function updateFantasyState(updater) {
  const current = await getFantasyState();
  const next = await updater(current);
  await saveFantasyState(next);
  return next;
}

export async function getMediaRegistry() {
  return readState("media-registry", mediaRegistryPath, {});
}

export async function saveMediaRegistry(nextRegistry) {
  await writeState("media-registry", mediaRegistryPath, nextRegistry);
  return nextRegistry;
}

export async function getReporterState() {
  return readState("reporter-state", reporterStatePath, {});
}

export async function saveReporterState(nextState) {
  await writeState("reporter-state", reporterStatePath, nextState);
  return nextState;
}

export async function getMailbagState() {
  return readState("mailbag-state", mailbagStatePath, {});
}

export async function saveMailbagState(nextState) {
  await writeState("mailbag-state", mailbagStatePath, nextState);
  return nextState;
}

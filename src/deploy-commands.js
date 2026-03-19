import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commands.js";
import { config } from "./config.js";

const rest = new REST({ version: "10" }).setToken(config.discordToken);

async function main() {
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    {
      body: commandDefinitions.map((command) => command.toJSON())
    }
  );

  console.log(`Registered ${commandDefinitions.length} guild commands.`);
}

main().catch((error) => {
  console.error("Failed to deploy commands:", error);
  process.exitCode = 1;
});

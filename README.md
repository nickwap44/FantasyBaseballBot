# Fantasy Baseball Discord Reminder Bot

This bot connects to a Discord server and posts a reminder one hour before the first MLB game of the day so your league can set lineups in time.

## What it does

- Connects to Discord with a bot token
- Registers slash commands for server setup
- Stores reminder settings per guild in local JSON files
- Checks the official MLB schedule and posts one reminder one hour before first pitch

## Requirements

- Node.js 20 or newer
- A Discord application with a bot user
- Permission to invite the bot to your server with `bot` and `applications.commands` scopes

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`.
3. Optionally set `DEFAULT_REMINDER_CHANNEL_ID` so a fresh deploy already knows where to post.
4. Install dependencies with `npm install`.
5. Register slash commands with `npm run deploy-commands`.
6. Start the bot with `npm start`.

## Discord setup

After the bot joins your server, run these slash commands:

- `/reminder-channel` to choose the text channel for reminders
- `/reminder-role` to pick a role to mention, or clear the role mention
- `/reminder-toggle` to enable or disable reminders
- `/reminder-timezone` to choose the display timezone
- `/reminder-message` to customize the intro text
- `/reminder-status` to confirm the current setup

## Notes

- The bot checks the MLB Stats API for the next scheduled game.
- By default it reminds one hour before the earliest upcoming game across MLB.
- Reminder state is stored in `data/guild-config.json` and `data/reminder-state.json`.
- On hosts with ephemeral disks, set `DEFAULT_REMINDER_CHANNEL_ID` so the reminder channel is restored automatically after redeploys.
- If the bot was offline during the reminder window, it will not backfill the missed reminder.

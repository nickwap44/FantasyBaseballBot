# Fantasy League Discord Bot

This bot connects to a Discord server and can:

- post MLB lineup reminders
- pull data from a private ESPN fantasy baseball league
- generate daily transaction summaries
- post weekly power rankings
- post social-style league reactions
- generate a weekly AI podcast transcript plus MP3 upload

## What it does

- Connects to Discord with a bot token
- Registers slash commands for server setup
- Stores reminder settings per guild in local JSON files
- Checks the official MLB schedule and posts one reminder one hour before first pitch
- Connects to ESPN private fantasy football leagues using `ESPN_SWID` and `ESPN_S2`
- Uses OpenAI to generate text content and a weekly podcast MP3

## Requirements

- Node.js 20 or newer
- A Discord application with a bot user
- Permission to invite the bot to your server with `bot` and `applications.commands` scopes
- An OpenAI API key for the fantasy content features
- ESPN fantasy league cookies for private leagues

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in the Discord values.
3. Add the ESPN and OpenAI values if you want the fantasy baseball features.
4. Optionally set the default channel IDs so a fresh deploy already knows where to post.
5. Install dependencies with `npm install`.
6. Register slash commands with `npm run deploy-commands`.
7. Start the bot with `npm start`.

## Discord setup

After the bot joins your server, run these slash commands:

- `/reminder-channel` to choose the text channel for reminders
- `/reminder-role` to pick a role to mention, or clear the role mention
- `/reminder-toggle` to enable or disable reminders
- `/reminder-timezone` to choose the display timezone
- `/reminder-message` to customize the intro text
- `/reminder-status` to confirm the current setup
- `/fantasy-channel` to assign the transactions, power, social, or podcast channels
- `/fantasy-status` to confirm the fantasy feature setup
- `/fantasy-test` to run an ESPN check or generate sample content

## Notes

- The bot checks the MLB Stats API for the next scheduled game.
- By default it reminds one hour before the earliest upcoming game across MLB.
- Reminder state is stored in `data/guild-config.json` and `data/reminder-state.json`.
- On hosts with ephemeral disks, set `DEFAULT_REMINDER_CHANNEL_ID` so the reminder channel is restored automatically after redeploys.
- Fantasy job state is stored in `data/fantasy-state.json`.
- The weekly fantasy podcast uses AI-generated voices and should be disclosed as AI-generated audio.
- `PODCAST_RENDERER` defaults to `tts`; set it to `realtime` only if you explicitly want the more conversational renderer.
- Drop reference transcripts into `data/podcast-style-transcripts` and the podcast generator will derive a style profile from them for format and host-role pacing.
- Or import Happy Scribe transcript pages with `npm run import-podcast-style -- --url https://podcasts.happyscribe.com/fantasy-footballers-fantasy-football-podcast --limit 6`.
- If direct fetch is blocked, copy transcript page text into local files and clean/import them with `npm run import-podcast-style -- --input C:\path\to\copied-transcripts`.
- Happy Scribe imports are usually unlabeled by speaker, so they improve show energy and segment cadence more than one-to-one host-role behavior.
- Set `ESPN_SPORT=baseball` for ESPN fantasy baseball leagues.
- If the bot was offline during the reminder window, it will not backfill the missed reminder.

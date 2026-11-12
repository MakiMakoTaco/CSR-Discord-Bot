import { Client } from 'discord.js';

export const client = new Client({
	intents: ['Guilds', 'GuildMembers', 'GuildMessages', 'MessageContent'],
});

// Dev bot
// client.token = process.env.DEV_DISCORD_TOKEN ?? null;

export default client;

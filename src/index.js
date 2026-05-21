import { connect } from './discord.js';
import { startServer } from './server.js';
import { startPoller } from './poller.js';

// Start bot
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error("❌ Missing DISCORD_BOT_TOKEN in environment variables.");
  console.error("Please add it to your .env file or environment.");
  process.exit(1);
}

console.log("Connecting to Discord...");
await connect(token);

// Start HTTP Server
const PORT = process.env.PORT || 3535;
startServer(PORT);
startPoller();

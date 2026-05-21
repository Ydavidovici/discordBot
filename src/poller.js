import { sendMessage } from './discord.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function buildServices() {
  return [
    {
      name: 'Chess Engine',
      url: `${process.env.CHESS_ENGINE_URL || 'http://localhost:8000'}/api/health`,
    },
    {
      name: 'DSS Auth',
      url: `${process.env.DSS_AUTH_URL || 'http://localhost:4000'}/healthz`,
    },
    {
      name: 'DSS DB',
      url: `${process.env.DSS_DB_URL || 'http://localhost:4001'}/healthz`,
    },
  ];
}

// Tracks last known state per service name to avoid repeat alerts
const lastState = new Map();

async function checkService(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function pollOnce() {
  const alertChannelId = process.env.HEALTH_ALERT_CHANNEL_ID;
  if (!alertChannelId) return;

  await Promise.all(buildServices().map(async svc => {
    const healthy = await checkService(svc.url);
    const prev = lastState.get(svc.name);

    if (prev === undefined) {
      // First run — set baseline without alerting
      lastState.set(svc.name, healthy);
      return;
    }

    if (prev === healthy) return; // No change

    lastState.set(svc.name, healthy);

    const msg = healthy
      ? `✅ **${svc.name}** is back online.`
      : `🚨 **${svc.name}** is DOWN or unreachable! Check logs immediately.`;

    await sendMessage(alertChannelId, msg).catch(err =>
      console.error('[Poller] Failed to send alert:', err)
    );
  }));
}

export function startPoller() {
  if (!process.env.HEALTH_ALERT_CHANNEL_ID) {
    console.log('[Poller] HEALTH_ALERT_CHANNEL_ID not set — health polling disabled.');
    return;
  }
  console.log('[Poller] Health monitor starting (first check in 30s, then every 5 min)...');
  setTimeout(() => {
    pollOnce();
    setInterval(pollOnce, POLL_INTERVAL_MS);
  }, 30_000);
}

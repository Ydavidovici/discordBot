import {sendMessage} from './discord.js';
import {readFileSync} from 'fs';
import {join} from 'path';

/**
 * Handles incoming HTTP requests
 */
function handleRequest(req) {
    return new Promise(async (resolve, reject) => {
        try {
            const url = new URL(req.url);

            // Handle POST /notify
            if (req.method === 'POST' && url.pathname === '/notify') {
                const authHeader = req.headers.get('authorization');

                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return resolve(new Response('Missing or invalid Authorization header. Use "Bearer <your_api_key>"', {status: 401}));
                }

                const apiKey = authHeader.split(' ')[1];

                // Read consumers.json dynamically so you don't have to restart the bot when adding keys!
                let consumers = {};
                try {
                    const consumersData = readFileSync(join(process.cwd(), 'consumers.json'), 'utf-8');
                    consumers = JSON.parse(consumersData);
                } catch (err) {
                    console.warn('[Server] Could not read consumers.json. Make sure the file exists.');
                }

                const consumer = consumers[apiKey];

                if (!consumer) {
                    return resolve(new Response('Invalid API Key.', {status: 403}));
                }

                let body;
                try {
                    body = await req.json();
                } catch (err) {
                    return resolve(new Response('Invalid JSON body', {status: 400}));
                }

                // 'channel' lets the consumer pick which endpoint to hit (e.g., 'logs' or 'notifications')
                const {project, message, status, channel} = body;

                if (!message) {
                    return resolve(new Response('Missing message in body', {status: 400}));
                }

                // Default to 'notifications' if they don't specify
                const channelType = channel || 'notifications';
                const targetChannelId = consumer.channels && consumer.channels[channelType];

                if (!targetChannelId) {
                    return resolve(new Response(`Consumer is not configured for channel type: '${channelType}'. Make sure it is in consumers.json`, {status: 400}));
                }

                // Format message
                let formattedMessage = message;
                
                // Discord enforces a strict 2000 character limit per message
                if (formattedMessage.length > 2000) {
                    formattedMessage = formattedMessage.substring(0, 1997) + '...';
                }

                // Send via Discord
                const success = await sendMessage(targetChannelId, formattedMessage);

                if (success) {
                    return resolve(new Response('Notification sent', {status: 200}));
                } else {
                    return resolve(new Response('Failed to send notification via Discord', {status: 500}));
                }
            }

            // 404 Not Found
            return resolve(new Response('Not Found', {status: 404}));
        } catch (error) {
            console.error('[Server] Request error:', error);
            return resolve(new Response('Internal Server Error', {status: 500}));
        }
    });
}

/**
 * Starts the Bun server
 * @param {number} port
 */
function startServer(port = 3000) {
    const server = Bun.serve({
        port: port,
        fetch(req) {
            return handleRequest(req);
        },
    });
    console.log(`[Server] Listening on http://localhost:${server.port}`);
    return server;
}

export {startServer, handleRequest};

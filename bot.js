const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const registeredServers = {};
const webSocketClients = {};

bot.once('ready', () => {
    console.log(`🤖 Bot connecté en tant que ${bot.user.tag}`);
});


// ========== EXPRESS + WEBSOCKET CONFIGURATION ==========
const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));

const baseUrl = process.env.BASE_URL || 'localhost';
const port = process.env.PORT || 80;
const useSecureWs = process.env.USE_SECURE_WS === 'true';
const hideWebViewPort = process.env.HIDE_WEBVIEW_PORT === 'true';
const hideWebsocketPort = process.env.HIDE_WS_PORT === 'true';

// Routes
app.get('/view/:channelId', (req, res) => {
    const channelId = req.params.channelId;
    res.render('index', {
        channelId,
        useSecureWs,
        baseUrl,
        wsPort: port,
        hideWebsocketPort,
    });
});

// HTTP + WebSocket setup
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const channelId = params.get('channelId');

    if (!webSocketClients[channelId]) {
        webSocketClients[channelId] = [];
    }

    webSocketClients[channelId].push(ws);

    console.log(`🔌 Client WebSocket connecté à : ${channelId}`);

    ws.on('close', () => {
        webSocketClients[channelId] = webSocketClients[channelId].filter(client => client !== ws);
        console.log(`❌ Client WebSocket déconnecté de : ${channelId}`);
    });
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
    });
});

server.listen(port, () => {
    console.log(`🌐 Serveur web démarré sur http://${baseUrl}${port === 80 ? '' : ':' + port}`);
});

// ========== DISCORD BOT LISTENERS ==========
bot.on('messageCreate', (message) => {
    if (message.author.bot) return;

    const guildId = message.guild.id;
    const channelId = message.channel.id;

    if (!registeredServers[guildId]) registeredServers[guildId] = {};
    const serverData = registeredServers[guildId];

    if (message.content.startsWith('!register')) {
        serverData[channelId] = { messages: [] };
        message.channel.send(`✅ Channel **${message.channel.name}** enregistré.`);
    }

    if (message.content.startsWith('!tell')) {
        if (!serverData[channelId]) return message.channel.send("⚠️ Channel non enregistré. Utilise `!register`.");

        const newMessage = {
            username: message.author.username,
            avatar: message.author.displayAvatarURL(),
            content: message.content.split(' ').slice(1).join(' '),
            attachments: [...message.attachments.values()].map(att => ({
                url: att.url,
                type: att.contentType,
            })),
        };

        serverData[channelId].messages.push(newMessage);

        if (webSocketClients[channelId]) {
            webSocketClients[channelId].forEach(ws => ws.send(JSON.stringify(newMessage)));
        }

        message.react('✅');
    }

    if (message.content.startsWith('!stell')) {
        if (!serverData[channelId]) return message.channel.send("⚠️ Channel non enregistré. Utilise `!register`.");

        const newMessage = {
            username: null,
            avatar: 'https://example.com/anonymous-avatar.png',
            content: message.content.split(' ').slice(1).join(' '),
            attachments: [...message.attachments.values()].map(att => ({
                url: att.url,
                type: att.contentType,
            })),
        };

        serverData[channelId].messages.push(newMessage);

        if (webSocketClients[channelId]) {
            webSocketClients[channelId].forEach(ws => ws.send(JSON.stringify(newMessage)));
        }

        message.channel.send('✅ Message anonyme ajouté.');
    }

    if (message.content.startsWith('!url')) {
        const protocol = useSecureWs ? 'https' : 'http';
        const botLink = `${protocol}://${baseUrl}${(port === 80 || hideWebViewPort) ? '' : `:${port}`}`;
        const url = `${botLink}/view/${channelId}`;
        message.channel.send(`🔗 URL pour **${message.channel.name}** : ${url}`);
    }

    if (message.content.startsWith('!help')) {
        message.channel.send(`
**Commandes disponibles :**
\`!register\` — Enregistrer le channel
\`!tell <message>\` — Envoyer un message identifié
\`!stell <message>\` — Envoyer un message anonyme
\`!url\` — Obtenir l'URL de visualisation
\`!help\` — Affiche cette aide
        `);
    }
});

// === Connexion du bot ===
bot.login(process.env.BOT_TOKEN);
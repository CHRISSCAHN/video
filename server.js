import { WebSocketServer } from 'ws';
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files from the dist directory in production, or root in development
const staticPath = process.env.NODE_ENV === 'production' ? join(__dirname, 'dist') : __dirname;
app.use(express.static(staticPath));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Store connected clients with their IDs
const rooms = new Map();
const clients = new Map();

wss.on('connection', (ws) => {
    const userId = randomUUID();
    clients.set(ws, userId);

    console.log(`Client connected: ${userId}`);

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        data.userId = userId;
        
        switch (data.type) {
            case 'join':
                handleJoin(ws, data);
                break;
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                handleRelay(ws, data);
                break;
        }
    });

    ws.on('close', () => {
        const userId = clients.get(ws);
        console.log(`Client disconnected: ${userId}`);
        
        clients.delete(ws);

        // Notify other participants about user leaving
        rooms.forEach((clients, roomId) => {
            if (clients.has(ws)) {
                clients.delete(ws);
                notifyPeers(clients, {
                    type: 'user-left',
                    userId: userId,
                    roomId: roomId
                });

                if (clients.size === 0) {
                    rooms.delete(roomId);
                }
            }
        });
    });
});

function handleJoin(ws, data) {
    const roomId = data.roomId;
    const userId = data.userId;

    console.log(`User ${userId} joining room ${roomId}`);

    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);

    // Notify existing participants about the new user
    room.forEach(client => {
        client.send(JSON.stringify({
            type: 'user-joined',
            userId: userId,
            roomId: roomId
        }));

        // Notify the new user about existing participants
        ws.send(JSON.stringify({
            type: 'user-joined',
            userId: clients.get(client),
            roomId: roomId
        }));
    });

    room.add(ws);
}

function handleRelay(ws, data) {
    const room = rooms.get(data.roomId);
    if (room) {
        room.forEach(client => {
            if (client !== ws && (!data.userId || clients.get(client) === data.userId)) {
                client.send(JSON.stringify(data));
            }
        });
    }
}

function notifyPeers(peers, data) {
    peers.forEach(peer => {
        peer.send(JSON.stringify(data));
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
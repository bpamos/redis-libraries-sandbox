import { createServer } from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import pkg from 'ioredis';
const { createClient } = pkg;

// Redis Cloud connection
const pubClient = createClient({
    host: 'redis-17322.us-east-1.ec2.redns.redis-cloud.com',
    port: 17322,
    password: 'password',
    tls: false
  });
const subClient = pubClient.duplicate();

// App setup
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Adapter
io.adapter(createAdapter(pubClient, subClient));

// Logging
console.log(`[Server ${process.env.PORT}] Redis adapter initialized`);
pubClient.on('error', (err) => {
  console.error(`[Server ${process.env.PORT}] pubClient error:`, err);
});
subClient.on('error', (err) => {
  console.error(`[Server ${process.env.PORT}] subClient error:`, err);
});

app.use(express.static('./'));

io.on('connection', (socket) => {
  console.log(`[Server ${process.env.PORT}] Client connected`);

  socket.on('message', (msg) => {
    console.log(`[Server ${process.env.PORT}] received:`, msg);
    io.emit('message', msg);
  });
});

// Emit a message every 5s to test broadcast
setInterval(() => {
  io.emit('message', `[Server ${process.env.PORT}] broadcast test`);
}, 5000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});

import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import app from './app';
import { config } from './config';
import { connectDB, disconnectDB, prisma } from './config/database';

const httpServer = createServer(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new SocketIO(httpServer, {
  cors: {
    origin: config.frontendUrl,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Track online users: userId → socketId
const onlineUsers = new Map<string, string>();

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join', (userId: string) => {
    onlineUsers.set(userId, socket.id);
    socket.join(`user:${userId}`);
    console.log(`User ${userId} joined`);
  });

  socket.on('send_message', async (data: {
    receiverId: string;
    content: string;
    senderId: string;
    jobId?: string;
    contractId?: string;
  }) => {
    try {
      const message = await prisma.message.create({
        data: {
          senderId: data.senderId,
          receiverId: data.receiverId,
          content: data.content,
          jobId: data.jobId || null,
          contractId: data.contractId || null,
        },
        include: {
          sender: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
        },
      });

      // Emit to receiver if online
      io.to(`user:${data.receiverId}`).emit('new_message', message);
      // Confirm to sender
      socket.emit('message_sent', message);
    } catch (err) {
      socket.emit('message_error', { error: 'Failed to send message' });
    }
  });

  socket.on('typing', (data: { receiverId: string; senderId: string; isTyping: boolean }) => {
    io.to(`user:${data.receiverId}`).emit('typing', {
      senderId: data.senderId,
      isTyping: data.isTyping,
    });
  });

  socket.on('disconnect', () => {
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        break;
      }
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  console.log(`[startup] NODE_ENV=${config.nodeEnv} PORT=${config.port}`);
  console.log(`[startup] DATABASE_URL set: ${!!process.env.DATABASE_URL}`);

  await connectDB();

  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`\n🚀 Biddaro API running on port ${config.port}`);
    console.log(`   ENV:      ${config.nodeEnv}`);
    console.log(`   API:      http://localhost:${config.port}/api/v1`);
    console.log(`   Health:   http://localhost:${config.port}/health\n`);
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  httpServer.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  httpServer.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
});

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

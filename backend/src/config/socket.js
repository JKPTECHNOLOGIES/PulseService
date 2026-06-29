const { Server } = require('socket.io');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on('join_dispatch', () => {
      socket.join('dispatch');
      console.log(`[Socket] ${socket.id} joined dispatch room`);
    });

    socket.on('join_technician', ({ technicianId }) => {
      socket.join(`tech_${technicianId}`);
    });

    socket.on('leave_dispatch', () => {
      socket.leave('dispatch');
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io has not been initialized. Call initSocket first.');
  }
  return io;
};

const emitDispatchUpdate = (event, data) => {
  if (io) {
    io.to('dispatch').emit(event, data);
  }
};

module.exports = { initSocket, getIO, emitDispatchUpdate };

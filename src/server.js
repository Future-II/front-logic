const dotenv = require('dotenv');
dotenv.config();
const mongoose = require('mongoose');
const app = require('./app');
const http = require('http');
const { Server } = require('socket.io');
const { setSocketIO, sendCommand, activeTasks } = require('./presentation/controllers/halfReport.controller');
const Company = require('./infrastructure/models/company.model');

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: 20000,      // Reduced from 25s to 20s
  pingTimeout: 10000,       // Increased from 5s to 10s for better tolerance
  connectTimeout: 30000,    // Added connection timeout
  maxHttpBufferSize: 1e6,
  transports: ['websocket', 'polling'] // Explicit transport order
});

setSocketIO(io);

const activeSessions = new Map();
const userSessions = new Map();

// Enhanced cleanup function with better error handling
async function performCleanupByUserId(userId) {
  try {
    console.log(`[BROWSER CLEANUP] Closing browser for user: ${userId}`);
    
    // Clean up active sessions for this user FIRST
    const sessionsToDelete = [];
    for (const [reportId, session] of activeSessions.entries()) {
      if (session.userId === userId) {
        sessionsToDelete.push(reportId);
      }
    }
    
    // Delete sessions outside the loop to avoid modification during iteration
    sessionsToDelete.forEach(reportId => {
      activeSessions.delete(reportId);
      console.log(`[SESSION CLEANUP] Removed session for report ${reportId}`);
    });
    
    // Then close the browser
    await sendCommand({ action: "close", userId });
    
    // Remove user from tracking
    userSessions.delete(userId);
    
    console.log(`[CLEANUP COMPLETE] User ${userId} fully cleaned up`);
  } catch (error) {
    console.error(`[CLEANUP ERROR] Failed to cleanup for user ${userId}:`, error);
    // Even if cleanup fails, remove from tracking to prevent memory leaks
    userSessions.delete(userId);
  }
}

// Helper function to cancel user cleanup
function cancelUserCleanup(userId) {
  const userSession = userSessions.get(userId);
  if (userSession && userSession.cleanupTimeout) {
    clearTimeout(userSession.cleanupTimeout);
    userSessions.delete(userId);
    console.log(`[CLEANUP CANCELLED] User ${userId} reconnected successfully`);
    return true;
  }
  return false;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id, 'at', new Date().toISOString());

  // Enhanced user identification with validation
  socket.on('user_identified', (userId) => {
    if (!userId || typeof userId !== 'string') {
      console.warn(`[INVALID USER ID] Socket ${socket.id} provided invalid userId:`, userId);
      return;
    }
    
    socket.userId = userId;
    console.log(`Socket ${socket.id} identified as user ${userId}`);
    
    // Cancel pending cleanup for this user
    if (cancelUserCleanup(userId)) {
      // Rejoin any active rooms for this user
      for (const [reportId, session] of activeSessions.entries()) {
        if (session.userId === userId) {
          socket.join(`report_${reportId}`);
          console.log(`[REJOINED] User ${userId} rejoined report room ${reportId}`);
        }
      }
    }
  });

  // Existing event handlers (keep your current implementation)
  socket.on('join_ticket', (ticketId) => {
    socket.join(ticketId);
    console.log(`User ${socket.id} joined ticket ${ticketId}`);
  });

  socket.on('join_tickets', (ticketIds) => {
    if (!Array.isArray(ticketIds)) {
      console.warn(`[INVALID TICKETS] Socket ${socket.id} provided non-array ticketIds`);
      return;
    }
    ticketIds.forEach(ticketId => {
      socket.join(ticketId);
    });
    console.log(`User ${socket.id} joined tickets: ${ticketIds.join(', ')}`);
  });

  socket.on('send_message', (data) => {
    console.log('send_message received:', data);
    io.to(data.ticketId).emit('receive_message', {
      ...data.message,
      ticketId: data.ticketId
    });
    console.log('Emitted receive_message to room:', data.ticketId);
  });

  // Enhanced start_form_fill with better user tracking
  socket.on('start_form_fill', async (data) => {
    const { reportId, tabsNum, actionType = 'submit', userId } = data;
    console.log(`[SOCKET] start_form_fill: reportId=${reportId}, tabsNum=${tabsNum}, action=${actionType}, user=${userId}`);

    try {
      // Validate required fields
      if (!reportId) {
        throw new Error('reportId is required');
      }

      socket.join(`report_${reportId}`);
      
      // Store userId on socket if provided
      if (userId && !socket.userId) {
        socket.userId = userId;
      }

      const controlState = {
        paused: false,
        stopped: false,
        reportId,
        actionType
      };

      activeSessions.set(reportId, {
        socket,
        controlState,
        startedAt: new Date(),
        actionType,
        userId: socket.userId
      });

      socket.emit('form_fill_started', {
        reportId,
        status: 'STARTED',
        actionType
      });

      let response;

      switch (actionType) {
        case 'submit':
          response = await sendCommand({
            action: "formFill2",
            reportId,
            tabsNum: tabsNum || 3,
            socketMode: true,
            userId: socket.userId
          });
          break;

        case 'retry':
          response = await sendCommand({
            action: "retryMacros",
            recordId: reportId,
            tabsNum: tabsNum || 3,
            socketMode: true,
            userId: socket.userId
          });
          break;

        case 'check':
          response = await sendCommand({
            action: "checkMacros",
            reportId,
            tabsNum: tabsNum || 3,
            socketMode: true,
            userId: socket.userId
          });
          break;

        default:
          throw new Error(`Unknown action type: ${actionType}`);
      }

      console.log(`[SOCKET] ${actionType} response:`, response);

      if (response.status === 'SUCCESS') {
        io.to(`report_${reportId}`).emit('form_fill_complete', {
          reportId,
          status: 'SUCCESS',
          actionType,
          results: response.results || response.result,
          message: `${actionType} completed successfully`,
          timestamp: new Date().toISOString()
        });
      } else {
        io.to(`report_${reportId}`).emit('form_fill_error', {
          reportId,
          status: 'FAILED',
          actionType,
          error: response.error || 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }

      activeSessions.delete(reportId);

    } catch (error) {
      console.error(`[SOCKET ERROR] start_form_fill:`, error);
      socket.emit('form_fill_error', {
        reportId,
        status: 'FAILED',
        actionType,
        error: error.message
      });
      activeSessions.delete(reportId);
    }
  });

  // Keep your existing pause_form_fill, resume_form_fill, stop_form_fill handlers...
  // Add these to your socket event handlers in server.js
socket.on('pause_form_fill', async (data) => {
    const { reportId } = data;
    console.log(`[SOCKET] pause_form_fill received for report: ${reportId}`);
    
    try {
        // Call the pause controller
        const response = await require('./presentation/controllers/halfReport.controller').pause({ body: { id: reportId } }, { 
            json: (result) => {
                console.log(`[SOCKET] Pause successful for report ${reportId}:`, result);
                socket.emit('pause_form_fill_ack', { reportId, status: 'PAUSED' });
            }
        }, (error) => {
            console.error(`[SOCKET] Pause error for report ${reportId}:`, error);
            socket.emit('pause_form_fill_error', { reportId, error: error.message });
        });
    } catch (error) {
        console.error(`[SOCKET] Pause failed for report ${reportId}:`, error);
        socket.emit('pause_form_fill_error', { reportId, error: error.message });
    }
});

socket.on('resume_form_fill', async (data) => {
    const { reportId } = data;
    console.log(`[SOCKET] resume_form_fill received for report: ${reportId}`);
    
    try {
        // Call the resume controller
        const response = await require('./presentation/controllers/halfReport.controller').resume({ body: { id: reportId } }, { 
            json: (result) => {
                console.log(`[SOCKET] Resume successful for report ${reportId}:`, result);
                socket.emit('resume_form_fill_ack', { reportId, status: 'RESUMED' });
            }
        }, (error) => {
            console.error(`[SOCKET] Resume error for report ${reportId}:`, error);
            socket.emit('resume_form_fill_error', { reportId, error: error.message });
        });
    } catch (error) {
        console.error(`[SOCKET] Resume failed for report ${reportId}:`, error);
        socket.emit('resume_form_fill_error', { reportId, error: error.message });
    }
});

socket.on('stop_form_fill', async (data) => {
    const { reportId } = data;
    console.log(`[SOCKET] stop_form_fill received for report: ${reportId}`);
    
    try {
        // Call the stop controller
        const response = await require('./presentation/controllers/halfReport.controller').stop({ body: { id: reportId } }, { 
            json: (result) => {
                console.log(`[SOCKET] Stop successful for report ${reportId}:`, result);
                socket.emit('stop_form_fill_ack', { reportId, status: 'STOPPED' });
            }
        }, (error) => {
            console.error(`[SOCKET] Stop error for report ${reportId}:`, error);
            socket.emit('stop_form_fill_error', { reportId, error: error.message });
        });
    } catch (error) {
        console.error(`[SOCKET] Stop failed for report ${reportId}:`, error);
        socket.emit('stop_form_fill_error', { reportId, error: error.message });
    }
});

  socket.on('get_active_sessions', () => {
    const sessions = Array.from(activeSessions.entries()).map(([reportId, session]) => ({
      reportId,
      startedAt: session.startedAt,
      paused: session.controlState.paused,
      stopped: session.controlState.stopped,
      actionType: session.actionType,
      userId: session.userId
    }));
    socket.emit('active_sessions', sessions);
  });

  // Enhanced disconnect handler - FIXED VERSION
  socket.on('disconnect', async (reason) => {
    console.log(`User ${socket.id} (user: ${socket.userId}) disconnected. Reason: ${reason} at ${new Date().toISOString()}`);
    
    const isIntentionalDisconnect = reason === 'io client disconnect' || reason === 'io server disconnect';
    
    // Immediate cleanup only for truly intentional disconnects
    if (isIntentionalDisconnect) {
      console.log(`[IMMEDIATE CLEANUP] Intentional disconnect for ${socket.id}`);
      if (socket.userId) {
        await performCleanupByUserId(socket.userId);
      }
      return;
    }
    
    // For temporary disconnections (transport close, ping timeout), use delayed cleanup
    if (socket.userId) {
      console.log(`[DELAYED CLEANUP] User ${socket.userId} disconnected (${reason}). Waiting 25 seconds...`);
      
      const timeoutId = setTimeout(async () => {
        console.log(`[CLEANUP] No reconnection for user ${socket.userId}, performing cleanup`);
        await performCleanupByUserId(socket.userId);
      }, 25000); // Increased to 25 seconds
      
      userSessions.set(socket.userId, { 
        cleanupTimeout: timeoutId,
        disconnectedAt: new Date(),
        lastSocketId: socket.id 
      });
    }
    // REMOVED anonymous socket cleanup - this was causing your issue
  });

  // Add connection error handling
  socket.on('error', (error) => {
    console.error(`[SOCKET ERROR] Socket ${socket.id} error:`, error);
  });
});

// Enhanced MongoDB connection with better error handling
async function initializeServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');
    
    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 Socket.IO configured with pingInterval: 20s, pingTimeout: 10s`);
    });
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  
  for (const userId of userSessions.keys()) {
    const userSession = userSessions.get(userId);
    if (userSession && userSession.cleanupTimeout) {
      clearTimeout(userSession.cleanupTimeout);
    }
    await performCleanupByUserId(userId);
  }
  
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});

initializeServer();

module.exports = { io, activeSessions, userSessions };
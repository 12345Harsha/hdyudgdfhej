require('dotenv').config();
const WebSocket = require('ws');
const { StreamAction } = require('piopiy');

console.log('🚀 WebSocket relay server starting...');

// Configuration from environment variables
const VAPI_WS_URL = process.env.VAPI_WS_URL || 'wss://hdyudgdfhej-6.onrender.com';
const SERVER_PORT = 8766;

let telecmiSocket = null;
let vapiSocket = null;

// Create WebSocket server
const server = new WebSocket.Server({ port: SERVER_PORT });

server.on('connection', (ws) => {
  console.log('✅ TeleCMI connected');
  telecmiSocket = ws;

  // Echo any message received from the client
  ws.on('message', (msg) => {
    if (typeof msg === 'string' || msg.toString().startsWith('Hello')) {
      // Echo text messages for testing
      ws.send(`Echo: ${msg.toString()}`);
      console.log('🔁 Echoing back:', msg.toString());
    } else if (vapiSocket && vapiSocket.readyState === WebSocket.OPEN) {
      // Relay binary/audio to Vapi
      vapiSocket.send(msg);
      console.log('📤 Audio sent to Vapi');
    } else {
      console.warn('⚠️ Vapi socket not available');
    }
  });

  // Connect to Vapi WebSocket
  vapiSocket = new WebSocket(VAPI_WS_URL);

  // Vapi WebSocket event handlers
  vapiSocket.on('open', () => {
    console.log('🟢 Connected to Vapi');
  });

  vapiSocket.on('message', (msg) => {
    console.log('📥 Received from Vapi');

    const stream = new StreamAction();

    try {
      // Send received audio from Vapi to TeleCMI
      const payload = stream.playStream(msg, 'raw', 8000);

      if (telecmiSocket && telecmiSocket.readyState === WebSocket.OPEN) {
        telecmiSocket.send(payload);
        console.log('📤 Audio sent to TeleCMI');
      } else {
        console.warn('⚠️ TeleCMI socket not available');
      }
    } catch (streamErr) {
      console.error('❌ Error creating stream payload:', streamErr);
    }
  });

  vapiSocket.on('error', (err) => {
    console.error('❌ Vapi WebSocket error:', err);
  });

  vapiSocket.on('close', (code, reason) => {
    console.log(`❌ Vapi WebSocket closed - Code: ${code}, Reason: ${reason}`);
  });

  // TeleCMI WebSocket event handlers
  ws.on('message', (msg) => {
    if (typeof msg === 'string' || msg.toString().startsWith('Hello')) {
      // Echo text messages for testing
      ws.send(`Echo: ${msg.toString()}`);
      console.log('🔁 Echoing back:', msg.toString());
    } else if (vapiSocket && vapiSocket.readyState === WebSocket.OPEN) {
      // Relay binary/audio to Vapi
      vapiSocket.send(msg);
      console.log('📤 Audio sent to Vapi');
    } else {
      console.warn('⚠️ Vapi socket not available');
    }
  });

  ws.on('error', (err) => {
    console.error('❌ TeleCMI WebSocket error:', err);
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 TeleCMI disconnected - Code: ${code}, Reason: ${reason}`);

    if (vapiSocket && vapiSocket.readyState === WebSocket.OPEN) {
      vapiSocket.close();
    }

    telecmiSocket = null;
    vapiSocket = null;
  });
});

// Server error handling
server.on('error', (err) => {
  console.error('❌ WebSocket server error:', err);
});

let shuttingDown = false;

process.on('SIGINT', () => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\n🛑 Shutting down server...');

  if (telecmiSocket) telecmiSocket.close();
  if (vapiSocket) vapiSocket.close();

  server.close(() => {
    console.log('✅ Server shut down gracefully');
  });
});

console.log(`🚀 WebSocket relay server listening on ws://0.0.0.0:${SERVER_PORT}`);
console.log('🔗 Bridging TeleCMI ↔ Vapi audio streams');
console.log('⏳ Waiting for TeleCMI connection...');
console.log('Press Ctrl+C to stop the server');

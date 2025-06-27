require('dotenv').config();
require('dotenv').config();
const WebSocket = require('ws');
const { StreamAction } = require('piopiy');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

console.log('🚀 WebSocket relay server starting...');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const SERVER_PORT = process.env.PORT || 8766;

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error('❌ Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in .env');
  process.exit(1);
}

let telecmiSocket = null;
let vapiSocket = null;

// ✅ Corrected Vapi Call Payload
async function getVapiWebSocketUrl() {
  try {
    const response = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assistantId: VAPI_ASSISTANT_ID,
        transport: {
          provider: 'vapi.websocket',
          audioFormat: {
            format: 'pcm_s16le',
            container: 'raw',
            sampleRate: 16000
          }
        }
      })
    });

    const data = await response.json();

    if (!data?.transport?.websocketCallUrl) {
      console.error('❌ Failed to get websocketCallUrl from Vapi:', data);
      return null;
    }

    console.log('🔗 Received Vapi websocketCallUrl');
    return data.transport.websocketCallUrl;
  } catch (err) {
    console.error('❌ Error creating Vapi call:', err);
    return null;
  }
}

// ✅ WebSocket Server Setup
const server = new WebSocket.Server({ port: SERVER_PORT });

server.on('connection', async (ws) => {
  console.log('✅ TeleCMI (or local client) connected');
  telecmiSocket = ws;

  const vapiWsUrl = await getVapiWebSocketUrl();
  if (!vapiWsUrl) {
    console.error('❌ Could not retrieve Vapi WebSocket URL. Aborting.');
    return;
  }

  vapiSocket = new WebSocket(vapiWsUrl, {
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`
    }
  });

  vapiSocket.on('open', () => {
    console.log('🟢 Connected to Vapi');
  });

  vapiSocket.on('message', (msg) => {
    if (Buffer.isBuffer(msg)) {
      const base64Audio = msg.toString('base64');
      const stream = new StreamAction();
      const payload = stream.playStream(base64Audio, 'raw', 16000); // ✅ 16000 for Vapi clarity

      if (telecmiSocket?.readyState === WebSocket.OPEN) {
        telecmiSocket.send(payload);
        console.log('📥 Vapi → 📤 TeleCMI');
      }
    } else {
      try {
        const data = JSON.parse(msg);
        if (data.type) console.log(`📩 Vapi Event: ${data.type}`);
      } catch {
        console.log('📩 Vapi Non-binary message');
      }
    }
  });

  ws.on('message', (msg) => {
    if (vapiSocket?.readyState === WebSocket.OPEN) {
      vapiSocket.send(msg);
      console.log('📤 TeleCMI → Vapi');
    } else {
      console.warn('⚠️ Vapi socket not open');
    }
  });

  vapiSocket.on('error', (err) => {
    console.error('❌ Vapi socket error:', err.message || err);
  });

  vapiSocket.on('close', (code, reason) => {
    console.log(`🔴 Vapi connection closed - Code: ${code}, Reason: ${reason || 'No reason'}`);
  });

  ws.on('error', (err) => {
    console.error('❌ TeleCMI socket error:', err);
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 TeleCMI disconnected - Code: ${code}, Reason: ${reason}`);
    if (vapiSocket?.readyState === WebSocket.OPEN) vapiSocket.close();
    telecmiSocket = null;
    vapiSocket = null;
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${SERVER_PORT} already in use`);
  } else {
    console.error('❌ WebSocket server error:', err);
  }
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (telecmiSocket) telecmiSocket.close();
  if (vapiSocket) vapiSocket.close();
  server.close(() => {
    console.log('✅ Server closed');
  });
});

console.log(`🚀 WebSocket relay listening on ws://0.0.0.0:${SERVER_PORT}`);
console.log('🔗 Bridging TeleCMI ↔ Vapi');
console.log('⏳ Waiting for connection...');


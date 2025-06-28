import 'dotenv/config';
import WebSocket, { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import { StreamAction } from 'piopiy';
import pcmConvert from 'pcm-convert';

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const SERVER_PORT = process.env.PORT || 8766;

console.log('🚀 WebSocket relay server starting...');

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error('❌ Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in .env');
  process.exit(1);
}

let telecmiSocket = null;
let vapiSocket = null;

// 🔗 Fetch Vapi WebSocket URL
async function getVapiWebSocketUrl() {
  try {
    const response = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assistant: { id: VAPI_ASSISTANT_ID },
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

// 🌐 Start WebSocket server
const server = new WebSocketServer({ port: SERVER_PORT });

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

  // 🔁 Handle messages from Vapi
  vapiSocket.on('message', (msg) => {
    if (Buffer.isBuffer(msg)) {
      try {
        const pcm8 = pcmConvert(msg, {
          sourceFormat: { sampleRate: 16000, float: false, bitDepth: 16 },
          targetFormat: { sampleRate: 8000, float: false, bitDepth: 16 }
        });

        const base64Audio = Buffer.from(pcm8).toString('base64');
        const stream = new StreamAction();
        const payload = stream.playStream(base64Audio, 'raw', 8000);

        if (telecmiSocket?.readyState === WebSocket.OPEN) {
          telecmiSocket.send(payload);
          console.log('📥 Vapi → 📤 TeleCMI (converted 8kHz)');
        }
      } catch (err) {
        console.error('❌ Audio conversion failed:', err);
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

  // 🔁 Handle messages from TeleCMI
  ws.on('message', (msg) => {
    if (vapiSocket?.readyState === WebSocket.OPEN) {
      vapiSocket.send(msg);
      console.log('📤 TeleCMI → Vapi');
    }
  });

  vapiSocket.on('close', (code, reason) => {
    console.log(`🔴 Vapi connection closed - Code: ${code}, Reason: ${reason || 'No reason'}`);
  });

  vapiSocket.on('error', (err) => {
    console.error('❌ Vapi socket error:', err.message || err);
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 TeleCMI disconnected - Code: ${code}, Reason: ${reason}`);
    if (vapiSocket?.readyState === WebSocket.OPEN) vapiSocket.close();
    telecmiSocket = null;
    vapiSocket = null;
  });

  ws.on('error', (err) => {
    console.error('❌ TeleCMI socket error:', err);
  });
});

server.on('error', (err) => {
  console.error('❌ WebSocket server error:', err);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (telecmiSocket) telecmiSocket.close();
  if (vapiSocket) vapiSocket.close();
  server.close(() => console.log('✅ Server closed'));
});

console.log(`🚀 Listening on ws://0.0.0.0:${SERVER_PORT}`);
console.log('🔗 Bridging TeleCMI ↔ Vapi');
console.log('⏳ Waiting for connection...');

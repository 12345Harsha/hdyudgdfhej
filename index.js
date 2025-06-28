import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import { StreamAction } from 'piopiy';
import pcmConvert from 'pcm-convert';

dotenv.config();

const {
  ELEVENLABS_API_KEY,
  ELEVENLABS_AGENT_ID,
  VAPI_API_URL = 'https://api.vapi.ai',
  TELECMI_SAMPLE_RATE = 8000,
  SERVER_PORT = 10000,
} = process.env;

console.log('🚀 WebSocket relay server starting...');

const server = new WebSocketServer({ port: SERVER_PORT });

console.log(`🚀 Listening on ws://0.0.0.0:${SERVER_PORT}`);
console.log('🔗 Bridging TeleCMI ↔ Vapi');
console.log('⏳ Waiting for connection...');

server.on('connection', async (telecmiWs) => {
  console.log('✅ TeleCMI (or local client) connected');

  // Step 1: Request WebSocket stream URL from Vapi
  const res = await fetch(`${VAPI_API_URL}/call`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ELEVENLABS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assistant: {
        // Use either projectId + name or precreated assistant ID
        // id: ELEVENLABS_AGENT_ID, ❌ DO NOT USE IF YOU GET "should not exist" ERROR
        projectId: 'your_project_id', // Replace with your actual Vapi project ID
        name: 'your_agent_name'       // Replace with your assistant name
      },
      type: 'websocket',
      audio: {
        sampleRate: 8000,
        encoding: 'LINEAR16',
      },
    }),
  });

  const data = await res.json();

  if (!data.websocketUrl) {
    console.error('❌ Failed to get websocketCallUrl from Vapi:', data);
    console.error('❌ Could not retrieve Vapi WebSocket URL. Aborting.\n');
    server.close(() => console.log('✅ Server closed'));
    return;
  }

  console.log('🌐 Connecting to Vapi WebSocket...');

  const vapiWs = new WebSocket(data.websocketUrl);

  vapiWs.on('open', () => {
    console.log('✅ Connected to Vapi');
  });

  // TeleCMI → Vapi
  telecmiWs.on('message', (message) => {
    const int16 = new Int16Array(message);
    const float32 = pcmConvert(int16, 'int16', 'float32');

    vapiWs.send(
      JSON.stringify({
        audio: {
          data: Array.from(float32),
        },
        type: 'stream',
      })
    );
  });

  // Vapi → TeleCMI
  vapiWs.on('message', async (data) => {
    const msg = JSON.parse(data);

    if (msg.audio && msg.audio.data) {
      const audioData = new Float32Array(msg.audio.data);
      const int16 = pcmConvert(audioData, 'float32', 'int16');

      telecmiWs.send(Buffer.from(int16));
    }

    if (msg.action === StreamAction.END) {
      console.log('✅ Conversation ended by Vapi');
      vapiWs.close();
      telecmiWs.close();
    }
  });
});

require('dotenv').config();
const WebSocket = require('ws');
const { StreamAction } = require('piopiy');

console.log('🚀 WebSocket relay server starting...');

// Configuration from environment variables
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.AGENT_ID;
const ELEVENLABS_WS_URL = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
const SERVER_PORT = 8766;

if (!ELEVENLABS_API_KEY || !AGENT_ID) {
  console.error('❌ Missing ELEVENLABS_API_KEY or AGENT_ID in environment variables.');
  process.exit(1);
}

let telecmiSocket = null;
let elevenlabsSocket = null;

// Create WebSocket server
const server = new WebSocket.Server({ port: SERVER_PORT });

server.on('connection', (ws) => {
  console.log('✅ TeleCMI connected');
  telecmiSocket = ws;
  
  // Connect to ElevenLabs
  elevenlabsSocket = new WebSocket(ELEVENLABS_WS_URL, {
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY
    }
  });

  // ElevenLabs WebSocket event handlers
  elevenlabsSocket.on('open', () => {
    console.log('🟢 Connected to ElevenLabs');
  });

  elevenlabsSocket.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      console.log('📥 Received from ElevenLabs:', data.type || 'audio');
      
      // Handle audio events from ElevenLabs
      if (data.audio_event && data.audio_event.audio_base_64) {
        const b64Audio = data.audio_event.audio_base_64;
        const stream = new StreamAction();
        
        try {
          // Create payload for TeleCMI
          const payload = stream.playStream(b64Audio, 'raw', 8000);
          
          // Send to TeleCMI if connection is open
          if (telecmiSocket && telecmiSocket.readyState === WebSocket.OPEN) {
            telecmiSocket.send(payload);
            console.log('📤 Audio sent to TeleCMI');
          } else {
            console.warn('⚠️ TeleCMI socket not available');
          }
        } catch (streamErr) {
          console.error('❌ Error creating stream payload:', streamErr);
        }
      }
    } catch (err) {
      console.error('❌ Error processing ElevenLabs message:', err);
    }
  });

  elevenlabsSocket.on('error', (err) => {
    console.error('❌ ElevenLabs WebSocket error:', err);
  });

  elevenlabsSocket.on('close', (code, reason) => {
    console.log(`❌ ElevenLabs WebSocket closed - Code: ${code}, Reason: ${reason}`);
  });

  // TeleCMI WebSocket event handlers
  ws.on('message', (msg) => {
    try {
      // Convert message to buffer if needed
      const audioBuffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      const b64Audio = audioBuffer.toString('base64');
      
      // Send audio to ElevenLabs if connection is open
      if (elevenlabsSocket && elevenlabsSocket.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify({
          audio_event: {
            audio_base_64: b64Audio
          }
        });
        
        elevenlabsSocket.send(payload);
        console.log('📤 Audio sent to ElevenLabs');
      } else {
        console.warn('⚠️ ElevenLabs socket not available');
      }
    } catch (err) {
      console.error('❌ Error processing TeleCMI message:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('❌ TeleCMI WebSocket error:', err);
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 TeleCMI disconnected - Code: ${code}, Reason: ${reason}`);
    
    // Clean up ElevenLabs connection
    if (elevenlabsSocket && elevenlabsSocket.readyState === WebSocket.OPEN) {
      elevenlabsSocket.close();
    }
    
    // Reset references
    telecmiSocket = null;
    elevenlabsSocket = null;
  });
});

// Server error handling
server.on('error', (err) => {
  console.error('❌ WebSocket server error:', err);
});

let shuttingDown = false;

// Graceful shutdown
process.on('SIGINT', () => {
  if (shuttingDown) return; // Prevent multiple calls
  shuttingDown = true;

  console.log('\n🛑 Shutting down server...');
  
  if (telecmiSocket) {
    telecmiSocket.close();
  }
  
  if (elevenlabsSocket) {
    elevenlabsSocket.close();
  }
  
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    // Do not exit process here to keep server running for testing
    // process.exit(0);
  });
});

console.log(`🚀 WebSocket relay server listening on ws://0.0.0.0:${SERVER_PORT}`);
console.log('🔗 Bridging TeleCMI ↔ ElevenLabs audio streams');
console.log('⏳ Waiting for TeleCMI connection...');
console.log('Press Ctrl+C to stop the server');

const ws = new WebSocket('ws://localhost:8766');

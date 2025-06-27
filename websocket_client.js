import WebSocket from 'ws';
import fs from 'fs';
import Speaker from 'speaker';

// Connect to the local WebSocket server
const ws = new WebSocket('ws://localhost:8766');

// Optional: Replace with path to your test audio file
const AUDIO_FILE = 'test_audio.ulaw'; // Make sure it's 8000 Hz, 8-bit, mono, ulaw-encoded

// Speaker setup to play received audio
const speaker = new Speaker({
  channels: 1,
  bitDepth: 8,
  sampleRate: 8000,
  signed: false,
  endian: 'little',
});

function connect() {
  ws.on('open', () => {
    console.log('📤 websocket_client.js connected to server');

    try {
      const audioData = fs.readFileSync(AUDIO_FILE); // Synchronous read for test audio
      console.log(`🎧 Sending ${AUDIO_FILE} (${audioData.length} bytes)`);
      ws.send(audioData); // Send binary audio buffer
    } catch (err) {
      console.error('❌ Error reading audio file:', err);
    }
  });

  ws.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      // Received raw audio from ElevenLabs → play it
      speaker.write(data);
    } else {
      console.log('📩 Received non-binary message:', data.toString());
    }
  });

  ws.on('close', () => {
    console.log('🔌 websocket_client.js disconnected');
    // Attempt to reconnect after 3 seconds
    setTimeout(() => {
      console.log('🔄 Reconnecting websocket_client.js...');
      connect();
    }, 3000);
  });

  ws.on('error', (err) => {
    console.error('❗ WebSocket error:', err);
  });
}

connect();
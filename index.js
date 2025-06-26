import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";
import dotenv from "dotenv";
import { StreamAction } from "piopiy";
import net from "net";

dotenv.config();
console.log("🔍 CHECKPOINT: index.js loaded");

const { ELEVENLABS_AGENT_ID, ELEVENLABS_API_KEY } = process.env;

console.log("🔐 API Key loaded:", ELEVENLABS_API_KEY ? "✅ SET" : "❌ MISSING");
console.log("🎙 Voice ID:", ELEVENLABS_AGENT_ID ? "✅ SET" : "❌ MISSING");

const fastify = Fastify();
fastify.register(fastifyWebsocket);
console.log("✅ WebSocket plugin registered");

const stream = new StreamAction();

fastify.get("/", async (req, reply) => {
  reply.send({ status: "✅ WebSocket server is running" });
});

function ulawToPcm16(buffer) {
  const MULAW_BIAS = 33;
  const pcmSamples = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    let muLawByte = buffer[i] ^ 0xff;
    let sign = muLawByte & 0x80;
    let exponent = (muLawByte >> 4) & 0x07;
    let mantissa = muLawByte & 0x0f;
    let sample = ((mantissa << 4) + 0x08) << (exponent + 3);
    sample = sign ? (MULAW_BIAS - sample) : (sample - MULAW_BIAS);
    pcmSamples[i] = sample;
  }
  return Buffer.from(pcmSamples.buffer);
}

function pcm16ToUlaw(buffer) {
  const pcmSamples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
  const MULAW_MAX = 0x1fff;
  const MULAW_BIAS = 33;
  const ulawBuffer = Buffer.alloc(pcmSamples.length);
  for (let i = 0; i < pcmSamples.length; i++) {
    let sample = pcmSamples[i];
    let sign = sample < 0 ? 0x80 : 0;
    if (sign) sample = -sample;
    sample += MULAW_BIAS;
    if (sample > MULAW_MAX) sample = MULAW_MAX;
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
      exponent--;
    }
    let mantissa = (sample >> (exponent + 3)) & 0x0f;
    let ulawByte = ~(sign | (exponent << 4) | mantissa);
    ulawBuffer[i] = ulawByte;
  }
  return ulawBuffer;
}

fastify.get("/ws", { websocket: true }, (connection) => {
  const telecmiSocket = connection.socket;
  console.log("📞 TeleCMI connected");

  if (!ELEVENLABS_AGENT_ID || !ELEVENLABS_API_KEY) {
    console.error("❌ Missing ElevenLabs credentials");
    telecmiSocket.close();
    return;
  }

  const elevenLabsSocket = new WebSocket(
    `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVENLABS_AGENT_ID}`,
    {
      headers: {
        Authorization: `Bearer ${ELEVENLABS_API_KEY}`,
      },
    }
  );

  elevenLabsSocket.on("open", () => {
    console.log("🟢 Connected to ElevenLabs");

    elevenLabsSocket.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
    elevenLabsSocket.send(JSON.stringify({
      type: "agent_output_audio_format",
      audio_format: {
        encoding: "mulaw",
        sample_rate: 8000,
      },
    }));
    console.log("🛠 Requested μ-law 8000Hz audio from ElevenLabs");
  });

  elevenLabsSocket.on("message", async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "ping") {
        elevenLabsSocket.send(JSON.stringify({ type: "pong", event_id: msg.event_id }));
      } else if (msg.audio) {
        const audioBuffer = Buffer.from(msg.audio, "base64");
        console.log("🔊 Received audio from ElevenLabs:", audioBuffer.length);

        const base64Raw = audioBuffer.toString("base64");
        await stream.playStream(base64Raw, "raw", 8000);
        console.log("📤 Piopiy streaming base64 audio (8000Hz raw)");

        if (telecmiSocket.readyState === WebSocket.OPEN) {
          const ulawBuffer = pcm16ToUlaw(audioBuffer);
          telecmiSocket.send(ulawBuffer);
          console.log("📨 Sent audio back to TeleCMI (converted)");
        }
      } else {
        console.log("📩 ElevenLabs message:", msg);
      }
    } catch (err) {
      console.error("❌ ElevenLabs parse error:", err.message);
    }
  });

  elevenLabsSocket.on("error", (err) => {
    console.error("💥 ElevenLabs error:", err.message);
    telecmiSocket.close();
  });

  elevenLabsSocket.on("close", () => {
    console.log("🔌 ElevenLabs disconnected");
    if (telecmiSocket.readyState === WebSocket.OPEN) {
      telecmiSocket.close();
    }
  });

  telecmiSocket.on("message", (data) => {
    try {
      const pcm16Buffer = ulawToPcm16(data);
      const base64 = pcm16Buffer.toString("base64");
      elevenLabsSocket.send(JSON.stringify({ user_audio_chunk: base64 }));
      console.log("🎧 Sent audio from TeleCMI to ElevenLabs");
    } catch (err) {
      console.error("❌ Audio conversion error:", err.message);
    }
  });

  telecmiSocket.on("close", () => {
    console.log("❎ TeleCMI disconnected");
    if (elevenLabsSocket.readyState === WebSocket.OPEN) {
      elevenLabsSocket.close();
    }
  });

  telecmiSocket.on("error", (err) => {
    console.error("💥 TeleCMI socket error:", err.message);
  });
});

const tryListen = (port) => {
  return new Promise((resolve, reject) => {
    const tester = net.createServer()
      .once('error', err => err.code === 'EADDRINUSE' ? reject() : resolve(port))
      .once('listening', () => tester.close(() => resolve(port)))
      .listen(port);
  });
};

const startServer = async () => {
  let port = parseInt(process.env.PORT, 10) || 3020;
  while (true) {
    try {
      await tryListen(port);
      fastify.listen({ port, host: "0.0.0.0" }, (err, address) => {
        if (err) {
          console.error("❌ Server failed to start:", err);
          process.exit(1);
        }
        console.log(`🚀 WebSocket Proxy Server running on ${address}/ws`);
        console.log(`🔗 WebSocket endpoint: ws://localhost:${port}/ws`);
        console.log(`❤️ Health check: http://localhost:${port}/`);
      });
      break;
    } catch {
      console.warn(`⚠️ Port ${port} in use. Trying ${port + 1}...`);
      port++;
    }
  }
};

startServer();

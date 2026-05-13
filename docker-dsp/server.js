const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 JAAD Headless DSP Server running on port 8080');

wss.on('connection', (ws) => {
  console.log('🔗 Browser client connected');

  ws.on('message', (message) => {
    // Basic echo with "DSP processing" simulation (e.g., gain reduction)
    // In a real scenario, this would use a C++ Wasm module or Node-Audio
    const inputBuffer = new Float32Array(message.buffer, message.byteOffset, message.byteLength / 4);
    const outputBuffer = new Float32Array(inputBuffer.length);

    for (let i = 0; i < inputBuffer.length; i++) {
      outputBuffer[i] = inputBuffer[i] * 0.9; // Simulate some DSP
    }

    ws.send(outputBuffer);
  });

  ws.on('close', () => {
    console.log('❌ Browser client disconnected');
  });
});

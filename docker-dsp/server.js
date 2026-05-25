const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 JAAD Headless VST/DSP Sidecar running on port 8080');

// Shared virtual VST parameter states
let parameters = {
  cutoff: { name: 'Cutoff', value: 0.5, min: 20, max: 20000 },
  resonance: { name: 'Resonance', value: 0.25, min: 0, max: 1 },
  dryWet: { name: 'Dry / Wet', value: 0.8, min: 0, max: 1 },
};

// Filter history state for audio processing simulation
let filterState = {
  v0: 0,
  v1: 0,
};

wss.on('connection', (ws) => {
  console.log('🔗 Client connected to Cloud VST Bridge');

  // Immediately send current sync state to client
  ws.send(JSON.stringify({
    type: 'sync_params',
    parameters
  }));

  ws.on('message', (message) => {
    // Check if message is binary (audio PCM buffer) or text (JSON commands)
    if (Buffer.isBuffer(message) || message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
      // Process binary audio stream (Float32Array)
      let bufferData;
      if (Buffer.isBuffer(message)) {
        bufferData = new Float32Array(message.buffer, message.byteOffset, message.length / 4);
      } else {
        bufferData = new Float32Array(message);
      }

      const outputBuffer = new Float32Array(bufferData.length);

      // DSP simulation: Simple 1-pole Low-Pass Filter based on 'cutoff' dial
      const cutVal = parameters.cutoff.value;
      const resVal = parameters.resonance.value;
      const mixVal = parameters.dryWet.value;

      // Map cutoff value to alpha coefficient [0.005, 0.95]
      const alpha = 0.005 + 0.945 * cutVal;
      // Resonating feedback
      const feedback = 0.3 * resVal;

      for (let i = 0; i < bufferData.length; i++) {
        const inputSample = bufferData[i];
        
        // Simulating a basic lowpass feedback filter loop
        filterState.v0 = filterState.v0 + alpha * (inputSample - filterState.v0 + feedback * filterState.v1);
        filterState.v1 = filterState.v0; // simple delay

        // Blend Dry / Wet
        outputBuffer[i] = inputSample * (1 - mixVal) + filterState.v0 * mixVal;
      }

      // Send back the processed PCM buffer
      ws.send(Buffer.from(outputBuffer.buffer, outputBuffer.byteOffset, outputBuffer.byteLength));
      return;
    }

    // Process JSON text message
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', id: data.id }));
      } 
      else if (data.type === 'param_change') {
        const { key, value } = data;
        if (parameters[key]) {
          parameters[key].value = value;
          console.log(`🎛️ VST Parameter update: [${key}] = ${value.toFixed(2)}`);
          
          // Broadcast update to all other connected clients
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'param_change',
                key,
                value
              }));
            }
          });
        }
      } 
      else if (data.type === 'sync_params') {
        if (data.parameters) {
          parameters = { ...parameters, ...data.parameters };
          console.log('🔄 VST Parameters synchronised with client');
        }
      }
    } catch (err) {
      console.error('⚠️ Error processing VST socket message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('❌ Client disconnected from Cloud VST Bridge');
  });
});

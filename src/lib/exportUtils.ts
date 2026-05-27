import JSZip from "jszip";

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function estimateWavSize(duration: number): number {
  return duration * 44100 * 2 * 2;
}

export function audioBufferToWav(buffer: AudioBuffer, title?: string): Blob {
  const numOfChan = buffer.numberOfChannels;
  let infoChunkSize = 0;
  let titleBytes: Uint8Array | null = null;
  if (title) {
    const encoder = new TextEncoder();
    titleBytes = encoder.encode(title);
    
    // Size = 4 (INFO) + 4 (INAM) + 4 (size) + length + null terminator
    // Length including null terminator
    let strLen = titleBytes.length + 1;
    if (strLen % 2 !== 0) strLen++; // Pad to even length
    infoChunkSize = 4 + 4 + 4 + strLen; 
  }

  const dataSize = buffer.length * numOfChan * 2;
  const length = 44 + dataSize + (infoChunkSize > 0 ? 8 + infoChunkSize : 0);
  const buffer_out = new ArrayBuffer(length);
  const view = new DataView(buffer_out);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded)

  setUint32(0x61746164); // "data" - chunk
  setUint32(dataSize); // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (offset < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7fff) | 0; // scale to 16nd-bit signed int
      view.setInt16(pos, sample, true); // update data view
      pos += 2;
    }
    offset++; // next source sample
  }

  if (infoChunkSize > 0 && titleBytes) {
    setUint32(0x5453494c); // "LIST"
    setUint32(infoChunkSize); 
    setUint32(0x4f464e49); // "INFO"
    setUint32(0x4d414e49); // "INAM"
    
    let strLen = titleBytes.length + 1;
    let pad = 0;
    if (strLen % 2 !== 0) {
      strLen++;
      pad = 1;
    }
    setUint32(strLen);
    
    for (let b = 0; b < titleBytes.length; b++) {
      view.setUint8(pos++, titleBytes[b]);
    }
    view.setUint8(pos++, 0); // null terminator
    if (pad > 0) {
      view.setUint8(pos++, 0); // pad byte
    }
  }

  return new Blob([buffer_out], { type: "audio/wav" });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

export async function createStemZip(trackBuffers: { name: string, buffer: AudioBuffer }[], projectName: string = ""): Promise<Blob> {
  const zip = new JSZip();
  
  for (const { name, buffer } of trackBuffers) {
    const wavBlob = audioBufferToWav(buffer, projectName ? `${projectName} - ${name}` : name);
    zip.file(`${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.wav`, wavBlob);
  }
  
  return await zip.generateAsync({ type: 'blob' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Delay revocation to ensure modern browsers complete streaming the download before release
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

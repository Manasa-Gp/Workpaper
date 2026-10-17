// loadPacket.js — gets the packet JSON into memory, exactly as delivered.
//
// Flow: main.js -> loadFromBackend() asks the backend for GET /api/packet, which serves
// backend/data/packet.json. If that fails (backend not running, or the file is not there),
// main.js shows a file picker and calls readPacketFile() instead. Nothing is modified.

export async function loadFromBackend(url = '/api/packet') {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function readPacketFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

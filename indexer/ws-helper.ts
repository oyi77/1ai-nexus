import WebSocket from 'ws';

export function createWs(url: string) {
  return new WebSocket(url);
}

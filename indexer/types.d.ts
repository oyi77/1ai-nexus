declare module "ulid";
declare module "@clickhouse/client";
declare module "ws" {
  export interface MessageEvent { data: any; }
  export interface CloseEvent {}
  export interface WebSocket {
    close(code?: number, reason?: string): void;
    send(data: string | ArrayBuffer): void;
    on(event: string, handler: (...args: any[]) => void): this;
    onopen: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
  }
  export default class _WS implements WebSocket {
    constructor(url: string, protocols?: string | string[]);
    close(): void;
    send(data: string | ArrayBuffer): void;
    on(event: string, handler: (...args: any[]) => void): this;
    onopen: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
  }
}

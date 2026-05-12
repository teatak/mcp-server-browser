import type { JsonRpcMessage } from "../spec/index.js";

export type TransportStatus = "idle" | "connecting" | "open" | "closed";

export interface CreateSocketContext {
  endpoint: string;
  /** 0 for the first connect, >0 for reconnect attempts. */
  attempt: number;
}

export type CreateSocket = (
  ctx: CreateSocketContext,
) => WebSocket | Promise<WebSocket>;

export interface WsTransportOptions {
  endpoint: string;
  /**
   * Custom WebSocket factory. Called on every (re)connect.
   *
   * Use this to attach auth (URL params, subprotocols), fetch a fresh token
   * before connecting, swap in a polyfill, or wrap WebSocket for logging.
   *
   * Defaults to `({ endpoint }) => new WebSocket(endpoint)`.
   */
  createSocket?: CreateSocket;
  reconnect?: {
    enabled?: boolean;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
}

type Listener<T> = (value: T) => void;

const defaultCreateSocket: CreateSocket = ({ endpoint }) =>
  new WebSocket(endpoint);

export class WsTransport {
  private opts: WsTransportOptions;
  private ws: WebSocket | null = null;
  private status: TransportStatus = "idle";
  private explicitClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private messageListeners = new Set<Listener<JsonRpcMessage>>();
  private statusListeners = new Set<Listener<TransportStatus>>();
  private errorListeners = new Set<Listener<Error>>();

  constructor(opts: WsTransportOptions) {
    this.opts = opts;
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  connect(): void {
    if (this.ws) return;
    this.explicitClose = false;
    void this.openSocket(this.reconnectAttempt);
  }

  close(): void {
    this.explicitClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
  }

  send(msg: JsonRpcMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("ws transport: not open");
    }
    this.ws.send(JSON.stringify(msg));
  }

  onMessage(fn: Listener<JsonRpcMessage>): () => void {
    this.messageListeners.add(fn);
    return () => {
      this.messageListeners.delete(fn);
    };
  }

  onStatus(fn: Listener<TransportStatus>): () => void {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  onError(fn: Listener<Error>): () => void {
    this.errorListeners.add(fn);
    return () => {
      this.errorListeners.delete(fn);
    };
  }

  private setStatus(s: TransportStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  private async openSocket(attempt: number): Promise<void> {
    const factory = this.opts.createSocket ?? defaultCreateSocket;
    this.setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = await factory({ endpoint: this.opts.endpoint, attempt });
    } catch (err) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
      this.setStatus("closed");
      if (!this.explicitClose && this.reconnectEnabled()) {
        this.scheduleReconnect();
      }
      return;
    }

    // close() may have been called while we were awaiting the factory.
    if (this.explicitClose) {
      try {
        ws.close();
      } catch {
        // ignore
      }
      return;
    }

    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.setStatus("open");
    });

    ws.addEventListener("message", (ev) => {
      let parsed: JsonRpcMessage;
      try {
        parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        this.emitError(new Error("ws transport: invalid json from peer"));
        return;
      }
      for (const fn of this.messageListeners) fn(parsed);
    });

    ws.addEventListener("error", () => {
      this.emitError(new Error("ws transport: socket error"));
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      this.setStatus("closed");
      if (!this.explicitClose && this.reconnectEnabled()) {
        this.scheduleReconnect();
      }
    });
  }

  private reconnectEnabled(): boolean {
    return this.opts.reconnect?.enabled !== false;
  }

  private scheduleReconnect(): void {
    const initial = this.opts.reconnect?.initialDelayMs ?? 500;
    const max = this.opts.reconnect?.maxDelayMs ?? 30_000;
    const delay = Math.min(max, initial * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.explicitClose) void this.openSocket(this.reconnectAttempt);
    }, delay);
  }

  private emitError(err: Error): void {
    for (const fn of this.errorListeners) fn(err);
  }
}

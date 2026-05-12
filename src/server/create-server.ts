import {
  JSON_RPC_VERSION,
  METHOD,
  PROTOCOL_VERSION,
  RPC_ERROR,
  type InitializeResult,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type PromptSpec,
  type PromptsListResult,
  type ToolsCallParams,
  type ToolsCallResult,
  type ToolsListResult,
  type ToolSpec,
} from "../spec/index.js";
import {
  WsTransport,
  type CreateSocket,
  type TransportStatus,
  type WsTransportOptions,
} from "../transport/ws-transport.js";

export interface ToolContext {
  abortSignal: AbortSignal;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<unknown> | unknown;

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
  handler: ToolHandler;
}

// PromptDefinition is a chunk of guidance text destined for the LLM's system
// instruction. The MCP client (e.g. a local agent) appends `content` to its
// system prompt before calling the model — useful for embedding tool usage
// constraints next to the tool registration itself.
export interface PromptDefinition {
  name: string;
  description?: string;
  content: string;
}

export interface CreateServerOptions {
  /** WebSocket endpoint of the MCP client (e.g. `ws://127.0.0.1:9669/mcp/ws`). */
  endpoint: string;
  /** Identifies this MCP server. Reported back to the client in `initialize`. */
  serverInfo: { name: string; version: string };
  /**
   * Optional WebSocket factory. Use this for authentication, polyfills, etc.
   * See README → Authentication.
   */
  createSocket?: CreateSocket;
  reconnect?: WsTransportOptions["reconnect"];
}

export interface McpBrowserServer {
  registerTool(def: ToolDefinition): () => void;
  registerPrompt(def: PromptDefinition): () => void;
  connect(): void;
  close(): void;
  getStatus(): TransportStatus;
  onStatus(fn: (s: TransportStatus) => void): () => void;
  onError(fn: (err: Error) => void): () => void;
}

export function createServer(opts: CreateServerOptions): McpBrowserServer {
  const tools = new Map<string, ToolDefinition>();
  const prompts = new Map<string, PromptDefinition>();
  const pendingCalls = new Map<string, AbortController>();
  const transport = new WsTransport({
    endpoint: opts.endpoint,
    createSocket: opts.createSocket,
    reconnect: opts.reconnect,
  });

  const serverInfo = opts.serverInfo;

  transport.onMessage((msg) => {
    handleMessage(msg);
  });

  function handleMessage(msg: JsonRpcMessage): void {
    if (!("method" in msg) || !msg.method) return;
    const req = msg as JsonRpcRequest;
    const hasId = "id" in msg && msg.id !== undefined && msg.id !== null;
    try {
      if (req.method === METHOD.Initialize) {
        if (!hasId) return;
        const result: InitializeResult = {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo,
          // listChanged is true for both — register/unregister after initialize
          // emits the corresponding notification so the client re-fetches.
          capabilities: {
            tools: { listChanged: true },
            prompts: { listChanged: true },
          },
        };
        replyResult(req.id, result);
        return;
      }
      if (req.method === METHOD.ToolsList) {
        if (!hasId) return;
        const list: ToolsListResult = {
          tools: Array.from(tools.values()).map<ToolSpec>((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema ?? { type: "object", properties: {} },
          })),
        };
        replyResult(req.id, list);
        return;
      }
      if (req.method === METHOD.PromptsList) {
        if (!hasId) return;
        const list: PromptsListResult = {
          prompts: Array.from(prompts.values()).map<PromptSpec>((p) => ({
            name: p.name,
            description: p.description,
            content: p.content,
          })),
        };
        replyResult(req.id, list);
        return;
      }
      if (req.method === METHOD.ToolsCall) {
        if (!hasId) return;
        const params = (req.params ?? {}) as ToolsCallParams;
        const tool = tools.get(params.name);
        if (!tool) {
          replyError(req.id, RPC_ERROR.MethodNotFound, `tool not found: ${params.name}`);
          return;
        }
        const ac = new AbortController();
        pendingCalls.set(String(req.id), ac);
        Promise.resolve()
          .then(() => tool.handler(params.arguments ?? {}, { abortSignal: ac.signal }))
          .then((out) => {
            pendingCalls.delete(String(req.id));
            const result: ToolsCallResult = {
              content: [{ type: "text", text: JSON.stringify(out ?? {}) }],
              isError: false,
            };
            replyResult(req.id, result);
          })
          .catch((err: unknown) => {
            pendingCalls.delete(String(req.id));
            const message = err instanceof Error ? err.message : String(err);
            replyError(req.id, RPC_ERROR.InternalError, message);
          });
        return;
      }
      if (hasId) {
        replyError(req.id, RPC_ERROR.MethodNotFound, `method not found: ${req.method}`);
      }
    } catch (err) {
      if (hasId) {
        const message = err instanceof Error ? err.message : String(err);
        replyError(req.id, RPC_ERROR.InternalError, message);
      }
    }
  }

  function replyResult(id: JsonRpcRequest["id"], result: unknown): void {
    try {
      transport.send({ jsonrpc: JSON_RPC_VERSION, id, result });
    } catch {
      // transport closed between request and reply; drop.
    }
  }

  function replyError(id: JsonRpcRequest["id"], code: number, message: string): void {
    try {
      transport.send({ jsonrpc: JSON_RPC_VERSION, id, error: { code, message } });
    } catch {
      // ignore
    }
  }

  function notify(method: string): void {
    try {
      const note: JsonRpcNotification = { jsonrpc: JSON_RPC_VERSION, method };
      transport.send(note);
    } catch {
      // Transport not ready / already closed — list_changed before connect is
      // harmless: after initialize the client will fetch the current list.
    }
  }

  return {
    registerTool(def) {
      tools.set(def.name, def);
      notify(METHOD.NotificationsToolsListChanged);
      return () => {
        tools.delete(def.name);
        notify(METHOD.NotificationsToolsListChanged);
      };
    },
    registerPrompt(def) {
      prompts.set(def.name, def);
      notify(METHOD.NotificationsPromptsListChanged);
      return () => {
        prompts.delete(def.name);
        notify(METHOD.NotificationsPromptsListChanged);
      };
    },
    connect() {
      transport.connect();
    },
    close() {
      for (const ac of pendingCalls.values()) ac.abort();
      pendingCalls.clear();
      transport.close();
    },
    getStatus() {
      return transport.getStatus();
    },
    onStatus(fn) {
      return transport.onStatus(fn);
    },
    onError(fn) {
      return transport.onError(fn);
    },
  };
}

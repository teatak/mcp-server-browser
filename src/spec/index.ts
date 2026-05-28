// MCP over WebSocket — wire-level types and constants.
// Pure data; no runtime dependencies. Safe to import from any layer.

export const PROTOCOL_VERSION = "2025-03-26";
export const JSON_RPC_VERSION = "2.0";

export const METHOD = {
  Initialize: "initialize",
  ToolsList: "tools/list",
  ToolsCall: "tools/call",
  NotificationsToolsListChanged: "notifications/tools/list_changed",
  PromptsList: "prompts/list",
  NotificationsPromptsListChanged: "notifications/prompts/list_changed",
} as const;

export const RPC_ERROR = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcErrorResponse;

// InitializeParams.clientInfo carries the identity of the MCP client (the
// agent / caller). This is the wire-protocol field — do not confuse it with
// our SDK's serverInfo (the browser side's identity).
export interface InitializeParams {
  protocolVersion: string;
  clientInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
}

export interface InitializeResult {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
}

export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema?: unknown;
  _meta?: Record<string, unknown>;
}

export interface ToolsListResult {
  tools: ToolSpec[];
}

export interface ToolsCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolsCallResult {
  content: Array<{ type: "text"; text: string } | { type: string; [k: string]: unknown }>;
  isError?: boolean;
}

// PromptSpec exposes a chunk of guidance text intended for the LLM's system
// instruction. Compared to MCP's standard prompts:
//   - No arguments, no prompts/get round-trip — content is delivered inline in
//     prompts/list. Simpler protocol; the current use case is "ship a piece of
//     guidance alongside a tool registration."
//   - content is markdown; the MCP client typically appends it to its system
//     prompt before calling the model.
export interface PromptSpec {
  name: string;
  description?: string;
  content: string;
}

export interface PromptsListResult {
  prompts: PromptSpec[];
}

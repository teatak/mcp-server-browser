# @teatak/mcp-server-browser

An [MCP (Model Context Protocol)][mcp] server that runs **in the browser**.

Register tools and prompts on a web page; expose them to a local MCP client
(such as an agent daemon or sidecar process) over WebSocket. The browser
acts as the **MCP server** — your tool handlers run client-side and the
agent calls into them.

[mcp]: https://modelcontextprotocol.io

## Why a "browser-side server"?

In the usual MCP topology, servers run as local processes and expose
filesystem / database / API tools. This package flips that: the browser
exposes capabilities to the agent. Useful when you want the agent to:

- Drive a UI you're rendering (a canvas, a chart, a form).
- Call into APIs that are only reachable from the user's browser session
  (authenticated SaaS, page-scoped APIs).
- Get human-in-the-loop confirmation through DOM affordances.

At the wire level the browser dials a WebSocket to the agent; at the MCP
protocol level the browser is the server (handles `tools/list`,
`tools/call`, `prompts/list`, etc.).

## Install

```sh
npm install @teatak/mcp-server-browser
```

## Quick start

```ts
import { createServer } from "@teatak/mcp-server-browser";

const server = createServer({
  endpoint: "ws://127.0.0.1:9669/mcp/ws",
  serverInfo: { name: "my-page", version: "1.0.0" },
});

server.registerTool({
  name: "demo.echo",
  description: "Echo back whatever the caller passed.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  handler: async ({ text }) => ({ ok: true, text }),
});

server.connect();
```

## Authentication

This package is **unopinionated about auth**. The browser's WebSocket
constructor only exposes two knobs (`url` and `protocols`); any auth scheme
ultimately rides on one of those. Instead of baking in a specific mechanism,
the library exposes a `createSocket` factory and lets you decide.

The factory is called on every (re)connect — perfect for short-lived tokens.

### No auth (default)

```ts
createServer({
  endpoint: "ws://127.0.0.1:9669/mcp/ws",
  serverInfo: { name: "demo", version: "1.0.0" },
});
```

### Bearer token in URL

```ts
createServer({
  endpoint: "ws://127.0.0.1:9669/mcp/ws",
  serverInfo: { name: "demo", version: "1.0.0" },
  createSocket: ({ endpoint }) =>
    new WebSocket(`${endpoint}?token=${encodeURIComponent(TOKEN)}`),
});
```

### Bearer token in `Sec-WebSocket-Protocol`

Avoids tokens leaking into logs / browser history.

```ts
createServer({
  endpoint: "ws://127.0.0.1:9669/mcp/ws",
  serverInfo: { name: "demo", version: "1.0.0" },
  createSocket: ({ endpoint }) =>
    new WebSocket(endpoint, ["mcp.v1", `bearer.${TOKEN}`]),
});
```

The MCP client side should validate the subprotocol on upgrade and echo the
chosen one back.

### Fresh token per connection

```ts
createServer({
  endpoint: "ws://127.0.0.1:9669/mcp/ws",
  serverInfo: { name: "demo", version: "1.0.0" },
  createSocket: async ({ endpoint, attempt }) => {
    const token = await fetch("/mcp/session-token").then((r) => r.text());
    return new WebSocket(endpoint, [`bearer.${token}`]);
  },
});
```

`attempt` is `0` on the first connect and increments on each reconnect, in
case you want to short-circuit retries after some bound.

### A note on threat model

Localhost WebSocket endpoints are **not** protected by the browser's
same-origin policy — any tab on the user's machine can dial `ws://127.0.0.1`.
For real deployments the MCP client side should pair token validation with
an `Origin` header allowlist.

## Entry points

| Import path                                      | What's there                                          |
| ------------------------------------------------ | ----------------------------------------------------- |
| `@teatak/mcp-server-browser`                     | High-level `createServer` API (recommended).          |
| `@teatak/mcp-server-browser/transport`           | Raw `WsTransport` class for bespoke MCP servers.      |
| `@teatak/mcp-server-browser/spec`                | Wire-level JSON-RPC / MCP types and constants.        |

## Prompts

In addition to tools, this package supports a lightweight `prompts` capability
— a chunk of guidance text that the MCP client should append to its LLM
system instruction. Compared to MCP's standard prompts, this variant is
deliberately simpler: no `arguments`, no `prompts/get` round-trip — content
is delivered inline in `prompts/list`.

```ts
server.registerPrompt({
  name: "ui-render-table.usage",
  description: "Constraints for the ui_render_table tool.",
  content: `When calling ui_render_table, only pass rows from real data. Never invent values.`,
});
```

## Status

Pre-1.0. API may evolve. Tested against MCP protocol version `2025-03-26`.

## License

MIT

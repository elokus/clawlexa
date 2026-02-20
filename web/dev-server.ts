import index from "./index.html";

const PI_HOST = process.env.PI_HOST || "localhost";

type WSData = { target: WebSocket | null; targetUrl: string };

const server = Bun.serve({
  port: 5173,
  development: { hmr: true, console: true },

  static: {
    "/": index,
  },

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for /ws
    if (url.pathname === "/ws") {
      const success = server.upgrade(req, {
        data: {
          target: null,
          targetUrl: `ws://${PI_HOST}:3001/ws`,
        } satisfies WSData,
      });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Serve public directory files (favicon, audio-processor, etc.)
    const publicFile = Bun.file(`./public${url.pathname}`);
    if (await publicFile.exists()) {
      return new Response(publicFile);
    }

    // Proxy /api to backend
    if (url.pathname.startsWith("/api")) {
      const target = `http://${PI_HOST}:3000${url.pathname}${url.search}`;
      return fetch(target, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    }

    // SPA fallback for client-side routes
    return new Response(Bun.file("./index.html"));
  },

  websocket: {
    open(ws) {
      const data = ws.data as WSData;
      const target = new WebSocket(data.targetUrl);
      data.target = target;

      target.binaryType = "arraybuffer";

      target.addEventListener("open", () => {
        // Connection established
      });

      target.addEventListener("message", (e) => {
        if (typeof e.data === "string") {
          ws.send(e.data);
        } else if (e.data instanceof ArrayBuffer) {
          ws.send(new Uint8Array(e.data));
        }
      });

      target.addEventListener("close", () => {
        ws.close();
      });

      target.addEventListener("error", () => {
        ws.close();
      });
    },

    message(ws, msg) {
      const data = ws.data as WSData;
      const target = data.target;
      if (target?.readyState === WebSocket.OPEN) {
        if (typeof msg === "string") {
          target.send(msg);
        } else {
          target.send(msg);
        }
      }
    },

    close(ws) {
      const data = ws.data as WSData;
      const target = data.target;
      if (target && target.readyState !== WebSocket.CLOSED) {
        target.close();
      }
    },
  },
});

console.log(`Dev server running at http://localhost:${server.port}`);

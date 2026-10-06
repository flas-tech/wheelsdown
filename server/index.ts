import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import helmet from "helmet";
import { storage } from "./storage";
import { closeDb, dbKind } from "./db";

const app = express();
const PROD = process.env.NODE_ENV === "production";
// Behind Render/Cloudflare: trust the first proxy hop so rate limits see real client IPs.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable("x-powered-by");
if (PROD) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://api.fontshare.com", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "data:", "https://api.fontshare.com", "https://cdn.fontshare.com", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    // OpenStreetMap's tile policy asks for an accurate Referer on tile requests
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));
}
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // Never log bodies in production (they can contain session tokens and personal data)
      if (capturedJsonResponse && !PROD && !/^\/api\/(auth|me)/.test(path)) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).slice(0, 300)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await storage.init();
  log(`database ready (${dbKind()})`);
  setInterval(() => storage.pruneSessions().catch(() => {}), 6 * 3600_000).unref();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // Don't leak internals in production
    const message = status < 500 || !PROD ? err.message || "Internal Server Error" : "Something went wrong on our side. Try again in a moment.";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // ads.txt for AdSense/ad networks: paste the line Google gives you into the ADS_TXT env var
  app.get("/ads.txt", (_req, res) => {
    if (!process.env.ADS_TXT) return res.status(404).type("text/plain").send("");
    res.type("text/plain").send(process.env.ADS_TXT.replace(/\\n/g, "\n") + "\n");
  });
  app.get("/robots.txt", (_req, res) => res.type("text/plain").send(`User-agent: *\nDisallow: /api/\nAllow: /\n`));
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
  const shutdown = (sig: string) => {
    log(`${sig} received, shutting down`);
    httpServer.close(() => closeDb().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();

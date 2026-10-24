import express from 'express';
import type { Express } from 'express';
import fs from "node:fs";
import path from "node:path";
import { isFboHost } from "./fbo";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed build files never change, so they can be cached for a year. The app shell (index.html), manifest and
  // icons are always rechecked, so phones and home-screen shortcuts pick up a new release without being re-added.
  app.use(express.static(distPath, {
    index: false,
    setHeaders: (res, file) => {
      if (/[\\/]assets[\\/]/.test(file)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      else res.setHeader("Cache-Control", "no-cache");
    },
  }));

  // FBO portal (beta): its own home-screen app. Served at the root of the fbo. host, and at /fbo-portal/ on any host
  // until the subdomain's DNS points here. Nothing in the crew app links to either.
  const sendFbo = (res: express.Response) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-Robots-Tag", "noindex");
    res.sendFile(path.resolve(distPath, "fbo.html"));
  };
  app.get(/^\/fbo-portal$/, (_req, res) => res.redirect(301, "/fbo-portal/"));
  app.use("/fbo-portal", express.static(distPath, { index: false, setHeaders: (res, file) => res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache") }));
  app.use("/fbo-portal", (_req, res) => sendFbo(res));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (req, res) => {
    if (isFboHost(req)) return sendFbo(res);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

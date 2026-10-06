import { defineConfig } from "drizzle-kit";

// Used for `npm run db:studio` / future generated migrations. The app also self-migrates on boot (server/db.ts).
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL || "postgresql://localhost:5432/wheelsdown" },
});

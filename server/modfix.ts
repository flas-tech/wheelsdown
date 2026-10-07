import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { AI_ENABLED, suggestSpotFix, suggestReviewFix, type FixSuggestion } from "./ai";
import { findDuplicate } from "./moderator";
import { geocodeAddress } from "./places";
import { sendEmail } from "./email";
import { milesBetween } from "@shared/cost";
import type { Spot } from "@shared/schema";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
const FIELDS_SPOT = ["name", "address", "icao", "category", "description", "website", "crewTip", "costLevel", "pace", "minutesNeeded"] as const;
const problemOf = (note: string) => /^\[([a-z_]+)\]/.exec(note || "")?.[1] || "";
const spotSig = (s: Spot) => JSON.stringify([s.modNote, s.pendingEdit, ...FIELDS_SPOT.map((k) => (s as any)[k])]);
const parse = (t: string | null | undefined) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };

/** Open duplicate questions for one listing (the newer copy), shown in the admin queue. */
export async function closeDuplicateNotices(dupId: number, why: string) {
  await db().execute(sql`UPDATE notices SET status = 'closed', decision = ${why}, resolved_at = ${Date.now()} WHERE other_id = ${dupId} AND status = 'open'`);
}

/**
 * Admin "AI fix": the AI proposes exact corrections for a held item; the admin applies them (all or some) and it goes live.
 * Duplicates: the owner of the original listing decides whether the new one is the same place.
 */
export function registerModFix(app: Express, o: { requireAdmin: Mw; requireUser: Mw; ensureAirport: (code: string) => Promise<string>; byAdmin: (req: Request, s: string) => string }) {
  // ---------- AI fix ----------
  async function cached(kind: string, id: number, sig: string): Promise<FixSuggestion | null> {
    const r = (await db().execute(sql`SELECT json FROM mod_fixes WHERE kind = ${kind} AND target_id = ${id} AND sig = ${sig}`)).rows[0] as any;
    return r ? JSON.parse(r.json) : null;
  }
  async function store(kind: string, id: number, sig: string, f: FixSuggestion) {
    await db().execute(sql`INSERT INTO mod_fixes (kind, target_id, sig, json, created_at) VALUES (${kind}, ${id}, ${sig}, ${JSON.stringify(f)}, ${Date.now()})
      ON CONFLICT (kind, target_id) DO UPDATE SET sig = EXCLUDED.sig, json = EXCLUDED.json, created_at = EXCLUDED.created_at`);
  }
  async function spotCurrent(id: number) {
    const s = await storage.rawSpot(id);
    if (!s) return null;
    const edit = parse(s.pendingEdit);
    return { s, edit, merged: { ...s, ...(edit || {}) } as Spot };
  }

  app.post("/api/admin/moderation/:kind/:id/fix", o.requireAdmin, async (req, res) => {
    const kind = String(req.params.kind), id = Number(req.params.id);
    if (!AI_ENABLED) return res.status(400).json({ message: "AI is off, so there's no suggested fix." });
    try {
      if (kind === "spot") {
        const c = await spotCurrent(id); if (!c) return res.status(404).json({ message: "Not found" });
        if (problemOf(c.s.modNote) === "duplicate") return res.status(400).json({ message: "This is a duplicate. Ask the original poster instead." });
        const sig = spotSig(c.s), hit = await cached("spot", id, sig);
        if (hit) return res.json({ ...hit, current: pick(c.merged) });
        const airport = await storage.resolveCode(c.merged.icao);
        const others = await storage.namesAt(c.merged.icao, id);
        const f = await suggestSpotFix(c.merged as any, c.s.modNote, { airport: airport ? { name: airport.name, city: airport.city } : null, nearbyNames: others.map((x) => `${x.name} (${x.category}${x.address ? ", " + x.address : ""})`) });
        await store("spot", id, sig, f);
        return res.json({ ...f, current: pick(c.merged) });
      }
      if (kind === "review") {
        const r = await storage.getReview(id); if (!r) return res.status(404).json({ message: "Not found" });
        const edit = parse(r.pendingEdit), cur = { rating: r.rating, comment: r.comment, ...(edit || {}) };
        const sig = JSON.stringify([r.modNote, r.pendingEdit, r.comment]), hit = await cached("review", id, sig);
        if (hit) return res.json({ ...hit, current: { comment: cur.comment } });
        const spot = await storage.rawSpot(r.spotId);
        const f = await suggestReviewFix(cur, spot?.name || "", r.modNote);
        await store("review", id, sig, f);
        return res.json({ ...f, current: { comment: cur.comment } });
      }
      res.status(400).json({ message: "kind spot|review" });
    } catch (e) { res.status(502).json({ message: `The AI couldn't suggest a fix right now: ${String((e as Error).message || e).slice(0, 160)}` }); }
  });
  const pick = (s: any) => Object.fromEntries(FIELDS_SPOT.map((k) => [k, s[k] ?? null]));

  app.post("/api/admin/moderation/:kind/:id/fix/apply", o.requireAdmin, async (req, res) => {
    const kind = String(req.params.kind), id = Number(req.params.id);
    const want = new Set<string>(Array.isArray(req.body?.fields) ? req.body.fields.map(String) : []);
    if (kind === "spot") {
      const c = await spotCurrent(id); if (!c) return res.status(404).json({ message: "Not found" });
      const f = await cached("spot", id, spotSig(c.s));
      if (!f) return res.status(409).json({ message: "The listing changed since the fix was suggested. Tap AI fix again." });
      const changes = f.changes.filter((x) => want.has(x.field));
      if (!changes.length) return res.status(400).json({ message: "Pick at least one change" });
      const patch: Record<string, any> = { ...(c.edit || {}) };
      for (const ch of changes) {
        if (ch.field === "costLevel") { const n = Number(ch.value); patch.costLevel = n >= 1 && n <= 4 ? Math.round(n) : c.merged.costLevel; }
        else if (ch.field === "minutesNeeded") { const n = Number(ch.value); if (n > 0) patch.minutesNeeded = Math.round(n); }
        else if (ch.field === "pace") patch.pace = ["grab", "sit", "both"].includes(ch.value) ? ch.value : c.merged.pace;
        else if (ch.field === "category") { if (["eat", "do", "stay", "fbo"].includes(ch.value)) patch.category = ch.value; }
        else if (ch.field === "icao") patch.icao = await o.ensureAirport(ch.value.toUpperCase().slice(0, 4));
        else patch[ch.field] = ch.value;
      }
      // a new address or airport re-measures the pin and the distance
      const merged = { ...c.merged, ...patch };
      if ((patch.address !== undefined && patch.address !== c.merged.address) || (patch.icao && patch.icao !== c.merged.icao)) {
        const ap = await storage.resolveCode(merged.icao);
        patch.lat = null; patch.lng = null;
        if (ap?.lat != null && ap?.lon != null && merged.address) {
          const g = await geocodeAddress(merged.address, { lat: ap.lat, lng: ap.lon }).catch(() => null);
          if (g) { patch.lat = g.lat; patch.lng = g.lng; patch.milesFromField = Math.round(milesBetween({ lat: ap.lat, lon: ap.lon }, { lat: g.lat, lon: g.lng }) * 10) / 10; }
        }
      }
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (c.s as any)[k] ?? null]));
      await storage.updateSpot(id, patch as any);
      await storage.setSpotMod(id, { status: "live", pendingEdit: null, modState: "approved", modNote: "", modAttempts: 0 });
      await storage.logMod({ kind: "spot", targetId: id, actor: "admin", action: "approve", reason: o.byAdmin(req, `AI fix applied: ${f.summary}`), isEdit: true, before, after: patch });
      await db().execute(sql`DELETE FROM mod_fixes WHERE kind = 'spot' AND target_id = ${id}`);
      return res.json({ ok: true, applied: Object.keys(patch) });
    }
    if (kind === "review") {
      const r = await storage.getReview(id); if (!r) return res.status(404).json({ message: "Not found" });
      const f = await cached("review", id, JSON.stringify([r.modNote, r.pendingEdit, r.comment]));
      if (!f) return res.status(409).json({ message: "The rating changed since the fix was suggested. Tap AI fix again." });
      const ch = f.changes.find((x) => x.field === "comment" && want.has("comment"));
      if (!ch) return res.status(400).json({ message: "Pick at least one change" });
      const edit = parse(r.pendingEdit) || {};
      const next = { rating: edit.rating ?? r.rating, costLevel: edit.costLevel ?? r.costLevel, comment: ch.value };
      await storage.setReviewMod(id, { ...next, status: "live", pendingEdit: null, modState: "approved", modNote: "", modAttempts: 0 });
      await storage.logMod({ kind: "review", targetId: id, actor: "admin", action: "approve", reason: o.byAdmin(req, `AI fix applied: ${f.summary}`), isEdit: true, before: { comment: r.comment }, after: { comment: ch.value } });
      await db().execute(sql`DELETE FROM mod_fixes WHERE kind = 'review' AND target_id = ${id}`);
      return res.json({ ok: true });
    }
    res.status(400).json({ message: "kind spot|review" });
  });

  // ---------- duplicates: ask the original poster ----------
  const norm = (x: string) => x.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "restaurant", "bar", "grill", "cafe"].includes(w));
  async function candidates(s: Spot) {
    const others = (await storage.namesAt(s.icao, s.id)).filter((x) => x.status === "live");
    const best = findDuplicate(s, others);
    const words = new Set(norm(s.name));
    const scored = others.map((x) => ({ x, score: (best?.id === x.id ? 100 : 0) + norm(x.name).filter((w) => words.has(w)).length * 10
      + (s.lat != null && s.lng != null && x.lat != null && x.lng != null && milesBetween({ lat: s.lat, lon: s.lng }, { lat: x.lat, lon: x.lng }) < 0.1 ? 15 : 0) }))
      .filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    const users = await storage.publicUsers(true);
    const rows = await Promise.all(scored.map(async ({ x }) => {
      const full = await storage.rawSpot(x.id);
      const owner = full?.userId != null ? users.find((u) => u.id === full.userId) : undefined;
      return { id: x.id, name: x.name, address: x.address || "", ownerId: owner?.id ?? null, owner: owner?.displayName || null, ownerHasEmail: !!owner?.email, sameOwner: owner?.id != null && owner.id === s.userId };
    }));
    return rows;
  }

  /** Extra info for the admin queue: duplicate candidates and any question already sent to an owner. */
  app.get("/api/admin/moderation/extras", o.requireAdmin, async (_req, res) => {
    const q = await storage.modReviewList();
    const dups = q.spots.filter((s: any) => problemOf(s.modNote) === "duplicate" && s.status !== "rejected");
    const out: Record<number, any> = {};
    for (const s of dups) {
      const full = await storage.rawSpot(s.id); if (!full) continue;
      const n = (await db().execute(sql`SELECT n.id, n.status, n.decision, n.created_at::float8 AS "createdAt", n.spot_id AS "originalId", u.display_name AS owner
        FROM notices n LEFT JOIN users u ON u.id = n.user_id WHERE n.other_id = ${s.id} ORDER BY n.id DESC LIMIT 1`)).rows[0] || null;
      out[s.id] = { candidates: await candidates(full), notice: n };
    }
    res.json({ duplicates: out });
  });

  app.post("/api/admin/moderation/spot/:id/ask-owner", o.requireAdmin, async (req, res) => {
    const dup = await storage.rawSpot(Number(req.params.id));
    const orig = await storage.rawSpot(Number(req.body?.originalId));
    if (!dup || !orig || orig.status !== "live") return res.status(404).json({ message: "Pick the original listing" });
    if (dup.status === "live" && !dup.pendingEdit) return res.status(400).json({ message: "This listing is already live" });
    if (orig.userId == null) return res.status(400).json({ message: "The original has no owner to ask. Decide it here." });
    const owner = (await storage.publicUsers(true)).find((u) => u.id === orig.userId);
    if (!owner) return res.status(400).json({ message: "The original poster's account is gone. Decide it here." });
    await closeDuplicateNotices(dup.id, "replaced");
    const row = (await db().execute(sql`INSERT INTO notices (user_id, kind, spot_id, other_id, status, created_at) VALUES (${owner.id}, 'duplicate', ${orig.id}, ${dup.id}, 'open', ${Date.now()}) RETURNING id`)).rows[0] as any;
    await storage.logMod({ kind: "spot", targetId: dup.id, actor: "admin", action: "ask_owner", reason: o.byAdmin(req, `Asked ${owner.displayName} whether this is the same place as ${orig.name}`) });
    let emailed = false;
    if (owner.email) {
      const link = "https://getwheelsdown.com/#/me";
      emailed = await sendEmail(owner.email, `Is this the same place as your ${orig.name} listing?`,
        `Hi ${owner.displayName},\n\nSomeone added "${dup.name}" at ${dup.icao}, which looks like your listing "${orig.name}". You know the place best, so it's your call: same place, or two different places.\n\nOpen your Logbook to decide: ${link}\n\nWheelsdown`).then((r) => !!r).catch(() => false);
    }
    res.json({ ok: true, id: row.id, owner: owner.displayName, emailed });
  });

  // ---------- the owner's side ----------
  app.get("/api/me/notices", o.requireUser, async (req, res) => {
    const me = (req as any).user as { id: number };
    const rows = (await db().execute(sql`SELECT n.id, n.kind, n.created_at::float8 AS "createdAt",
        o.id AS "origId", o.name AS "origName", o.icao AS "origIcao", o.address AS "origAddress",
        d.id AS "dupId", d.name AS "dupName", d.address AS "dupAddress", d.description AS "dupDescription", d.website AS "dupWebsite", d.submitted_by AS "dupBy"
      FROM notices n JOIN spots o ON o.id = n.spot_id JOIN spots d ON d.id = n.other_id
      WHERE n.user_id = ${me.id} AND n.status = 'open' ORDER BY n.id DESC LIMIT 20`)).rows;
    res.json(rows);
  });
  app.post("/api/notices/:id", o.requireUser, async (req, res) => {
    const me = (req as any).user as { id: number; displayName: string };
    const decision = String(req.body?.decision || "");
    if (!["same", "different", "unsure"].includes(decision)) return res.status(400).json({ message: "decision same|different|unsure" });
    const n = (await db().execute(sql`SELECT * FROM notices WHERE id = ${Number(req.params.id)} AND user_id = ${me.id} AND status = 'open'`)).rows[0] as any;
    if (!n) return res.status(404).json({ message: "This question was already answered or withdrawn." });
    const orig = await storage.rawSpot(n.spot_id), dup = await storage.rawSpot(n.other_id);
    if (!orig || !dup) { await db().execute(sql`UPDATE notices SET status = 'closed', decision = 'gone', resolved_at = ${Date.now()} WHERE id = ${n.id}`); return res.json({ ok: true }); }
    const who = me.displayName || "The original poster";
    if (decision === "same") {
      // the copy comes down; ratings on it move to the original unless that crew member already rated the original
      const already = new Set((await db().execute(sql`SELECT user_id FROM reviews WHERE spot_id = ${orig.id} AND user_id IS NOT NULL`)).rows.map((r: any) => r.user_id));
      const moved = (await db().execute(sql`SELECT id, user_id FROM reviews WHERE spot_id = ${dup.id}`)).rows.filter((r: any) => r.user_id == null || !already.has(r.user_id)).map((r: any) => Number(r.id));
      if (moved.length) await db().execute(sql`UPDATE reviews SET spot_id = ${orig.id} WHERE id = ANY(${sql.raw("ARRAY[" + moved.join(",") + "]::int[]")})`);
      await storage.setSpotMod(dup.id, { status: "rejected", modState: "rejected", pendingEdit: null, modNote: `[duplicate] ${who} confirmed this is the same place as ${orig.name}, which is already listed. Rate that listing instead.` });
      await storage.logMod({ kind: "spot", targetId: dup.id, actor: "owner", action: "reject", problem: "duplicate", reason: `${who} (original poster): same place as ${orig.name}${moved.length ? `; ${moved.length} rating${moved.length === 1 ? "" : "s"} moved to it` : ""}` });
    } else if (decision === "different") {
      await storage.setSpotMod(dup.id, { status: "live", modState: "approved", modNote: "", modAttempts: 0 });
      await storage.logMod({ kind: "spot", targetId: dup.id, actor: "owner", action: "approve", problem: "duplicate", reason: `${who} (original poster): a different place from ${orig.name}; published` });
    } else {
      await storage.logMod({ kind: "spot", targetId: dup.id, actor: "owner", action: "unsure", problem: "duplicate", reason: `${who} (original poster) isn't sure; left for the admin` });
    }
    await db().execute(sql`UPDATE notices SET status = 'resolved', decision = ${decision}, resolved_at = ${Date.now()} WHERE id = ${n.id}`);
    res.json({ ok: true, decision });
  });
}

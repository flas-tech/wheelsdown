// Trip briefing → PDF (US Letter), built in the browser so nothing leaves the device until the crew shares it.
import type { Airport, SpotWithStats } from "@shared/schema";
import { LAYOVERS } from "@shared/schema";
import { costText, paceLabel, paceOf } from "@shared/cost";
import { fmtMinutes, totalMinutes } from "@/lib/ui";
import { PIN_COLORS, staticMapDataUrl, type MapPin } from "@/lib/staticMap";

export type Sponsor = { id: number; advertiser: string; headline: string; url: string | null } | null;
export type BriefStopFull = {
  icao: string; layover: string; nights?: number; airport: (Airport & { lat?: number | null; lon?: number | null }) | null;
  picks: SpotWithStats[]; candidates?: SpotWithStats[]; sponsor: Sponsor; favoriteIds?: number[];
};
export type BriefFull = { id: number; title: string; shareToken: string; createdAt: number; updatedAt: number; stops: BriefStopFull[] };

export const CAT_NAMES: Record<string, string> = { eat: "Eat", do: "Do", stay: "Stay", fbo: "FBO" };
export const layoverText = (s: { layover: string; nights?: number }) => {
  const l = LAYOVERS.find((x) => x.id === s.layover);
  if (s.layover === "multi" && s.nights) return `${s.nights} nights`;
  return l ? l.label : s.layover;
};
export const routeText = (b: { stops: { icao: string }[] }) => b.stops.map((s) => s.icao).join(" > ");

/** Pins for a stop: airport plus numbered picks that have coordinates. */
export function stopPins(st: BriefStopFull): { pins: MapPin[]; numbered: { n: number; spot: SpotWithStats; mapped: boolean }[] } {
  const pins: MapPin[] = [];
  const numbered = st.picks.map((spot, i) => {
    const mapped = spot.lat != null && spot.lng != null;
    if (mapped) pins.push({ lat: spot.lat!, lng: spot.lng!, label: String(i + 1), kind: spot.category as MapPin["kind"] });
    return { n: i + 1, spot, mapped };
  });
  if (st.airport?.lat != null && st.airport?.lon != null) pins.push({ lat: st.airport.lat, lng: st.airport.lon, label: st.icao, kind: "airport" });
  return { pins, numbered };
}

const airportLine = (s: BriefStopFull, sep: string, region = false) => {
  if (!s.airport) return "";
  const name = clean(s.airport.name) || s.icao, city = clean(s.airport.city), reg = region ? clean(s.airport.region) : "";
  return `${name}${city && city !== name ? `${sep}${city}` : ""}${reg ? `, ${reg}` : ""}`;
};

// jsPDF's built-in fonts are WinAnsi: map common typography and drop anything else so text never garbles.
const clean = (t: unknown) => String(t ?? "")
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, "...").replace(/\u2192|\u203A/g, ">")
  .replace(/[\u2013\u2014]/g, "-").replace(/\u00B7/g, "·").replace(/[^\x20-\x7E\u00A0-\u00FF·]/g, "").trim();

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export async function buildBriefPdf(b: BriefFull, opts: { appUrl: string; preparedBy?: string }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 612, H = 792, M = 40, CW = W - M * 2;
  const navy: [number, number, number] = [11, 18, 34], amber: [number, number, number] = [245, 197, 24], slate: [number, number, number] = [71, 85, 105];
  const title = clean(b.title) || `Trip briefing ${routeText(b)}`;

  const footer = (page: number) => {
    doc.setDrawColor(226, 232, 240); doc.line(M, H - 40, W - M, H - 40);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...slate);
    doc.text("Crew-sourced via getwheelsdown.com. Verify hours, prices and access before you go. Map data © OpenStreetMap contributors.", M, H - 28);
    doc.text(`Page ${page}`, W - M, H - 28, { align: "right" });
  };
  const brandBar = () => {
    doc.setFillColor(...navy); doc.rect(0, 0, W, 34, "F");
    doc.setFillColor(...amber); doc.rect(0, 34, W, 3, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
    doc.text("WHEELS", M, 22); const w1 = doc.getTextWidth("WHEELS");
    doc.setTextColor(...amber); doc.text("DOWN", M + w1, 22);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(203, 213, 225);
    doc.text("CREW TRIP BRIEFING", W - M, 22, { align: "right" });
  };

  // ---------- cover ----------
  brandBar();
  doc.setTextColor(...navy); doc.setFont("helvetica", "bold"); doc.setFontSize(22);
  const tLines = doc.splitTextToSize(title, CW);
  doc.text(tLines, M, 78);
  let y = 78 + tLines.length * 24;
  doc.setFont("courier", "bold"); doc.setFontSize(15); doc.setTextColor(...navy);
  doc.text(clean(routeText(b)), M, y); y += 18;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...slate);
  doc.text(clean(`Prepared ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}${opts.preparedBy ? ` by ${opts.preparedBy}` : ""}`), M, y); y += 16;

  // overview map
  const ovPins: MapPin[] = b.stops.filter((s) => s.airport?.lat != null && s.airport?.lon != null).map((s) => ({ lat: s.airport!.lat!, lng: s.airport!.lon!, label: s.icao, kind: "airport" as const }));
  const mapH = 250;
  const ov = ovPins.length ? await staticMapDataUrl(ovPins, CW, mapH, { route: true }) : null;
  if (ov) { doc.addImage(ov, "JPEG", M, y, CW, mapH); doc.setDrawColor(203, 213, 225); doc.rect(M, y, CW, mapH); y += mapH + 22; }

  // stop table (continues on extra pages for long trips)
  let page = 1;
  const tableHead = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...slate);
    doc.text("STOP", M, y); doc.text("AIRPORT", M + 60, y); doc.text("ON THE GROUND", M + 330, y); doc.text("PICKS", W - M, y, { align: "right" });
    y += 6; doc.setDrawColor(203, 213, 225); doc.line(M, y, W - M, y); y += 15;
  };
  tableHead();
  b.stops.forEach((s, i) => {
    if (y > H - 70) { footer(page); doc.addPage(); page++; brandBar(); y = 70; tableHead(); }
    doc.setFont("courier", "bold"); doc.setFontSize(11); doc.setTextColor(...navy); doc.text(`${i + 1}. ${s.icao}`, M, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    const ap = airportLine(s, ", ");
    const lines = (doc.splitTextToSize(ap, 255) as string[]).slice(0, 2);
    doc.text(lines, M + 60, y);
    doc.text(clean(layoverText(s)), M + 330, y);
    doc.text(String(s.picks.length), W - M, y, { align: "right" });
    y += 18 + (lines.length - 1) * 11;
  });
  y += 8;
  if (y > H - 80) { footer(page); doc.addPage(); page++; brandBar(); y = 70; }
  doc.setFontSize(8.5); doc.setTextColor(...slate);
  doc.text(doc.splitTextToSize("Picks come from crew ratings, up/down vetting and crew-reported prices on Wheelsdown. Favorites saved by the crew member who built this briefing are always included. Each stop page lists the picks in map order with the top crew tip.", CW), M, y);
  footer(page);

  // ---------- one page per stop ----------
  for (const s of b.stops) {
    const favs = new Set(s.favoriteIds || []);
    doc.addPage(); page++;
    brandBar();
    let yy = 66;
    doc.setFont("courier", "bold"); doc.setFontSize(20); doc.setTextColor(...navy);
    doc.text(s.icao, M, yy);
    const cw = doc.getTextWidth(s.icao);
    // layover pill (measured first so the airport name never runs under it)
    const lt = clean(layoverText(s)).toUpperCase();
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    const lw = doc.getTextWidth(lt) + 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...slate);
    const apText = airportLine(s, " · ", true);
    const apMax = W - M - lw - 10 - (M + cw + 10);
    const apFit = (doc.splitTextToSize(apText, apMax) as string[]);
    doc.text(apFit.length > 1 ? apFit[0].replace(/[\s,·-]+$/, "") + "..." : apFit[0] || "", M + cw + 10, yy - 1);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.setFillColor(...amber); doc.roundedRect(W - M - lw, yy - 12, lw, 16, 3, 3, "F");
    doc.setTextColor(...navy); doc.text(lt, W - M - lw / 2, yy - 1, { align: "center" });
    yy += 14;

    const { pins, numbered } = stopPins(s);
    const mh = 270;
    const img = pins.length ? await staticMapDataUrl(pins, CW, mh) : null;
    if (img) { doc.addImage(img, "JPEG", M, yy, CW, mh); doc.setDrawColor(203, 213, 225); doc.rect(M, yy, CW, mh); yy += mh + 18; }
    else yy += 8;

    if (!numbered.length) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...slate);
      doc.text(doc.splitTextToSize(`No crew picks at ${s.icao} yet. Add the places you use at getwheelsdown.com so the next crew has them.`, CW), M, yy);
      yy += 30;
    }

    for (const { n, spot, mapped } of numbered) {
      const tip = clean(spot.crewTip || spot.description || "");
      const tipLines = tip ? doc.splitTextToSize(tip, CW - 30).slice(0, 2) : [];
      const need = 34 + tipLines.length * 11;
      if (yy + need > H - 90) { // continue on a new page
        footer(page); doc.addPage(); page++; brandBar(); yy = 64;
        doc.setFont("courier", "bold"); doc.setFontSize(12); doc.setTextColor(...navy); doc.text(`${s.icao} (continued)`, M, yy); yy += 18;
      }
      // number badge
      doc.setFillColor(...hex(PIN_COLORS[spot.category as MapPin["kind"]] || "#475569"));
      doc.circle(M + 9, yy - 4, 9, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text(String(n), M + 9, yy - 0.8, { align: "center" });
      // name + meta
      doc.setTextColor(...navy); doc.setFontSize(11.5);
      const nm = clean(spot.name) || `Listing ${spot.id} (name in non-Latin script, see link)`;
      const fav = favs.has(spot.id);
      let nx = M + 26;
      if (fav) { // small rose tag before the name
        doc.setFont("helvetica", "bold"); doc.setFontSize(6.5);
        const fw = doc.getTextWidth("FAVORITE") + 8;
        doc.setFillColor(225, 29, 72); doc.roundedRect(nx, yy - 8.5, fw, 11, 2, 2, "F");
        doc.setTextColor(255, 255, 255); doc.text("FAVORITE", nx + fw / 2, yy - 0.8, { align: "center" });
        nx += fw + 6; doc.setFontSize(11.5); doc.setTextColor(...navy);
      }
      const nmLines = doc.splitTextToSize(nm, CW - 150 - (nx - M - 26)) as string[];
      doc.text(nmLines.length > 1 ? nmLines[0].replace(/[\s,.-]+$/, "") + "..." : nmLines[0], nx, yy);
      const right = [costText(spot), spot.avgRating ? `${spot.avgRating.toFixed(1)}/5 (${spot.reviewCount})` : "Not rated"].filter(Boolean).join("  ·  ");
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...slate);
      doc.text(clean(right), W - M, yy, { align: "right" });
      yy += 13;
      const meta = [
        CAT_NAMES[spot.category] || spot.category,
        spot.milesFromField ? `${spot.milesFromField} mi from field` : "On field",
        spot.category === "eat" ? paceLabel(paceOf(spot)) : spot.category === "do" ? fmtMinutes(totalMinutes(spot)) : "",
        spot.address || "",
        mapped ? "" : "(not on map)",
      ].filter(Boolean).join("  ·  ");
      doc.setFontSize(8.5);
      doc.text(doc.splitTextToSize(clean(meta), CW - 30)[0], M + 26, yy);
      yy += 11;
      if (tipLines.length) {
        doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "italic");
        doc.text(tipLines, M + 26, yy); yy += tipLines.length * 11;
        doc.setFont("helvetica", "normal");
      }
      doc.setTextColor(37, 99, 235); doc.setFontSize(8);
      const link = `${opts.appUrl}#/spot/${spot.id}`;
      doc.textWithLink("Crew reviews on Wheelsdown", M + 26, yy, { url: link });
      yy += 18;
    }

    // one sponsor line per stop
    if (s.sponsor) {
      const sy = H - 62;
      doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); doc.roundedRect(M, sy - 13, CW, 20, 3, 3, "FD");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...slate); doc.text("SPONSORED", M + 8, sy);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...navy);
      const st = clean(`${s.sponsor.advertiser} - ${s.sponsor.headline}`);
      const tx = M + 62;
      doc.text(doc.splitTextToSize(st, CW - 70)[0], tx, sy);
      if (s.sponsor.url && /^https?:/.test(s.sponsor.url)) doc.link(M, sy - 13, CW, 20, { url: s.sponsor.url });
    }
    footer(page);
  }

  const fileName = `Wheelsdown-${b.stops.map((s) => s.icao).join("-")}.pdf`;
  return { blob: doc.output("blob") as Blob, fileName };
}

/** iPhone: open the Share sheet with the PDF (Messages, Mail, AirDrop). Elsewhere: download. */
export async function shareOrDownload(blob: Blob, fileName: string, title: string) {
  const file = new File([blob], fileName, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return "shared" as const; }
    catch (e) { if ((e as Error).name === "AbortError") return "cancelled" as const; }
  }
  const url = URL.createObjectURL(blob);
  // iOS home-screen apps ignore the download attribute; open the PDF so the system viewer's Share button works
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  if (standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) { window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 120_000); return "downloaded" as const; }
  const a = document.createElement("a");
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded" as const;
}

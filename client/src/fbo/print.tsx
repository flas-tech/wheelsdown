import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import QRCode from "qrcode";
import { Printer, Download, ArrowLeft, Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FBO_CAT_LABEL, type FboPlace } from "@shared/fbo";
import { api, get } from "./api";
import { useMe } from "./App";
import { Card, PageHeader, btn, btnPrimary } from "./ui";

const NAVY = "#0B1222", GOLD = "#F5B700", INK = "#141B2D";

function useQrSvg(url: string) {
  const [svg, setSvg] = useState("");
  useEffect(() => { QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: NAVY, light: "#FFFFFF" } }).then(setSvg).catch(() => setSvg("")); }, [url]);
  return svg;
}
function Qr({ svg, size }: { svg: string; size: string }) {
  return <div style={{ width: size, height: size, background: "#fff" }} className="[&>svg]:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
function MiniLogo({ size = 14, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" aria-hidden>
      <path d="M20 5v12M15 12.5l5 5 5-5" stroke={GOLD} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="26" r="4" stroke={GOLD} strokeWidth="3" /><circle cx="26" cy="26" r="4" stroke={GOLD} strokeWidth="3" />
      <path d="M5 34h30" stroke={light ? "#fff" : INK} strokeWidth="2.6" strokeLinecap="round" strokeDasharray="4.5 3" />
    </svg>
  );
}
const shortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\?.*$/, "");

/** 3.5 x 2 in business card. Everything sized in inches/points so it prints true to size. */
export function BusinessCard({ svg, name, icao, airport, url, cut = false }: { svg: string; name: string; icao: string; airport: string; url: string; cut?: boolean }) {
  const long = name.length > 26;
  return (
    <div style={{ width: "3.5in", height: "2in", background: "#fff", color: INK, position: "relative", overflow: "hidden", fontFamily: '"General Sans", system-ui, sans-serif', outline: cut ? "0.5px dashed #b8bec8" : undefined, outlineOffset: cut ? "-0.25px" : undefined }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "0.09in", background: GOLD }} />
      <div style={{ position: "absolute", left: "0.24in", top: "0.18in", width: "1.85in", bottom: "0.16in", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4pt", fontSize: "6.5pt", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}><MiniLogo size={11} />Wheelsdown</div>
        <div style={{ marginTop: "7pt", fontSize: long ? "11pt" : "13pt", fontWeight: 700, lineHeight: 1.1 }}>{name}</div>
        <div style={{ marginTop: "2pt", fontSize: "7pt", color: "#4A5262", lineHeight: 1.2 }}>{icao}{airport ? ` · ${airport}` : ""}</div>
        <div style={{ marginTop: "auto", fontSize: "8.5pt", fontWeight: 600, lineHeight: 1.2 }}>Crew picks: where to eat, where to stay, crew discounts</div>
        <div style={{ marginTop: "3pt", fontSize: "6.5pt", color: "#4A5262" }}>What to do when you get wheels down.</div>
      </div>
      <div style={{ position: "absolute", right: "0.18in", top: "0.2in", width: "1.22in", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Qr svg={svg} size="1.22in" />
        <div style={{ marginTop: "4pt", fontSize: "6pt", fontWeight: 600, letterSpacing: "0.02em" }}>Scan with your camera</div>
        <div style={{ fontSize: "5pt", color: "#6B7383", maxWidth: "1.3in", textAlign: "center", lineHeight: 1.25, overflowWrap: "anywhere" }}>{(() => { const u = shortUrl(url); const i = u.indexOf("/"); return i > 0 ? <>{u.slice(0, i)}<br />{u.slice(i)}</> : u; })()}</div>
      </div>
    </div>
  );
}

/** US Letter counter sign. */
export function Poster({ svg, name, icao, airport, url, favorites, offers }: { svg: string; name: string; icao: string; airport: string; url: string; favorites: FboPlace[]; offers: number }) {
  return (
    <div style={{ width: "8.5in", height: "11in", background: "#fff", color: INK, position: "relative", overflow: "hidden", fontFamily: '"General Sans", system-ui, sans-serif' }}>
      <div style={{ background: NAVY, color: "#fff", padding: "0.55in 0.6in 0.5in", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7pt", fontSize: "11pt", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}><MiniLogo size={24} light />Wheelsdown</div>
        <div style={{ marginTop: "0.3in", display: "inline-block", background: GOLD, color: INK, fontWeight: 700, fontSize: "11pt", letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: "999px", padding: "3pt 11pt" }}>Crew picks from the FBO</div>
        <div style={{ marginTop: "10pt", fontSize: name.length > 28 ? "34pt" : "42pt", fontWeight: 700, lineHeight: 1.04 }}>{name}</div>
        <div style={{ marginTop: "6pt", fontSize: "14pt", color: "#C9D1DE" }}>{icao}{airport ? ` · ${airport}` : ""}</div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "0.1in", background: GOLD }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "0.4in" }}>
        <div style={{ fontSize: "22pt", fontWeight: 700 }}>Where to eat. Where to stay.</div>
        <div style={{ fontSize: "13pt", color: "#4A5262", marginTop: "3pt" }}>Scan with your phone camera{offers ? " for our recommendations and crew discounts" : " for our recommendations"}</div>
        <div style={{ marginTop: "0.28in", padding: "0.16in", border: `3pt solid ${NAVY}`, borderRadius: "0.18in" }}><Qr svg={svg} size="3.6in" /></div>
        <div style={{ marginTop: "8pt", fontSize: "11pt", fontWeight: 600 }}>{shortUrl(url)}</div>
      </div>
      {favorites.length > 0 && (
        <div style={{ margin: "0.3in 0.6in 0", borderTop: "1px solid #E2E5EA", paddingTop: "0.16in" }}>
          <div style={{ fontSize: "10pt", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7383" }}>A few of our favorites</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: "0.3in", rowGap: "5pt", marginTop: "7pt" }}>
            {favorites.slice(0, 6).map((p) => (
              <div key={p.id} style={{ fontSize: "12pt", lineHeight: 1.25 }}><b>{p.name}</b> <span style={{ color: "#6B7383", fontSize: "10pt" }}>{FBO_CAT_LABEL[p.category]}{p.crewRate ? ` · ${p.crewRate}` : ""}</span></div>
            ))}
          </div>
        </div>
      )}
      <div style={{ position: "absolute", left: "0.6in", right: "0.6in", bottom: "0.45in", display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: "10pt", color: "#4A5262" }}>
        <span style={{ fontWeight: 600, color: INK }}>What to do when you get wheels down.</span>
        <span>Recommendations provided by {name}</span>
      </div>
    </div>
  );
}

function usePrintData() {
  const { me } = useMe();
  const { data: places } = useQuery<FboPlace[]>({ queryKey: ["/api/fbo/places"], queryFn: get("/api/fbo/places") });
  const { data: stats } = useQuery<{ offers: number }>({ queryKey: ["/api/fbo/stats"], queryFn: get("/api/fbo/stats") });
  const a = me.account;
  const svg = useQrSvg(a.qrUrl);
  const favorites = (places || []).filter((p) => p.favorite && !p.hidden);
  return { svg, name: a.name, icao: a.icao, airport: a.airportName, url: a.qrUrl, favorites, offers: stats?.offers || 0 };
}

function Scaled({ w, h, scale, children }: { w: number; h: number; scale: number; children: ReactNode }) {
  // w/h in inches at 96 px/in
  return (
    <div style={{ width: w * 96 * scale, height: h * 96 * scale }} className="overflow-hidden rounded-md shadow-md ring-1 ring-border">
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: w * 96, height: h * 96 }}>{children}</div>
    </div>
  );
}

export function QrPage() {
  const { me } = useMe();
  const d = usePrintData();
  const { toast } = useToast();
  const logged = (kind: string) => api("POST", "/api/fbo/printed", { kind }).catch(() => {});
  const dlSvg = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([d.svg], { type: "image/svg+xml" })); a.download = `${me.account.slug}-qr.svg`; a.click(); logged("qr_svg"); };
  const dlPng = async () => { const url = await QRCode.toDataURL(me.account.qrUrl, { width: 1200, margin: 2, errorCorrectionLevel: "M", color: { dark: NAVY, light: "#FFFFFF" } }); const a = document.createElement("a"); a.href = url; a.download = `${me.account.slug}-qr.png`; a.click(); logged("qr_png"); };
  const copy = async () => { try { await navigator.clipboard.writeText(me.account.publicUrl); toast({ title: "Link copied" }); } catch { /* */ } };
  return (
    <>
      <PageHeader title="QR & print" sub="Your QR code opens your crew page on any phone, no app or sign-in needed. It never changes, so anything you print keeps working when you update your picks." />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="flex flex-col items-center text-center">
          {d.svg && <Qr svg={d.svg} size="200px" />}
          <p className="mt-3 break-all text-xs text-muted-foreground" data-testid="text-public-url">{me.account.publicUrl}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button className={btn} onClick={dlPng} data-testid="button-download-png"><Download className="h-4 w-4" />PNG</button>
            <button className={btn} onClick={dlSvg} data-testid="button-download-svg"><Download className="h-4 w-4" />SVG</button>
            <button className={btn} onClick={copy}><Copy className="h-4 w-4" />Copy link</button>
          </div>
          <a href={me.account.publicUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs underline"><ExternalLink className="h-3 w-3" />Open crew page</a>
          <p className="mt-3 text-[11px] text-muted-foreground">Use the PNG or SVG in your own signage. Scans from printed codes are counted separately from shared links.</p>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col">
            <p className="text-sm font-semibold">Business card</p>
            <p className="text-xs text-muted-foreground">3.5 × 2 in. One card per page, for a print shop or card printer.</p>
            <div className="my-4 flex flex-1 items-center justify-center"><Scaled w={3.5} h={2} scale={0.78}><BusinessCard {...d} /></Scaled></div>
            <Link href="/print/card" className={btnPrimary} data-testid="link-print-card"><Printer className="h-4 w-4" />Print or save PDF</Link>
          </Card>
          <Card className="flex flex-col">
            <p className="text-sm font-semibold">Sheet of 10 cards</p>
            <p className="text-xs text-muted-foreground">US Letter. Lines up with Avery 8371/5371 business-card sheets, or plain paper with cut lines.</p>
            <div className="my-4 flex flex-1 items-center justify-center"><Scaled w={8.5} h={11} scale={0.26}><CardSheet {...d} cut /></Scaled></div>
            <Link href="/print/sheet" className={btnPrimary} data-testid="link-print-sheet"><Printer className="h-4 w-4" />Print or save PDF</Link>
          </Card>
          <Card className="flex flex-col md:col-span-2 md:flex-row md:items-center md:gap-6">
            <div className="flex justify-center md:order-2"><Scaled w={8.5} h={11} scale={0.3}><Poster {...d} /></Scaled></div>
            <div className="mt-3 flex-1 md:mt-0">
              <p className="text-sm font-semibold">Full-page counter sign</p>
              <p className="text-xs text-muted-foreground">US Letter, for the front desk, crew lounge or a frame. Shows up to six of your starred favorites.</p>
              {!d.favorites.length && <p className="mt-2 text-xs text-muted-foreground">Star a few favorites on the Recommendations page to list them on the sign.</p>}
              <Link href="/print/poster" className={cn(btnPrimary, "mt-4")} data-testid="link-print-poster"><Printer className="h-4 w-4" />Print or save PDF</Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function CardSheet(props: Parameters<typeof BusinessCard>[0]) {
  return (
    <div style={{ width: "8.5in", height: "11in", background: "#fff", paddingTop: "0.5in", paddingLeft: "0.75in", boxSizing: "border-box" }}>
      <div style={{ display: "grid", gridTemplateColumns: "3.5in 3.5in", gridAutoRows: "2in" }}>
        {Array.from({ length: 10 }, (_, i) => <BusinessCard key={i} {...props} />)}
      </div>
    </div>
  );
}

const PAGE: Record<string, { size: string; w: number; h: number; label: string }> = {
  card: { size: "3.5in 2in", w: 3.5, h: 2, label: "Business card" },
  sheet: { size: "letter", w: 8.5, h: 11, label: "Sheet of 10 cards" },
  poster: { size: "letter", w: 8.5, h: 11, label: "Counter sign" },
};

export function PrintPage({ kind }: { kind: string }) {
  const k = PAGE[kind] ? kind : "card";
  const d = usePrintData();
  const [cut, setCut] = useState(true);
  useEffect(() => { document.title = `${d.name} · ${PAGE[k].label}`; return () => { document.title = "Wheelsdown for FBOs"; }; }, [d.name, k]);
  const print = () => { api("POST", "/api/fbo/printed", { kind: k }).catch(() => {}); window.print(); };
  const body = k === "card" ? <BusinessCard {...d} /> : k === "sheet" ? <CardSheet {...d} cut={cut} /> : <Poster {...d} />;
  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <style>{`@page { size: ${PAGE[k].size}; margin: 0; } @media print { html, body { background: #fff !important; } .print-area { box-shadow: none !important; margin: 0 !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-3 print:hidden">
        <Link href="/qr" className={btn}><ArrowLeft className="h-4 w-4" />Back</Link>
        <p className="text-sm font-semibold">{PAGE[k].label}</p>
        {k === "sheet" && <label className="ml-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} className="h-4 w-4" />Cut lines (plain paper)</label>}
        <div className="ml-auto flex items-center gap-3">
          <p className="hidden text-xs text-muted-foreground md:block">In the print dialog choose "Save as PDF" for a file, set scale to 100% (Actual size), and turn off headers and footers.</p>
          <button className={btnPrimary} onClick={print} disabled={!d.svg} data-testid="button-print"><Printer className="h-4 w-4" />Print / Save PDF</button>
        </div>
      </div>
      <div className="flex justify-center overflow-auto p-6 print:block print:p-0">
        <div className="print-area shadow-lg" style={{ width: `${PAGE[k].w}in`, height: `${PAGE[k].h}in` }} data-testid="print-area">{body}</div>
      </div>
    </div>
  );
}

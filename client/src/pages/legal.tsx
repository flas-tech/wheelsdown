// Terms, Privacy, Community Guidelines and About/Advertise.
// DRAFT TEXT: have an attorney review before public launch. Set VITE_OPERATOR_NAME at build time to the legal entity that runs the site.
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { IS_STATIC } from "@/lib/queryClient";

const OPERATOR = (import.meta.env.VITE_OPERATOR_NAME as string) || "the operator of Wheelsdown";
const UPDATED = "October 6, 2026";

function useContact() {
  const { data } = useQuery<{ contactEmail: string }>({ queryKey: ["/api/config"], enabled: !IS_STATIC });
  return data?.contactEmail || "";
}
function Mail({ subject }: { subject?: string }) {
  const c = useContact();
  if (!c) return <span>the contact address listed on our About page</span>;
  return <a className="underline" href={`mailto:${c}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`}>{c}</a>;
}

const Page = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <article className="prose-sm max-w-2xl space-y-4 text-sm leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_h2]:pt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1" data-testid={`page-${title.toLowerCase().replace(/\s+/g, "-")}`}>
    <header>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-xs text-muted-foreground mt-1">Last updated {UPDATED}</p>
    </header>
    {children}
    <nav className="pt-6 flex flex-wrap gap-4 text-xs text-muted-foreground">
      <Link href="/terms" className="underline">Terms</Link>
      <Link href="/privacy" className="underline">Privacy</Link>
      <Link href="/guidelines" className="underline">Community Guidelines</Link>
      <Link href="/about" className="underline">About & Advertise</Link>
    </nav>
  </article>
);

function Terms() {
  return (
    <Page title="Terms of Use">
      <p>Wheelsdown is a crew-sourced guide to places to eat, things to do, places to stay and FBO notes, run by {OPERATOR}. By creating an account or posting, you agree to these terms.</p>
      <h2>Crew-sourced information</h2>
      <p>Listings, ratings and comments come from users. Hours, prices, distances and conditions change. Always confirm before you go. Wheelsdown is not a source of operational, flight-planning, safety or regulatory information, and nothing here replaces your company's procedures, crew rest requirements or official publications.</p>
      <h2>Your account</h2>
      <ul>
        <li>You must be at least 18 to create an account.</li>
        <li>Keep your password private. You're responsible for activity on your account.</li>
        <li>You can change your display name, position, posting preference and email, or delete your account at any time from your Logbook.</li>
      </ul>
      <h2>What you post</h2>
      <p>You keep ownership of what you post. You give {OPERATOR} a worldwide, royalty-free licence to host, display, edit for length or formatting, and distribute it as part of Wheelsdown. Posts must follow the <Link href="/guidelines" className="underline">Community Guidelines</Link>. We may hide, edit or remove content, adjust points, or suspend accounts that break them.</p>
      <h2>Points and status</h2>
      <p>Points and status levels recognise participation. They have no cash value, can't be transferred, and may be adjusted to correct errors or abuse. Perks marked "planned" are not yet offered.</p>
      <h2>Advertising</h2>
      <p>Sponsored placements are labelled "Sponsored." Advertisers are responsible for their own offers.</p>
      <h2>No warranty; limitation of liability</h2>
      <p>Wheelsdown is provided "as is." To the extent the law allows, {OPERATOR} is not liable for losses arising from your use of the service or reliance on user content.</p>
      <h2>Changes and contact</h2>
      <p>We may update these terms and will change the date above when we do. Questions: <Mail subject="Terms question" />.</p>
    </Page>
  );
}

function Privacy() {
  return (
    <Page title="Privacy Policy">
      <p>This policy explains what Wheelsdown collects and why. Short version: we collect the minimum needed to run a crew-sourced guide, we don't sell personal data, and you can delete your account at any time.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> handle, display name, position (Pilot, Flight Attendant, Mechanic, Other), optional home base, optional email (used only for password reset and important account notices), and a hashed password. We never store your password in readable form.</li>
        <li><b>Contributions:</b> listings, ratings, comments and votes, and the points they earn.</li>
        <li><b>Posting preference:</b> if you choose Anonymous, your name is replaced on your posts and on the public leaderboard. Site administrators can still see which account made a post, for moderation.</li>
        <li><b>Technical:</b> standard server logs (IP address, time, page requested) kept for security and troubleshooting, and counts of ad views and clicks. Ad counts aren't tied to your account.</li>
        <li><b>Usage counts:</b> daily totals of visits, pages viewed, airports searched, listings opened, and taps to a business's website or map, so we can show sponsors how much the site is used. We count unique devices with a scrambled, random device code that isn't tied to your name, and report only totals to advertisers, never individual activity.</li>
      </ul>
      <h2>What we don't do</h2>
      <ul>
        <li>We don't sell or rent personal data.</li>
        <li>We don't use third-party advertising trackers. If that changes, for example by adding an ad network, we'll update this policy first and ask for consent where the law requires it.</li>
        <li>We don't collect your precise location. Searches use the airport codes you type.</li>
      </ul>
      <h2>Where data is stored</h2>
      <p>Data is stored with our hosting and database providers in the United States. Password-reset emails are sent through a transactional email provider.</p>
      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile and posting preference in your Logbook at any time.</li>
        <li><b>Delete your account</b> from your Logbook. This deletes your account, sign-ins, ratings, comments and votes. Listings you added stay up as community content and are shown as "Former crew member."</li>
        <li>For a copy of your data, or other requests, contact <Mail subject="Privacy request" />.</li>
      </ul>
      <h2>Children</h2>
      <p>Wheelsdown is for adults working in aviation and isn't directed at children under 13.</p>
    </Page>
  );
}

function Guidelines() {
  return (
    <Page title="Community Guidelines">
      <p>Wheelsdown is only useful if crews can trust it. Post the way you'd brief the crew taking over your trip.</p>
      <h2>Do</h2>
      <ul>
        <li>Post places you've actually been, with details that matter on a layover: time needed, distance from the field, crew discounts, late hours.</li>
        <li>Vote listings up when they're still good, and down with a reason when they've closed, moved or changed.</li>
        <li>Keep FBO notes factual: services, wait times, amenities, how the staff treated you.</li>
      </ul>
      <h2>Don't</h2>
      <ul>
        <li>Post anything that identifies passengers, owners, tail numbers tied to specific trips, schedules, or other confidential operational details.</li>
        <li>Name or harass individual employees. Review the business, not the person.</li>
        <li>Post spam, undisclosed ads, or listings for your own business without saying so.</li>
        <li>Encourage anything unsafe, illegal, or against crew rest and alcohol rules.</li>
        <li>Game points with fake accounts or vote trading. We remove points and accounts that do.</li>
      </ul>
      <h2>Reporting</h2>
      <p>Downvote a listing with a reason; enough reports pull it for review automatically. For anything urgent, email <Mail subject="Content report" />.</p>
    </Page>
  );
}

function About() {
  const c = useContact();
  return (
    <Page title="About Wheelsdown">
      <p>Wheelsdown is a crew-sourced layover guide. Search your whole trip by airport code (IATA or ICAO), filter by how much time you have and what it costs, and see what other crews actually rate, vote up, and vet.</p>
      <h2>Advertise with us</h2>
      <p>Hotels with crew rates, restaurants near the field, FBOs, ground transport and crew-friendly brands can sponsor placements network-wide or at specific airports. Every sponsored placement is clearly labelled.</p>
      <p>{c ? <a className="inline-flex h-10 items-center rounded-full taxi-sign px-5 font-semibold" href={`mailto:${c}?subject=Advertising%20on%20Wheelsdown`} data-testid="link-advertise">Email {c}</a> : "Advertising contact coming soon."}</p>
      <h2>Contact</h2>
      <p>General questions, corrections and partnership ideas: <Mail subject="Hello" />.</p>
    </Page>
  );
}

export default function LegalPage() {
  const [, p] = useRoute("/:page");
  const page = p?.page;
  if (page === "privacy") return <Privacy />;
  if (page === "guidelines") return <Guidelines />;
  if (page === "about") return <About />;
  return <Terms />;
}

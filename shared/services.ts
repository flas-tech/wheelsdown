// Outside services Wheelsdown runs on, for the admin console. Prices checked October 7, 2026; confirm in each provider's billing page.
export type Service = {
  id: string; name: string; role: string; what: string; plan: string;
  monthly: number | null; // fixed monthly cost in USD; null = usage-based (see note)
  costText: string; note?: string;
  dashboard: string; pricing: string;
};
export const SERVICES: Service[] = [
  {
    id: "render", name: "Render", role: "App hosting",
    what: "Runs the Wheelsdown server and serves getwheelsdown.com and www. Builds and deploys each update from GitHub.",
    plan: "Starter web service (512 MB RAM, 0.5 CPU), Virginia",
    monthly: 7, costText: "$7/month", note: "Workspace fee is $0 on the Hobby workspace plan; confirm under Billing.",
    dashboard: "https://dashboard.render.com/web/srv-db2l6oh42hec738u4r3g", pricing: "https://render.com/pricing",
  },
  {
    id: "supabase", name: "Supabase", role: "Database",
    what: "Postgres database holding listings, ratings, crew accounts, points, favorites, briefings, moderation log and usage counts.",
    plan: "Pro plan (organization flas-tech's Org), project wheelsdown, us-east-1",
    monthly: 25, costText: "$25/month", note: "Includes $10 of compute credit (covers one Micro database), 8 GB disk and 250 GB transfer. Extra disk $0.125/GB, transfer $0.09/GB.",
    dashboard: "https://supabase.com/dashboard/project/lwhobdawreebbbnyrfew", pricing: "https://supabase.com/pricing",
  },
  {
    id: "cloudflare", name: "Cloudflare", role: "Domain, DNS and email forwarding",
    what: "Registers getwheelsdown.com, answers DNS for it, and forwards hello@ and ads@getwheelsdown.com to your Gmail.",
    plan: "Free plan; Registrar at cost; Email Routing on",
    monthly: 0.9, costText: "About $10–12/year for the domain", note: "Cloudflare charges the registry's price with no markup. Renews October 6, 2027. DNS and Email Routing are free.",
    dashboard: "https://dash.cloudflare.com/ae0a1832e7e7b3aafeac22c9236d9611/getwheelsdown.com", pricing: "https://www.cloudflare.com/products/registrar/",
  },
  {
    id: "openai", name: "OpenAI", role: "AI moderation and autofill",
    what: "Checks new listings, edits, ratings, names and bios before they go public, and fills in listing details on the Add spot form.",
    plan: "Pay as you go, gpt-5-mini",
    monthly: null, costText: "Usage-based", note: "$0.25 per 1M input tokens, $2 per 1M output tokens, $10 per 1,000 web searches. The first-pass safety check is free. Actual spend is in the AI costs panel.",
    dashboard: "https://platform.openai.com/usage", pricing: "https://platform.openai.com/docs/pricing",
  },
  {
    id: "resend", name: "Resend", role: "Email sending",
    what: "Sends password-reset and account emails from getwheelsdown.com.",
    plan: "Free plan",
    monthly: 0, costText: "$0", note: "Free covers 3,000 emails a month and 100 a day. Pro is $20/month for 50,000. The sending domain still needs to be verified before emails go out.",
    dashboard: "https://resend.com/domains", pricing: "https://resend.com/pricing",
  },
  {
    id: "github", name: "GitHub", role: "Code, demo site and checks",
    what: "Stores the Wheelsdown source code (flas-tech/wheelsdown), runs the automatic build checks, and hosts the browser-only demo on GitHub Pages.",
    plan: "Free, public repository",
    monthly: 0, costText: "$0", note: "Pages is free for public repositories, with a soft limit of 100 GB of traffic a month.",
    dashboard: "https://github.com/flas-tech/wheelsdown", pricing: "https://github.com/pricing",
  },
  {
    id: "photon", name: "OpenStreetMap (Photon)", role: "Place search",
    what: "Suggests matching businesses and addresses as crews type a name on the Add spot form. Map data from OpenStreetMap contributors.",
    plan: "Public service, no account",
    monthly: 0, costText: "$0", note: "Free under fair use. Heavy traffic would need a paid or self-hosted option.",
    dashboard: "https://photon.komoot.io", pricing: "https://photon.komoot.io",
  },
];

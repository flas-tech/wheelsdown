// Starter data. Spots are sample entries for demo purposes — verify before launch.
export const seedAirports: [string, string | null, string, string, string, string][] = [
  ["KMIA", "MIA", "Miami Intl", "Miami", "FL", "US"],
  ["KOPF", "OPF", "Miami-Opa Locka Executive", "Opa-locka", "FL", "US"],
  ["KTMB", "TMB", "Miami Executive", "Miami", "FL", "US"],
  ["KFLL", "FLL", "Fort Lauderdale-Hollywood Intl", "Fort Lauderdale", "FL", "US"],
  ["KFXE", "FXE", "Fort Lauderdale Executive", "Fort Lauderdale", "FL", "US"],
  ["KPBI", "PBI", "Palm Beach Intl", "West Palm Beach", "FL", "US"],
  ["KMCO", "MCO", "Orlando Intl", "Orlando", "FL", "US"],
  ["KORL", "ORL", "Orlando Executive", "Orlando", "FL", "US"],
  ["KTPA", "TPA", "Tampa Intl", "Tampa", "FL", "US"],
  ["KAPF", "APF", "Naples Municipal", "Naples", "FL", "US"],
  ["KEYW", "EYW", "Key West Intl", "Key West", "FL", "US"],
  ["KTEB", "TEB", "Teterboro", "Teterboro", "NJ", "US"],
  ["KHPN", "HPN", "Westchester County", "White Plains", "NY", "US"],
  ["KJFK", "JFK", "John F. Kennedy Intl", "New York", "NY", "US"],
  ["KLGA", "LGA", "LaGuardia", "New York", "NY", "US"],
  ["KEWR", "EWR", "Newark Liberty Intl", "Newark", "NJ", "US"],
  ["KBED", "BED", "Hanscom Field", "Bedford", "MA", "US"],
  ["KBOS", "BOS", "Boston Logan Intl", "Boston", "MA", "US"],
  ["KACK", "ACK", "Nantucket Memorial", "Nantucket", "MA", "US"],
  ["KMVY", "MVY", "Martha's Vineyard", "Vineyard Haven", "MA", "US"],
  ["KDCA", "DCA", "Reagan National", "Washington", "DC", "US"],
  ["KIAD", "IAD", "Washington Dulles Intl", "Dulles", "VA", "US"],
  ["KATL", "ATL", "Hartsfield-Jackson Atlanta Intl", "Atlanta", "GA", "US"],
  ["KPDK", "PDK", "DeKalb-Peachtree", "Atlanta", "GA", "US"],
  ["KCLT", "CLT", "Charlotte Douglas Intl", "Charlotte", "NC", "US"],
  ["KBNA", "BNA", "Nashville Intl", "Nashville", "TN", "US"],
  ["KMSY", "MSY", "Louis Armstrong New Orleans Intl", "New Orleans", "LA", "US"],
  ["KORD", "ORD", "Chicago O'Hare Intl", "Chicago", "IL", "US"],
  ["KMDW", "MDW", "Chicago Midway", "Chicago", "IL", "US"],
  ["KPWK", "PWK", "Chicago Executive", "Wheeling", "IL", "US"],
  ["KDAL", "DAL", "Dallas Love Field", "Dallas", "TX", "US"],
  ["KDFW", "DFW", "Dallas/Fort Worth Intl", "Dallas", "TX", "US"],
  ["KHOU", "HOU", "Houston Hobby", "Houston", "TX", "US"],
  ["KIAH", "IAH", "Houston Bush Intercontinental", "Houston", "TX", "US"],
  ["KAUS", "AUS", "Austin-Bergstrom Intl", "Austin", "TX", "US"],
  ["KSAT", "SAT", "San Antonio Intl", "San Antonio", "TX", "US"],
  ["KDEN", "DEN", "Denver Intl", "Denver", "CO", "US"],
  ["KAPA", "APA", "Centennial", "Englewood", "CO", "US"],
  ["KASE", "ASE", "Aspen/Pitkin County", "Aspen", "CO", "US"],
  ["KEGE", "EGE", "Eagle County Regional", "Eagle/Vail", "CO", "US"],
  ["KJAC", "JAC", "Jackson Hole", "Jackson", "WY", "US"],
  ["KSUN", "SUN", "Friedman Memorial", "Hailey/Sun Valley", "ID", "US"],
  ["KSDL", "SCF", "Scottsdale", "Scottsdale", "AZ", "US"],
  ["KPHX", "PHX", "Phoenix Sky Harbor Intl", "Phoenix", "AZ", "US"],
  ["KLAS", "LAS", "Harry Reid Intl", "Las Vegas", "NV", "US"],
  ["KVNY", "VNY", "Van Nuys", "Los Angeles", "CA", "US"],
  ["KLAX", "LAX", "Los Angeles Intl", "Los Angeles", "CA", "US"],
  ["KSMO", "SMO", "Santa Monica", "Santa Monica", "CA", "US"],
  ["KSAN", "SAN", "San Diego Intl", "San Diego", "CA", "US"],
  ["KSFO", "SFO", "San Francisco Intl", "San Francisco", "CA", "US"],
  ["KOAK", "OAK", "Oakland Intl", "Oakland", "CA", "US"],
  ["KSEA", "SEA", "Seattle-Tacoma Intl", "Seattle", "WA", "US"],
  ["PHNL", "HNL", "Daniel K. Inouye Intl", "Honolulu", "HI", "US"],
  ["TJSJ", "SJU", "Luis Muñoz Marín Intl", "San Juan", "PR", "US"],
  ["MYNN", "NAS", "Lynden Pindling Intl", "Nassau", "", "BS"],
  ["TNCM", "SXM", "Princess Juliana Intl", "Sint Maarten", "", "SX"],
  ["MMUN", "CUN", "Cancún Intl", "Cancún", "QR", "MX"],
  ["CYYZ", "YYZ", "Toronto Pearson Intl", "Toronto", "ON", "CA"],
  ["EGLL", "LHR", "London Heathrow", "London", "", "GB"],
  ["EGGW", "LTN", "London Luton", "Luton", "", "GB"],
  ["LFPB", "LBG", "Paris Le Bourget", "Paris", "", "FR"],
];

type SeedSpot = {
  icao: string; category: string; name: string; description: string; address?: string;
  costLevel: number; minutesNeeded: number; milesFromField: number; crewTip?: string; tags: string[];
};

export const seedSpots: SeedSpot[] = [
  // MIAMI
  { icao: "KMIA", category: "eat", name: "Versailles Restaurant", description: "Classic Little Havana Cuban spot. Ventanita window for cafecito and croquetas if you're short on time; sit-down for a full plate of ropa vieja.", address: "3555 SW 8th St, Miami, FL", costLevel: 2, minutesNeeded: 45, milesFromField: 4.5, crewTip: "Walk-up window is fastest — order a colada to share with the crew.", tags: ["cuban", "late night", "iconic"] },
  { icao: "KMIA", category: "eat", name: "La Carreta (MIA Concourse D)", description: "Cuban sandwiches and pastelitos airside. Good option when you can't leave the terminal.", address: "MIA Concourse D", costLevel: 1, minutesNeeded: 20, milesFromField: 0, crewTip: "Pastelitos travel well for the jumpseat.", tags: ["airside", "quick", "cuban"] },
  { icao: "KMIA", category: "do", name: "Wynwood Walls", description: "Outdoor street-art museum with surrounding galleries, coffee and breweries. Easy 2–3 hour wander.", address: "2516 NW 2nd Ave, Miami, FL", costLevel: 2, minutesNeeded: 150, milesFromField: 6, crewTip: "Go late afternoon when it cools down; rideshare drop on NW 2nd Ave.", tags: ["art", "walkable", "photos"] },
  { icao: "KMIA", category: "do", name: "South Pointe Park & Beach", description: "Southern tip of South Beach. Pier, shaded lawns, and a calm beach for a recovery day.", address: "1 Washington Ave, Miami Beach, FL", costLevel: 0, minutesNeeded: 180, milesFromField: 13, crewTip: "Free. Bring water; parking fills on weekends.", tags: ["beach", "free", "outdoors"] },
  { icao: "KOPF", category: "fbo", name: "Signature Aviation OPF", description: "Large ramp, quick fuel turns. Crew lounge with snooze rooms and showers reported.", costLevel: 0, minutesNeeded: 30, milesFromField: 0, crewTip: "Call ahead for crew car; they go fast on busy weekends.", tags: ["crew lounge", "showers", "snooze room"] },
  { icao: "KOPF", category: "eat", name: "Pollo Tropical (NW 27th Ave)", description: "Fast, cheap grilled chicken and rice bowls close to the field.", costLevel: 1, minutesNeeded: 25, milesFromField: 2.5, tags: ["quick", "cheap", "takeout"] },

  // FLL / PBI
  { icao: "KFLL", category: "do", name: "Las Olas Boulevard", description: "Walkable strip of shops, restaurants and the Riverwalk. Easy evening stroll after a long duty day.", address: "Las Olas Blvd, Fort Lauderdale, FL", costLevel: 1, minutesNeeded: 120, milesFromField: 4, tags: ["walkable", "evening", "shopping"] },
  { icao: "KFLL", category: "eat", name: "Southport Raw Bar", description: "Casual waterfront seafood. Peel-and-eat shrimp, conch fritters and cold drinks dockside.", address: "1536 Cordova Rd, Fort Lauderdale, FL", costLevel: 2, minutesNeeded: 60, milesFromField: 3, crewTip: "Mind the bottle-to-throttle — they open early.", tags: ["seafood", "waterfront", "casual"] },
  { icao: "KPBI", category: "do", name: "Worth Avenue", description: "Palm Beach's high-end shopping street with hidden courtyards (vias). Great for a slow walk.", address: "Worth Ave, Palm Beach, FL", costLevel: 3, minutesNeeded: 120, milesFromField: 5, tags: ["shopping", "walkable"] },
  { icao: "KPBI", category: "fbo", name: "Atlantic Aviation PBI", description: "Busy in season. Comfortable lounge; ramp gets tight during peak weekends.", costLevel: 0, minutesNeeded: 30, milesFromField: 0, crewTip: "Expect slot/PPR restrictions around major events.", tags: ["crew lounge", "busy in season"] },

  // TEB / NYC
  { icao: "KTEB", category: "fbo", name: "Signature Aviation TEB (West)", description: "Classic TEB stop. Crew lounge and quiet room; staff handle fast turns well.", costLevel: 0, minutesNeeded: 30, milesFromField: 0, crewTip: "Book ground transport early; Manhattan traffic eats layover time.", tags: ["crew lounge", "quiet room"] },
  { icao: "KTEB", category: "eat", name: "Teterboro Diner-style Spots on Rt 46", description: "A handful of 24-hr Jersey diners within 10 minutes of the field. Big plates, coffee refills, any hour.", costLevel: 1, minutesNeeded: 45, milesFromField: 2, crewTip: "Best option for a 2 a.m. arrival.", tags: ["24 hours", "diner", "quick"] },
  { icao: "KTEB", category: "do", name: "The High Line", description: "Elevated park on an old rail line on Manhattan's west side. Ends near Hudson Yards and Chelsea Market.", address: "New York, NY", costLevel: 0, minutesNeeded: 180, milesFromField: 12, crewTip: "Combine with Chelsea Market for food — budget an hour for the tunnel.", tags: ["free", "walkable", "nyc"] },
  { icao: "KJFK", category: "stay", name: "TWA Hotel", description: "Restored 1962 Saarinen terminal turned hotel, connected to T5. Rooftop pool overlooking runway 4L/22R.", address: "JFK Terminal 5", costLevel: 3, minutesNeeded: 600, milesFromField: 0, crewTip: "Day-use rooms available — handy for a long sit between legs.", tags: ["on-airport", "avgeek", "day rooms"] },
  { icao: "KJFK", category: "do", name: "TWA Hotel Connie Cocktail Lounge", description: "Cocktail bar inside a restored Lockheed Constellation on the ramp. Pure avgeek.", costLevel: 2, minutesNeeded: 60, milesFromField: 0, tags: ["avgeek", "bar"] },

  // ASPEN / EAGLE
  { icao: "KASE", category: "fbo", name: "Atlantic Aviation ASE", description: "Only FBO on the field. Ramp space is limited in peak ski season; expect parking coordination.", costLevel: 0, minutesNeeded: 30, milesFromField: 0, crewTip: "Check NOTAMs for curfew and noise-abatement procedures.", tags: ["sole FBO", "mountain ops"] },
  { icao: "KASE", category: "do", name: "Silver Queen Gondola", description: "Gondola up Aspen Mountain from downtown. Summer hiking and dining at the top; ski access in winter.", address: "Aspen, CO", costLevel: 3, minutesNeeded: 180, milesFromField: 4, tags: ["mountain", "views", "outdoors"] },
  { icao: "KASE", category: "eat", name: "Aspen Downtown Food Trucks & Delis", description: "Grab-and-go sandwiches and burritos in town when restaurant prices are wild.", costLevel: 1, minutesNeeded: 30, milesFromField: 4, tags: ["quick", "budget"] },
  { icao: "KEGE", category: "do", name: "Vail Village", description: "Pedestrian village with shops, restaurants and gondola access. 35 min from the field.", costLevel: 3, minutesNeeded: 300, milesFromField: 33, tags: ["mountain", "walkable"] },

  // ATL / PDK
  { icao: "KPDK", category: "fbo", name: "Signature Aviation PDK", description: "Solid FBO with crew cars and a quiet lounge. Close to Buckhead and Perimeter restaurants.", costLevel: 0, minutesNeeded: 30, milesFromField: 0, tags: ["crew car", "crew lounge"] },
  { icao: "KATL", category: "eat", name: "One Flew South (Concourse E)", description: "Sit-down airside restaurant often ranked among the best airport dining in the country.", address: "ATL Concourse E", costLevel: 3, minutesNeeded: 60, milesFromField: 0, tags: ["airside", "sushi", "cocktails"] },
  { icao: "KATL", category: "do", name: "Ponce City Market & BeltLine", description: "Food hall in a historic Sears building with rooftop games; walk out onto the BeltLine Eastside Trail.", address: "675 Ponce De Leon Ave NE, Atlanta, GA", costLevel: 2, minutesNeeded: 180, milesFromField: 11, tags: ["food hall", "walkable", "rooftop"] },

  // DAL / AUS / NASHVILLE
  { icao: "KDAL", category: "eat", name: "Pecan Lodge", description: "Deep Ellum barbecue. Brisket and burnt ends; lines move but plan for it.", address: "2702 Main St, Dallas, TX", costLevel: 2, minutesNeeded: 75, milesFromField: 8, crewTip: "Go before noon or after 2 to dodge the line.", tags: ["bbq", "texas"] },
  { icao: "KDAL", category: "do", name: "Frontiers of Flight Museum", description: "Aviation museum right on Love Field — Apollo 7 capsule, Southwest history and more.", address: "6911 Lemmon Ave, Dallas, TX", costLevel: 1, minutesNeeded: 120, milesFromField: 0.5, tags: ["avgeek", "museum", "on-field"] },
  { icao: "KAUS", category: "eat", name: "Franklin Barbecue", description: "Legendary Austin brisket. Best for multi-day layovers — the line is the experience.", address: "900 E 11th St, Austin, TX", costLevel: 2, minutesNeeded: 240, milesFromField: 8, crewTip: "Not for a quick turn. Pre-order for pickup if you can.", tags: ["bbq", "iconic", "line"] },
  { icao: "KBNA", category: "do", name: "Broadway Honky Tonks", description: "Live music from late morning to late night along Lower Broadway. No cover at most bars.", address: "Lower Broadway, Nashville, TN", costLevel: 1, minutesNeeded: 180, milesFromField: 9, tags: ["live music", "nightlife"] },
  { icao: "KBNA", category: "eat", name: "Hattie B's Hot Chicken", description: "Nashville hot chicken with heat levels from Southern to Shut the Cluck Up.", costLevel: 1, minutesNeeded: 60, milesFromField: 8, tags: ["hot chicken", "casual"] },

  // WEST
  { icao: "KVNY", category: "fbo", name: "Clay Lacy Aviation VNY", description: "Well-regarded full-service FBO with a polished crew lounge.", costLevel: 0, minutesNeeded: 30, milesFromField: 0, tags: ["crew lounge", "full service"] },
  { icao: "KVNY", category: "eat", name: "Ventura Blvd Sushi Row", description: "Studio City's stretch of Ventura Blvd has a dense lineup of sushi spots at every price point.", costLevel: 3, minutesNeeded: 90, milesFromField: 6, tags: ["sushi", "dinner"] },
  { icao: "KLAS", category: "do", name: "Red Rock Canyon Scenic Drive", description: "13-mile scenic loop 30 minutes from the Strip. Short hikes, big views, a reset from casino noise.", costLevel: 1, minutesNeeded: 240, milesFromField: 20, crewTip: "Timed entry reservations are often required — book ahead.", tags: ["outdoors", "hiking", "views"] },
  { icao: "KSDL", category: "do", name: "Old Town Scottsdale", description: "Walkable galleries, bars and western-themed shops right near the field.", costLevel: 2, minutesNeeded: 180, milesFromField: 8, tags: ["walkable", "nightlife"] },
  { icao: "KSFO", category: "do", name: "SFO Aviation Museum & Library", description: "Free museum inside the International Terminal with rotating exhibits on aviation history.", costLevel: 0, minutesNeeded: 45, milesFromField: 0, tags: ["free", "avgeek", "museum"] },
  { icao: "KSAN", category: "eat", name: "Little Italy Mercato & Cafés", description: "Five minutes from the field. Pizza, gelato and coffee within easy walking distance.", costLevel: 2, minutesNeeded: 60, milesFromField: 2, tags: ["walkable", "close to field"] },

  // ISLANDS / INTL
  { icao: "TNCM", category: "do", name: "Maho Beach", description: "Famous beach at the threshold of runway 10. Watch heavies on short final from the sand.", costLevel: 0, minutesNeeded: 120, milesFromField: 0.3, crewTip: "Respect the jet-blast warning signs — seriously.", tags: ["avgeek", "beach", "free"] },
  { icao: "MYNN", category: "eat", name: "Arawak Cay Fish Fry", description: "Strip of colorful shacks serving conch salad, fried snapper and cold Kalik.", costLevel: 1, minutesNeeded: 60, milesFromField: 8, tags: ["local", "seafood"] },
  { icao: "TJSJ", category: "do", name: "Old San Juan", description: "Cobblestone streets, El Morro fortress and colorful colonial buildings. Great full-day walk.", costLevel: 1, minutesNeeded: 300, milesFromField: 8, tags: ["history", "walkable", "photos"] },
  { icao: "KMSY", category: "eat", name: "Café Du Monde", description: "Beignets and café au lait in the French Quarter. Open long hours — good for odd duty times.", address: "800 Decatur St, New Orleans, LA", costLevel: 1, minutesNeeded: 45, milesFromField: 15, tags: ["iconic", "dessert", "late night"] },
  { icao: "KMSY", category: "stay", name: "French Quarter boutique hotels", description: "If you can choose, staying in or near the Quarter saves rideshare time. Ask about crew rates.", costLevel: 3, minutesNeeded: 720, milesFromField: 15, tags: ["walkable", "crew rates"] },
  { icao: "KMCO", category: "stay", name: "Hyatt Regency Orlando International Airport", description: "Hotel inside the main terminal. Zero commute for early show times.", costLevel: 3, minutesNeeded: 480, milesFromField: 0, tags: ["on-airport", "early show"] },
];

export const seedReviews: { spot: string; rating: number; comment: string; author: string; crewRole: string }[] = [
  { spot: "Versailles Restaurant", rating: 5, comment: "Ventanita had us in and out in 15 minutes. Croquetas were perfect.", author: "J. Ramirez", crewRole: "Captain" },
  { spot: "Versailles Restaurant", rating: 4, comment: "Busy on Sundays, but worth it for the full sit-down.", author: "Kelly M.", crewRole: "Flight Attendant" },
  { spot: "Wynwood Walls", rating: 5, comment: "Perfect for a 24 hr layover. Grabbed a beer at a brewery after.", author: "Tom B.", crewRole: "First Officer" },
  { spot: "Signature Aviation TEB (West)", rating: 4, comment: "Quiet room was a lifesaver on a 10-hour sit.", author: "D. Cole", crewRole: "Captain" },
  { spot: "Maho Beach", rating: 5, comment: "Bucket-list for any pilot. Stand well clear when the big jets spool up.", author: "Ana P.", crewRole: "First Officer" },
  { spot: "Frontiers of Flight Museum", rating: 5, comment: "Walkable from the FBO side. Easy 2 hours.", author: "Mike R.", crewRole: "Mechanic" },
  { spot: "TWA Hotel", rating: 4, comment: "Day room for a long sit — pool is incredible, rooms are small.", author: "Sara L.", crewRole: "Flight Attendant" },
  { spot: "Pecan Lodge", rating: 5, comment: "Brisket was elite. Line was 30 min at 11:30.", author: "Chris W.", crewRole: "Captain" },
  { spot: "Atlantic Aviation ASE", rating: 3, comment: "Great staff, but ramp was packed during Christmas week. Plan ahead.", author: "R. Hughes", crewRole: "Captain" },
];

export const seedAds = [
  { slot: "top", advertiser: "Wheelsdown", headline: "Reach thousands of flight crews", body: "Hotels, restaurants, FBOs and crew-friendly brands: advertise by airport or network-wide.", cta: "Advertise with us", url: "mailto:ads@wheelsdown.app", targetIcao: "", active: 1 },
  { slot: "inline", advertiser: "Sample: Crew Rest Hotels", headline: "Crew rates near the field", body: "Late check-out and quiet floors for crews on rest. (Sample ad placement)", cta: "See rates", url: "", targetIcao: "", active: 1 },
  { slot: "inline", advertiser: "Sample: Miami FBO", headline: "Fast turns at OPF", body: "Crew snooze rooms, showers and a crew car on request. (Sample airport-targeted ad)", cta: "Plan your stop", url: "", targetIcao: "KOPF", active: 1 },
  { slot: "footer", advertiser: "Sample: Headset Shop", headline: "Headsets & flight bags, crew discount", body: "Sample footer banner — swap in any partner from the admin panel.", cta: "Shop", url: "", targetIcao: "", active: 1 },
];

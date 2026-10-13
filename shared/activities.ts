// Types of things to do, recognized from a listing's name, description, tags and crew tip. Like food types, nothing is
// stored, so listings never need re-tagging when this list grows.
export const ACTIVITIES: { id: string; label: string; re: RegExp }[] = [
  { id: "golf", label: "Golf", re: /\bgolf|country club|driving range|top ?golf|links\b|putt/i },
  { id: "fishing", label: "Fishing & boating", re: /fishing|\bfish\b|angler|charter|\bbait|marina|boat (tour|rental)|sailing|pontoon|\bpier\b/i },
  { id: "spa", label: "Spa & wellness", re: /\bspa\b|massage|wellness|sauna|float tank|hot spring|day spa|facial|med ?spa|cryo/i },
  { id: "beach", label: "Beach", re: /\bbeach|\bsand\b|oceanfront|boardwalk|surf/i },
  { id: "outdoors", label: "Parks & outdoors", re: /\bpark\b|state park|trail|hik(e|ing)|nature|preserve|garden|arboretum|\blake\b|kayak|paddle|canoe|waterfall|overlook|scenic|botanical|wildlife/i },
  { id: "museums", label: "Museums & history", re: /museum|gallery|histor|heritage|memorial|monument|planetarium|science center|aviation museum|battlefield/i },
  { id: "zoo", label: "Zoo & aquarium", re: /\bzoo\b|aquarium|safari|wildlife park|petting farm/i },
  { id: "shopping", label: "Shopping", re: /\bmall\b|shopping|outlet|boutique|market\b|farmers market|flea market|bookstore|antique/i },
  { id: "fitness", label: "Gym & fitness", re: /\bgym\b|fitness|yoga|crossfit|climbing|bouldering|pilates|planet fitness|ymca|rec(reation)? center|pool\b/i },
  { id: "fun", label: "Games & entertainment", re: /bowling|arcade|cinema|movie|theat(er|re)|escape room|mini ?golf|go-?kart|trampoline|axe throw|billiard|amusement|theme park|casino/i },
  { id: "nightlife", label: "Nightlife & music", re: /nightlife|night ?club|live music|jazz|comedy club|lounge|brewery|winery|distillery|taproom|karaoke/i },
  { id: "sights", label: "Sights & tours", re: /\btour\b|tours\b|sightseeing|landmark|lighthouse|historic district|riverwalk|skyline|observation deck|scenic drive/i },
];
export const activityLabel = (id: string) => ACTIVITIES.find((a) => a.id === id)?.label || id;
export function activitiesOf(s: { name: string; description?: string | null; tags?: string | null; crewTip?: string | null }): string[] {
  const text = [s.name, s.description || "", s.tags || "", s.crewTip || ""].join(" ");
  return ACTIVITIES.filter((a) => a.re.test(text)).map((a) => a.id);
}

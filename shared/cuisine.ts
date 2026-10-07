// Food types, recognized from a listing's name, description, tags and crew tip. Used only to filter search results;
// nothing is stored, so listings never need re-tagging when this list grows.
export const CUISINES: { id: string; label: string; re: RegExp }[] = [
  { id: "pizza", label: "Pizza", re: /\bpizz|\bcalzone|flatbread/i },
  { id: "bbq", label: "BBQ", re: /\bbbq\b|barbecue|barbeque|smokehouse|\bbrisket|pit ?master/i },
  { id: "burgers", label: "Burgers", re: /burger|mcdonald|wendy'?s|five guys|in-n-out|whataburger|culver'?s|shake shack/i },
  { id: "mexican", label: "Mexican", re: /mexican|\btaco|taqueria|burrito|cantina|tex-?mex|enchilada|quesadilla/i },
  { id: "sushi", label: "Sushi & Japanese", re: /sushi|japanese|\bramen|hibachi|teriyaki|izakaya|\budon|\bpoke\b/i },
  { id: "chinese", label: "Chinese", re: /chinese|dim sum|dumpling|szechuan|sichuan|cantonese|wok\b|lo mein/i },
  { id: "thai", label: "Thai & Vietnamese", re: /\bthai\b|vietnam|\bpho\b|banh mi|pad thai/i },
  { id: "indian", label: "Indian", re: /indian\b|curry|tandoor|masala|biryani|naan/i },
  { id: "italian", label: "Italian", re: /italian|trattoria|osteria|\bpasta|ristorante|lasagna|risotto/i },
  { id: "mediterranean", label: "Greek & Mediterranean", re: /greek|mediterranean|gyro|falafel|shawarma|kebab|hummus|lebanese|turkish/i },
  { id: "latin", label: "Cuban & Latin", re: /cuban|latin|peruvian|colombian|venezuelan|empanada|arepa|puerto ric|salvadoran|brazilian|churrasc/i },
  { id: "seafood", label: "Seafood", re: /seafood|oyster|\bcrab|lobster|shrimp|raw bar|fish\b|clam|chowder|grouper|steamers?\b/i },
  { id: "steak", label: "Steakhouse", re: /steak|chophouse|chop house/i },
  { id: "caribbean", label: "Caribbean", re: /caribbean|jamaican|\bjerk\b|rasta|haitian|trinidad|bahamian|conch|roti\b/i },
  { id: "southern", label: "Southern", re: /southern|soul food|fried chicken|biscuit|cajun|creole|grits|po'? ?boy/i },
  { id: "wings", label: "Wings", re: /\bwings?\b/i },
  { id: "deli", label: "Deli & Sandwiches", re: /\bdeli\b|sandwich|\bsubs?\b|hoagie|hero\b|cheesesteak|sausage|hot ?dog|bratwurst/i },
  { id: "breakfast", label: "Breakfast & Brunch", re: /breakfast|brunch|\bdiner\b|pancake|waffle|bagel|omelet/i },
  { id: "coffee", label: "Coffee", re: /coffee|espresso|\bcaf[eé]\b|latte|roaster/i },
  { id: "bakery", label: "Bakery & Sweets", re: /bakery|pastr|donut|doughnut|ice cream|gelato|dessert|cupcake|croissant|frozen yogurt/i },
  { id: "healthy", label: "Healthy", re: /salad|vegan|vegetarian|plant-based|smoothie|juice bar|acai|grain bowl|gluten-free/i },
  { id: "bar", label: "Pub & Brewery", re: /\bpub\b|brewery|brewing|taproom|tavern|beer garden|wine bar|cocktail|\bbar\b/i },
];
export const cuisineLabel = (id: string) => CUISINES.find((c) => c.id === id)?.label || id;
export function cuisinesOf(s: { name: string; description?: string | null; tags?: string | null; crewTip?: string | null }): string[] {
  const text = [s.name, s.description || "", s.tags || "", s.crewTip || ""].join(" ");
  return CUISINES.filter((c) => c.re.test(text)).map((c) => c.id);
}

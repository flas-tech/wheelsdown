/** Founding badge: the first WRIGHT_SEATS crew to sign up after launch join the Orville & Wilbur Wright Club, numbered in signup order. */
export const WRIGHT_SEATS = 50;
export const WRIGHT_NAME = "Orville & Wilbur Wright Club";
/** Test sign-ups (smoke tests, example.com addresses) never take a seat. */
export const isTestSignup = (handle: string, email?: string | null) => /^smoke\d*/.test(handle) || /@example\.(com|org|net)$/i.test(email || "");

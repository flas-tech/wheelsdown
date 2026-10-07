// Browser geolocation with friendly errors. Requires HTTPS (or localhost).
export type LatLng = { lat: number; lng: number };
/** Current position with its accuracy in meters (for verified check-ins). */
export function getPositionFix(timeoutMs = 15000): Promise<LatLng & { accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This browser can't share your location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy || 0 }),
      (e) => reject(new Error(
        e.code === 1 ? "Location is off for this site. On iPhone: Settings › Privacy & Security › Location Services › Safari Websites (or the Wheelsdown home-screen app)."
          : e.code === 3 ? "Couldn't get a location fix in time. Try again." : "Couldn't get your location.",
      )),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
export function getPosition(timeoutMs = 12000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This browser can't share your location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(
        e.code === 1 ? "Location is off for this site. On iPhone: Settings › Privacy & Security › Location Services › Safari Websites (or the Wheelsdown home-screen app)."
          : e.code === 3 ? "Couldn't get a location fix in time. Try again." : "Couldn't get your location.",
      )),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
export type NearAirport = { icao: string; iata: string; name: string; city: string; region: string; lat: number; lon: number; miles: number };
export type PlaceHit = { ref: string; name: string; address: string; city: string; lat: number; lng: number; kind: string };
export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.8, t = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * t) / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(((b.lon - a.lon) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

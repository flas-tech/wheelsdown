import { Link } from "wouter";
export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="font-code text-sm text-primary">404 · NOT ON THE CHART</p>
      <h1 className="mt-2 text-lg font-semibold">That page isn't here</h1>
      <Link href="/" className="mt-4 inline-flex rounded-full taxi-sign px-4 py-2 text-sm font-semibold" data-testid="link-404-home">Back to search</Link>
    </div>
  );
}

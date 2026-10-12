import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <main className="reader-error">
      <h1>Page not found</h1>
      <p>The page you requested is not available.</p>
      <Link className="button button--primary" to="/">
        Back to library
      </Link>
    </main>
  );
}

import { useEffect, useState } from "react";

type ConnectionState = "checking" | "connected" | "unavailable";

function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health/", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Health check failed");
        }
        return response.json() as Promise<{ status: string }>;
      })
      .then((data) => {
        setConnection(data.status === "ok" ? "connected" : "unavailable");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setConnection("unavailable");
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="home">
      <h1>Pilot EFB</h1>
      <p>An aviation manual reading prototype.</p>
      <p aria-live="polite" role="status">
        {connection === "checking" && "Checking backend connection…"}
        {connection === "connected" && "Backend connected"}
        {connection === "unavailable" &&
          "Backend unavailable. Start the Django server and try again."}
      </p>
    </main>
  );
}

export default App;

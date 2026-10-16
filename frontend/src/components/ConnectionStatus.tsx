import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser's own connection state. This is real, not sample data; offline caching itself is not built yet. */
export function ConnectionStatus() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

  return (
    <span
      aria-live="polite"
      className={`connection connection--${online ? "online" : "offline"}`}
    >
      {online ? "Online" : "Offline"}
    </span>
  );
}

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ConnectionStatus } from "./ConnectionStatus";
import { LogoMark } from "./Icons";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="app-bar">
      <Link className="app-bar__brand" to="/">
        <LogoMark />
        Pilot EFB
      </Link>
      <span className="app-bar__title">{title}</span>
      {detail && <span className="app-bar__detail">{detail}</span>}
      <div className="app-bar__actions">
        <ConnectionStatus />
        <ThemeToggle />
        {children}
      </div>
    </div>
  );
}

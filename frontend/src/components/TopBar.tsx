import type { ReactNode } from "react";
import { Link } from "react-router-dom";

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
      <Link className="app-bar__brand" to="/">Pilot EFB</Link>
      <span className="app-bar__title">{title}</span>
      {detail && <span className="app-bar__detail">{detail}</span>}
      {children && <div className="app-bar__actions">{children}</div>}
    </div>
  );
}

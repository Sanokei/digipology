import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { SiteHeader } from "./SiteHeader";

interface PlaceholderPageProps {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  children,
}: PlaceholderPageProps) {
  return (
    <div className="site-page">
      <SiteHeader />
      <main className="placeholder-page">
        <section className="placeholder-card" aria-labelledby="page-title">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="page-title">{title}</h1>
          <p>{description}</p>
          {children}
          <Link className="text-link" to="/">
            Back to home <span aria-hidden="true">→</span>
          </Link>
        </section>
      </main>
    </div>
  );
}

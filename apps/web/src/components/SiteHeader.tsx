import { Link, NavLink } from "react-router-dom";

function navClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? "site-nav__link site-nav__link--active" : "site-nav__link";
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="wordmark" to="/" aria-label="Digipology home">
        <span className="wordmark__mark" aria-hidden="true">
          D
        </span>
        <span>Digipology</span>
      </Link>
      <nav className="site-nav" aria-label="Primary navigation">
        <NavLink className={navClassName} to="/games">
          Games
        </NavLink>
        <NavLink className={navClassName} to="/create">
          Create
        </NavLink>
      </nav>
    </header>
  );
}

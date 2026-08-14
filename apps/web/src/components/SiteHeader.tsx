import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

function navClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? "site-nav__link site-nav__link--active" : "site-nav__link";
}

export function SiteHeader() {
  const { user, loading, logout } = useAuth();
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
        {loading ? (
          <span className="site-nav__account">Checking account…</span>
        ) : user === null ? (
          <NavLink className={navClassName} to="/login">Sign in</NavLink>
        ) : (
          <span className="account-menu">
            <span>{user.name}</span>
            <button type="button" onClick={() => void logout()}>Log out</button>
          </span>
        )}
      </nav>
    </header>
  );
}

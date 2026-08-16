import { Link, NavLink, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

function navClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? "play-nav__link play-nav__link--active" : "play-nav__link";
}

export function SiteHeader() {
  const location = useLocation();
  const { user, logout } = useAuth();
  return (
    <header className="site-header play-header">
      <Link className="play-brand" to="/" aria-label="Digipology Play home">Digipology <span>Play</span></Link>
      <nav className="play-nav" aria-label="Primary navigation">
        <NavLink className={navClassName} end to="/">Browse</NavLink>
        <NavLink className={navClassName} to="/create">Create</NavLink>
      </nav>
      <div className="play-account">
        {user === null ? (
          <Link className="play-account__signin" to="/login" state={{ backgroundLocation: location }}>Sign in</Link>
        ) : (
          <details className="play-account__menu">
            <summary>{user.name}</summary>
            <div>
              <Link to="/create#my-games">My Games</Link>
              <Link to="/saves">Saved tables</Link>
              <button type="button" onClick={() => void logout()}>Log out</button>
            </div>
          </details>
        )}
      </div>
    </header>
  );
}

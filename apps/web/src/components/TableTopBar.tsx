import { Link } from "react-router-dom";

export function TableTopBar() {
  return (
    <header className="table-topbar">
      <div className="table-topbar__game">
        <Link className="table-topbar__back" to="/" aria-label="Leave table demo">
          <span aria-hidden="true">←</span>
        </Link>
        <div>
          <span className="table-topbar__label">Game</span>
          <strong>Untitled Table</strong>
        </div>
      </div>
      <div className="table-topbar__actions">
        <button className="table-topbar__players" type="button">
          <span className="presence-dot" aria-hidden="true" />
          1 player
        </button>
        <button className="table-topbar__invite" type="button">
          Invite
        </button>
        <button className="icon-button" type="button" aria-label="Table menu">
          <span aria-hidden="true">•••</span>
        </button>
      </div>
    </header>
  );
}

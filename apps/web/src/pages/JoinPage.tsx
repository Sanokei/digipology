import { Link, useParams } from "react-router-dom";

import { PlaceholderPage } from "../components/PlaceholderPage";
import { normalizeJoinCode } from "../utils/joinCode";

export function JoinPage() {
  const { code = "" } = useParams();
  const normalizedCode = normalizeJoinCode(code);

  return (
    <PlaceholderPage
      eyebrow="Join table"
      title={normalizedCode || "Room code needed"}
      description="Your room code is ready. Display-name entry and connection progress arrive with multiplayer wiring."
    >
      <div className="placeholder-actions">
        <Link className="button-link" to="/table">
          Preview the table
        </Link>
      </div>
    </PlaceholderPage>
  );
}

import type { ReleaseBundleDto } from "./http";

export interface GameRulebook {
  title: string;
  body: string;
  source: "release" | "builtin";
}

const BUILTIN_GUIDES: Readonly<Record<string, string>> = {
  builtin_first_deal_1: `# First Deal

## The table
First Deal is a shared card table for two to four people. Choose a card game with your friends; this sandbox does not award a winner automatically.

## Set up
Shuffle the deck, then use Draw card to put cards in your private hand. Other players have their own hands.

## Play cards
Select a hand card to inspect it. Drag a card onto the table, or open its actions and choose Play to table. Use the table's card actions to flip cards and shuffle the deck.

## Finish
Use the victory conditions of the game your group chose. The table keeps your cards synchronized, while your group agrees on the rules.`,
  builtin_dice_dash_3: `# Dice Dash

## Goal
Be the first player to reach 20 points. Two to four people can race at one table.

## Set up
The host opens the table and shares its invite. Joining players enter the turn order with zero points.

## Your turn
Choose Roll Die when the turn indicator says Your turn. Add the rolled number to your score. The table handles scoring and advances to the next player automatically.

## Winning
The first player to reach 20 wins. The score stops at 20 and the roll controls close once the winner is announced.`,
  builtin_zone_runner_2: `# Zone Runner

## Goal
Be the first player to score two points by moving runners into the scoring zone.

## Set up
Invite two to four players. Each player has runner pieces in their hand. The opening player chooses an opening pace when prompted.

## Your turn
Drag a runner from your hand onto the table and into the scoring zone. A successful entry scores one point and passes the turn. The turn also passes when its 20-second timer expires.

## Winning
The first player to score two points wins. Watch the status message and score panel for the current player and result.`,
};

export function authoredRules(bundle: Pick<ReleaseBundleDto, "files">): string | null {
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  const file = files.find((candidate) => candidate.path === "runtime/rules.md")
    ?? files.find((candidate) => candidate.path === "runtime/rules.txt");
  const body = file?.content.trim();
  if (!body || body.length > 32_768 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) return null;
  return body;
}

/** Presentation metadata only: never alters the release or canonical state. */
export function readRulebook(bundle: Pick<ReleaseBundleDto, "files" | "title" | "releaseId">): GameRulebook | null {
  const body = authoredRules(bundle);
  if (body !== null) return { title: bundle.title ?? "Game rules", body, source: "release" };
  const guide = BUILTIN_GUIDES[bundle.releaseId];
  return typeof guide !== "string" ? null : { title: bundle.title ?? "Game rules", body: guide, source: "builtin" };
}

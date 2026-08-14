import { describe, expect, test } from "bun:test";
import { emptyPlayCountLedger, recordFirstBootstrap, takePendingPlayCount } from "./play-count";

describe("play-count dedupe", () => {
  test("counts first bootstrap, distinct players, and the same player in a distinct room", () => {
    let roomA = emptyPlayCountLedger();
    let result = recordFirstBootstrap(roomA, "player_one");
    expect(result.counted).toBe(true);
    roomA = result.ledger;
    result = recordFirstBootstrap(roomA, "player_one");
    expect(result.counted).toBe(false);
    roomA = result.ledger;
    result = recordFirstBootstrap(roomA, "player_two");
    expect(result.counted).toBe(true);
    roomA = result.ledger;
    const roomB = recordFirstBootstrap(emptyPlayCountLedger(), "player_one");
    expect(roomB.counted).toBe(true);
    expect(takePendingPlayCount(roomA).increment).toBe(2);
    expect(takePendingPlayCount(roomB.ledger).increment).toBe(1);
  });

  test("takes each pending increment at most once", () => {
    const recorded = recordFirstBootstrap(emptyPlayCountLedger(), "player_one").ledger;
    const first = takePendingPlayCount(recorded);
    expect(first.increment).toBe(1);
    expect(takePendingPlayCount(first.ledger).increment).toBe(0);
  });
});

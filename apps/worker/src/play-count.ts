export interface PlayCountLedger {
  counted: ReadonlySet<string>;
  pending: ReadonlySet<string>;
}

export function emptyPlayCountLedger(): PlayCountLedger {
  return { counted: new Set(), pending: new Set() };
}

export function recordFirstBootstrap(
  ledger: PlayCountLedger,
  playerId: string,
): { ledger: PlayCountLedger; counted: boolean } {
  if (ledger.counted.has(playerId)) return { ledger, counted: false };
  return {
    ledger: {
      counted: new Set([...ledger.counted, playerId]),
      pending: new Set([...ledger.pending, playerId]),
    },
    counted: true,
  };
}

export function takePendingPlayCount(ledger: PlayCountLedger): {
  ledger: PlayCountLedger;
  increment: number;
} {
  return {
    ledger: { counted: ledger.counted, pending: new Set() },
    increment: ledger.pending.size,
  };
}

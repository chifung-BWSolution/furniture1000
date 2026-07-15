export type GpSummary = {
  ship: number;
  installation: number;
};

function parseMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

export function parseGpSummary(raw: unknown): GpSummary {
  if (!raw || typeof raw !== 'object') {
    return { ship: 0, installation: 0 };
  }

  const row = raw as { ship?: unknown; installation?: unknown };
  return {
    ship: parseMoney(row.ship),
    installation: parseMoney(row.installation),
  };
}

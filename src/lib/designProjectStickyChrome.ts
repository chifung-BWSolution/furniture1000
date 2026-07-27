import { useEffect, useState } from 'react';

export type DesignProjectStickyZoneChip = {
  key: string;
  label: string;
  count: number;
};

export type DesignProjectStickyChrome = {
  active: boolean;
  zoneGroups: DesignProjectStickyZoneChip[];
  confirming: boolean;
  onConfirm: () => void;
  onJump: (label: string) => void;
};

let payload: DesignProjectStickyChrome | null = null;
const listeners = new Set<() => void>();

export function publishDesignProjectStickyChrome(
  next: DesignProjectStickyChrome | null,
) {
  payload = next;
  listeners.forEach((listener) => listener());
}

export function useDesignProjectStickyChrome(): DesignProjectStickyChrome | null {
  const [state, setState] = useState<DesignProjectStickyChrome | null>(payload);

  useEffect(() => {
    const onChange = () => setState(payload);
    listeners.add(onChange);
    onChange();
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  return state;
}

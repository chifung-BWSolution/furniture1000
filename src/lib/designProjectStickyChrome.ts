import { useEffect, useState } from 'react';

export type DesignProjectStickyZoneChip = {
  key: string;
  label: string;
  /**
   * Product total for the chip（與間隔標題「× 總數 N件傢俬」相同；
   * 無劃分時為實際件數）.
   */
  count: number;
};

export type DesignProjectStickyChrome = {
  active: boolean;
  /** design = 儲存／平面圖；quote = 僅間隔跳轉 */
  mode?: 'design' | 'quote';
  zoneGroups: DesignProjectStickyZoneChip[];
  saving: boolean;
  hasFloorPlan: boolean;
  onSave: () => void;
  onViewFloorPlan: () => void;
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

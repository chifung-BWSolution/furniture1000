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
  /** design = 儲存／平面圖；quote = 間隔跳轉 + 儲存 */
  mode?: 'design' | 'quote';
  zoneGroups: DesignProjectStickyZoneChip[];
  /** Currently visible zone-group chip label (scroll-spy). */
  activeZoneLabel?: string | null;
  /**
   * Sticky subtitle under zone chips, e.g.
   * 「入口及前臺大堂 | Sofa 梳化 > 多人梳化 : 3」
   */
  activeContextLine?: string | null;
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

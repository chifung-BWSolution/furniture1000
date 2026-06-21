import type { TempoPage, TempoStoryboard, TempoRouteStoryboard } from 'tempo-sdk';
import { AlternateActiveStates as AlternateActiveStates2 } from './AlternateActiveStates';
import { FullInterface as FullInterface2 } from './FullInterface';
import { LeftSidebar as LeftSidebar2 } from './LeftSidebar';
import { SitemapReference as SitemapReference2 } from './SitemapReference';
import { TopNavBar as TopNavBar2 } from './TopNavBar';

const page: TempoPage = {
  name: "FDS Navigation Redesign",
};

export default page;

export const FullInterface: TempoStoryboard = {
  render: () => <FullInterface2 />,
  name: "完整介面",
  layout: { x: 0, y: 0, width: 1920, height: 8027 },
};

export const TopNavBar: TempoStoryboard = {
  render: () => <TopNavBar2 />,
  name: "頂部導航欄",
  layout: { x: 0, y: 1130, width: 1920, height: 357 },
};

export const LeftSidebar: TempoStoryboard = {
  render: () => <LeftSidebar2 />,
  name: "左側欄",
  layout: { x: 1970, y: 0, width: 600, height: 395 },
};

export const SitemapReference: TempoStoryboard = {
  render: () => <SitemapReference2 />,
  name: "Sitemap 參考",
  layout: { x: 0, y: 1380, width: 1600, height: 12538 },
};

export const AlternateActiveStates: TempoStoryboard = {
  render: () => <AlternateActiveStates2 />,
  name: "其他 active 狀態",
  layout: { x: 0, y: 2330, width: 100, height: 7364 },
};

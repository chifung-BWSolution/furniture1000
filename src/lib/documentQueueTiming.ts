/** Document workers accept jobs from 23:00 to 09:00 in Asia/Shanghai. */
export function documentQueueTiming(runAfter: string, now = new Date()): string {
  const scheduled = Date.parse(runAfter);
  const earliest = new Date(Math.max(now.getTime(), Number.isFinite(scheduled) ? scheduled : 0));
  const shanghai = new Date(earliest.getTime() + 8 * 60 * 60 * 1000);
  const hour = shanghai.getUTCHours();
  if (hour >= 9 && hour < 23) shanghai.setUTCHours(23, 0, 0, 0);
  const eligibleAt = new Date(shanghai.getTime() - 8 * 60 * 60 * 1000);
  if (eligibleAt.getTime() <= now.getTime()) return '已進入處理時段，等待依序處理';
  const date = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(eligibleAt);
  return `預計 ${date} 起處理（上海時間，依序執行）`;
}

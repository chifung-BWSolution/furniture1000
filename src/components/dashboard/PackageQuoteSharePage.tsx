import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { loadSharedPackageQuote } from '@/lib/packagePricing';
import {
  areaTotals,
  formatPackageMoney,
  lineCents,
  totalCents,
  type PackageQuoteSnapshot,
} from '@/lib/packagePricingMath';

export function PackageQuoteSharePage() {
  const { token = '' } = useParams();
  const [snapshot, setSnapshot] = useState<PackageQuoteSnapshot | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSharedPackageQuote(token).then((result) => {
      if (cancelled) return;
      if (result.error || !result.snapshot) {
        setMissing(true);
        setSnapshot(null);
        return;
      }
      setSnapshot(result.snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (missing) {
    return <p className="p-8 text-sm">找不到這張參考報價。</p>;
  }
  if (!snapshot) {
    return <p className="p-8 text-sm">載入中…</p>;
  }
  const areas = areaTotals(snapshot.lines || []);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">{snapshot.title || '套餐參考報價'}</h1>
      <p className="text-sm text-muted-foreground">{snapshot.note.replace(/2026\s*/g, '')}</p>
      {areas.map((area) => (
        <section key={area.area}>
          <h2 className="font-medium">{area.area}</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {(snapshot.lines || [])
              .filter((line) => line.area === area.area)
              .map((line) => (
                <li key={line.id} className="flex justify-between gap-4 border-b py-1">
                  <span>
                    {[line.itemName, line.grade, line.dimension, line.unit].filter(Boolean).join(' · ')} × {line.quantity}
                  </span>
                  <span>{formatPackageMoney(lineCents(line.quantity, line.unitPrice))}</span>
                </li>
              ))}
          </ul>
          <p className="mt-1 text-sm">小計 {formatPackageMoney(area.cents)}</p>
        </section>
      ))}
      <p className="text-lg font-semibold">總額 {formatPackageMoney(totalCents(snapshot.lines || []))}</p>
    </main>
  );
}

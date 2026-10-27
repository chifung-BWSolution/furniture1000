import { PACKAGE_PRICE_YEAR, areaTotals, formatPackageMoney, lineCents, totalCents, type PackageQuoteSnapshot } from '@/lib/packagePricingMath';

let fontsReady: Promise<void> | null = null;

async function ensureFonts(): Promise<typeof import('@react-pdf/renderer')> {
  const mod = await import('@react-pdf/renderer');
  if (!fontsReady) {
    fontsReady = (async () => {
      mod.Font.register({
        family: 'NotoSansHK',
        fonts: [
          { src: '/fonts/pdf/NotoSansHK-Regular.ttf', fontWeight: 400 },
          { src: '/fonts/pdf/NotoSansHK-Bold.ttf', fontWeight: 700 },
        ],
      });
      mod.Font.registerHyphenationCallback((word) => {
        if (word.length <= 16) return [word];
        const parts: string[] = [];
        for (let index = 0; index < word.length; index += 8) parts.push(word.slice(index, index + 8));
        return parts;
      });
    })();
  }
  await fontsReady;
  return mod;
}

export async function buildPackageQuotePdf(snapshot: PackageQuoteSnapshot, qrDataUrl: string | null): Promise<Blob> {
  const { Document, Image, Page, StyleSheet, Text, View, pdf } = await ensureFonts();
  const styles = StyleSheet.create({
    page: { fontFamily: 'NotoSansHK', fontSize: 8, padding: 28, color: '#1a1a2e' },
    title: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
    note: { fontSize: 8, color: '#5c5c7a', marginBottom: 12 },
    area: { fontSize: 11, fontWeight: 700, marginTop: 10, marginBottom: 4 },
    row: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: '#e5e7eb', paddingVertical: 3 },
    head: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a2e', paddingBottom: 3 },
    cell: { paddingRight: 4 },
    total: { marginTop: 12, fontSize: 12, fontWeight: 700 },
    qrWrap: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
    qr: { width: 72, height: 72 },
  });
  const columns = [
    { label: '項目', width: 110 },
    { label: '規格', width: 70 },
    { label: '材質', width: 70 },
    { label: '尺寸', width: 110 },
    { label: '單位', width: 48 },
    { label: '數量', width: 36 },
    { label: '平均價', width: 58 },
    { label: '小計', width: 64 },
  ];
  const areas = areaTotals(snapshot.lines);
  const doc = (
    <Document title={snapshot.title || '套餐參考報價'}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>{snapshot.title || '套餐參考報價'}</Text>
        <Text style={styles.note}>{`${PACKAGE_PRICE_YEAR} 年工作表。${snapshot.note}`}</Text>
        {areas.map((area) => (
          <View key={area.area}>
            <Text style={styles.area}>{area.area}</Text>
            <View style={styles.head}>
              {columns.map((column) => (
                <Text key={column.label} style={[styles.cell, { width: column.width, fontWeight: 700 }]}>
                  {column.label}
                </Text>
              ))}
            </View>
            {snapshot.lines.filter((line) => line.area === area.area).map((line) => {
              const values = [
                line.itemName,
                line.grade,
                line.material,
                line.dimension,
                line.unit,
                String(line.quantity),
                line.unitPrice == null ? '' : formatPackageMoney(Math.round(line.unitPrice * 100)),
                formatPackageMoney(lineCents(line.quantity, line.unitPrice)),
              ];
              return (
                <View key={line.id} style={styles.row}>
                  {values.map((value, index) => (
                    <Text key={columns[index].label} style={[styles.cell, { width: columns[index].width }]}>
                      {value}
                    </Text>
                  ))}
                </View>
              );
            })}
            <Text style={{ marginTop: 3 }}>{`${area.area} 小計 ${formatPackageMoney(area.cents)}`}</Text>
          </View>
        ))}
        <Text style={styles.total}>{`總額 ${formatPackageMoney(totalCents(snapshot.lines))}`}</Text>
        {qrDataUrl ? (
          <View style={styles.qrWrap}>
            <Image src={qrDataUrl} style={styles.qr} />
            <Text>客戶連結</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
  return pdf(doc).toBlob();
}

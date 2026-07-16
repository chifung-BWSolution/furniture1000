/** English quotation delivery + TERMS AND CONDITIONS (from BWF 報價模板-英文版). */

import { DELIVERY_ADDRESS_BLANK, type QuotationDefaultTerms } from '@/lib/quotationDefaultTerms';

export const DEFAULT_QUOTATION_DELIVERY_DETAILS_EN =
  'Production lead time: 3–4 weeks upon receipt of deposit.\nDelivery and installation will be carried out over two days: installation will be completed within 1–2 working days after delivery.';

export const DEFAULT_QUOTATION_TERMS_EN = {
  payment: `A 70% deposit is required before production commences, and the remaining 30% shall be settled before delivery. The Company will not arrange delivery or installation if the balance payment has not been received.
Government agencies and NGOs can begin production after order confirmation, with full payment due within 30 days of receiving the goods.

Bank Account Details:
Account Name: Branding Works Design Ltd

Bank Name: The Hongkong and Shanghai Banking Corporation Limited

Account No.: 747-058683-001

For cheque, bank transfer or credit card payment, the delivery lead time is counted from the date when the payment is actually received in our account.`,
  transport: `3.1 This quotation includes one-time delivery and installation to a single address.
3.2 Delivery does not cover Lantau Island, Cheung Chau, Peng Chau, Lamma Island and other outlying islands, restricted areas, locations inaccessible by 5.5-ton trucks, exhibition venues, warehouses, hotels, renovation units, boats, construction sites or container terminals. For special delivery arrangements (such as hoisting through balcony), the customer shall arrange by themselves or additional charges will apply.
3.3 Standard delivery and installation hours: Monday to Saturday, 09:00–18:00 (excluding public holidays). Additional charges will apply for services outside these hours.
3.4 Delivery may be delayed in case of adverse weather conditions, flooding or road closures. The Company will contact the customer within 24 hours and arrange re-delivery within 7 days.
3.5 During delivery and installation, the site must be safe, clean and free from obstruction. Otherwise, the Company reserves the right to refuse delivery or installation.
3.6 Installation does not include electrical works (such as power socket installation), wall-mounting of hanging cabinets or finishing works. Customers are advised to appoint qualified technicians for such services.
3.7 If knocking on doors or security clearance is required during transportation, the Company shall not be liable for any delay caused to delivery and installation. Re-delivery may be arranged.`,
  extraFees: `4.1 The height of the unloading area must be at least 3.3 metres; otherwise, an additional charge of HKD 200 per item will apply for street unloading.
4.2 Any change of delivery date must be notified by email at least 3 days in advance, otherwise an administration fee of HKD 500 will be charged. The Company provides free storage for the first 5 days; thereafter, HKD 80 per cubic metre per day will be charged.
4.3 If no one is available to receive the goods on the delivery date, re-delivery will be arranged and additional delivery charges will apply.
4.4 Dismantling and disposal of old furniture are not included and will be quoted separately.
4.5 Stair-carrying charge: HKD 100 per cubic metre per floor (limited to 8 floors).
4.6 Delivery distance is limited to within 100 metres from the unloading point; an additional HKD 500 will be charged for every extra 100 metres.`,
  warranty: `5.1 The warranty period is 1 years from the date of delivery. It does not cover improper use, accidental damage or normal wear and tear. After the warranty period, only material costs and transportation/installation charges will be applied for repairs.
5.2 If there is any damage or issue with the products, the customer must notify the Company within 7 days after delivery. If the customer does not accept the goods due to damages or issues, the maximum compensation will be limited to 10% of the product price.
5.3 Defects shall be assessed from a viewing distance of 1000mm. Minor differences such as slight colour variation or edge finishing are excluded from the defect scope.`,
  other: `6.1 Retention of Title: Ownership of the products remains with the Company until full payment of the purchase price has been received.
6.2 For furniture that needs to be fixed to the wall, the wall must have sufficient load-bearing capacity and a backing board must be installed as the structural element for wall-mounting.
6.3 Product colours and patterns may have slight variations due to display differences or production batches. This is considered normal and no return or exchange will be accepted on this basis.
6.4 This quotation is based on the content of the invoice. Pictures and samples are for reference only. Any changes must be confirmed in writing; the Company will not accept any verbal commitments.
6.5 All specifications are confirmed to be correct. This contract shall take effect upon signing and stamping by both parties.
6.6 In case of any dispute arising from the contract where both parties cannot reach an agreement and the dispute cannot be resolved, it shall be submitted to the Hong Kong International Arbitration Centre for arbitration.
6.7 This quotation is valid for 30 days from the date of issue.
6.8 Limitation of Liability: The Company shall not be liable for any indirect loss, such as business loss caused by delay. The maximum liability shall be limited to the total order amount.
6.9 Force Majeure: For events beyond control such as epidemics, pandemics, natural disasters or government restrictions, the Company shall be exempted from relevant liabilities but will use its best endeavours to notify the customer and minimise the impact.`,
} as const satisfies QuotationDefaultTerms;

const BOLD_PAYMENT_LABELS_EN = ['Account Name', 'Bank Name', 'Account No.'] as const;

function sectionHeading(label: string): string {
  return `<p><strong>${label}</strong></p>`;
}

function paymentLineToParagraph(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '<p></p>';
  for (const label of BOLD_PAYMENT_LABELS_EN) {
    const prefix = `${label}:`;
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trimStart();
      return `<p><strong>${label}:</strong> ${value}</p>`;
    }
  }
  return `<p>${trimmed}</p>`;
}

function paymentTextToParagraphs(text: string): string {
  return text.split('\n').map(paymentLineToParagraph).join('');
}

function linesToParagraphsCompact(text: string): string {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `<p>${l}</p>`)
    .join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build English TERMS AND CONDITIONS HTML; inject delivery address into section 1 underline. */
export function buildDefaultTermsFullHtmlEn(deliveryAddress?: string): string {
  const addr = (deliveryAddress || '').trim();
  const underlineInner = addr
    ? escapeHtml(addr)
    : DELIVERY_ADDRESS_BLANK;
  const terms = DEFAULT_QUOTATION_TERMS_EN;
  return [
    `<p><strong>1&nbsp;&nbsp;Delivery Address&nbsp;:</strong>&nbsp;<u>${underlineInner}</u></p>`,
    `<p>The customer must provide an accurate delivery address. This quotation applies to standard areas within Hong Kong.</p>`,
    sectionHeading('2&nbsp;&nbsp;Payment Terms'),
    paymentTextToParagraphs(terms.payment),
    `<p></p>`,
    sectionHeading('3&nbsp;&nbsp;Transportation and Installation'),
    linesToParagraphsCompact(terms.transport),
    `<p></p>`,
    sectionHeading('4&nbsp;&nbsp;Additional Charges'),
    linesToParagraphsCompact(terms.extraFees),
    `<p></p>`,
    sectionHeading('5&nbsp;&nbsp;Warranty and Maintenance'),
    linesToParagraphsCompact(terms.warranty),
    `<p></p>`,
    sectionHeading('6&nbsp;&nbsp;General Terms'),
    linesToParagraphsCompact(terms.other),
  ].join('');
}

export function englishTermsContentForPdf(deliveryAddress?: string) {
  return {
    ...DEFAULT_QUOTATION_TERMS_EN,
    fullHtml: buildDefaultTermsFullHtmlEn(deliveryAddress),
  };
}

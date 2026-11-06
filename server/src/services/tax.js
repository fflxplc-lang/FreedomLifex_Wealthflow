// Invoice taxes from the Tax Settings toggles (Reports → Monthly Payouts):
// GST is added on top of the share, TDS is deducted from it.
import { getSetting } from '../db.js';

const round2 = (n) => Math.round(n * 100) / 100;

export function invoiceTax(base) {
  const inv = getSetting('invoice');
  const gstPct = Number(inv.gstPct ?? getSetting('firm').gst ?? 18) || 0;
  const gst = inv.gstEnabled ? base * gstPct / 100 : 0;
  const tds = inv.tdsEnabled ? base * (Number(inv.tdsPct) || 0) / 100 : 0;
  return { gst: round2(gst), tds: round2(tds), net: round2(base + gst - tds), gstPct };
}

import { jsPDF } from 'jspdf';
import type { AnalyticsBundle } from '../data/types';

export function downloadExecutivePdf(
  bundle: AnalyticsBundle,
  title = 'Integrated Care — Analytics summary'
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 48;
  let y = margin;
  const line = 16;

  doc.setFontSize(14);
  doc.text(title, margin, y);
  y += line * 2;

  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
  y += line * 2;

  doc.setFontSize(11);
  doc.text('Data linkage', margin, y);
  y += line;
  doc.setFontSize(9);
  const lk = [
    `VHA rows: ${bundle.linkage.vhaRowCount}`,
    `Flowsheet rows: ${bundle.linkage.flowsheetRowCount}`,
    `MRN + same hospital DC date: ${bundle.linkage.vhaMrnHospDcMatched}`,
    `Merged with site: ${bundle.linkage.mergedWithSite}`,
    `IP survey n: ${bundle.linkage.peIpRows} (${bundle.linkage.peIpWithClinical} matched MRN)`,
    `IC survey n: ${bundle.linkage.peIcRows} (${bundle.linkage.peIcWithClinical} matched MRN)`,
  ];
  for (const t of lk) {
    doc.text(t, margin, y);
    y += line;
  }
  y += line;

  if (bundle.surveyIp) {
    doc.setFontSize(11);
    doc.text('Inpatient survey (approx.)', margin, y);
    y += line;
    doc.setFontSize(9);
    doc.text(`NPS-style score (0–10 recommend): ${bundle.surveyIp.nps ?? '—'}`, margin, y);
    y += line;
    doc.text(
      `% overall experience ≥8: ${bundle.surveyIp.pctOverallGte8?.toFixed(1) ?? '—'}%`,
      margin,
      y
    );
    y += line * 2;
  }

  if (bundle.surveyIc) {
    doc.setFontSize(11);
    doc.text('Integrated Care survey (approx.)', margin, y);
    y += line;
    doc.setFontSize(9);
    doc.text(
      `% IC rating ≥4 (1–5): ${bundle.surveyIc.pctRatingGte4?.toFixed(1) ?? '—'}%`,
      margin,
      y
    );
    y += line * 2;
  }

  doc.setFontSize(11);
  doc.text('Latest month clinical pathways (volume)', margin, y);
  y += line;
  doc.setFontSize(8);
  const last = bundle.clinicalRollups[bundle.clinicalRollups.length - 1];
  if (last) {
    doc.text(`Month: ${last.monthLabel}`, margin, y);
    y += line;
    for (const p of last.byPathway.slice(0, 12)) {
      doc.text(
        `${p.carePath} [${p.site}] vol=${p.volume}, 24h=${p.contact24Pct?.toFixed(0) ?? '—'}%`,
        margin,
        y
      );
      y += line;
      if (y > 720) {
        doc.addPage();
        y = margin;
      }
    }
  }

  doc.save('ic-analytics-summary.pdf');
}

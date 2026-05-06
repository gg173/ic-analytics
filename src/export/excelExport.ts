import * as XLSX from 'xlsx';
import type { AnalyticsBundle, LinkageMismatchLists } from '../data/types';

function mismatchRowsToSheet(rows: Record<string, unknown>[]): XLSX.WorkSheet {
  if (!rows.length) {
    return XLSX.utils.aoa_to_sheet([
      ['No rows matching this linkage bucket for the current uploads.'],
    ]);
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  return ws;
}

/** Excel workbook with sheets `VHA_only` and `Flowsheet_only` (same linkage rules as the dashboard). */
export function linkageMismatchToWorkbook(
  lists: LinkageMismatchLists
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    mismatchRowsToSheet(lists.vhaOnlyRows),
    'VHA_only'
  );
  XLSX.utils.book_append_sheet(
    wb,
    mismatchRowsToSheet(lists.flowsheetOnlyRows),
    'Flowsheet_only'
  );
  return wb;
}

export function downloadLinkageMismatchExcel(bundle: AnalyticsBundle): void {
  const wb = linkageMismatchToWorkbook(bundle.linkageMismatchLists);
  downloadWorkbook(wb, 'linkage-vha-fs-only.xlsx');
}

export function analyticsToWorkbook(bundle: AnalyticsBundle): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const linkageRows = [
    ['Metric', 'Value'],
    ['VHA rows', bundle.linkage.vhaRowCount],
    ['Flowsheet rows', bundle.linkage.flowsheetRowCount],
    [
      'VHA ↔ Flowsheet MRN + same hospital DC date',
      bundle.linkage.vhaMrnHospDcMatched,
    ],
    ['Merged rows with Hospital Site', bundle.linkage.mergedWithSite],
    ['Merged rows without Hospital Site', bundle.linkage.mergedWithoutSite],
    ['IP survey rows', bundle.linkage.peIpRows],
    ['IC survey rows', bundle.linkage.peIcRows],
    ['IP survey rows with MRN in clinical', bundle.linkage.peIpWithClinical],
    ['IC survey rows with MRN in clinical', bundle.linkage.peIcWithClinical],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(linkageRows),
    'Linkage'
  );

  for (const roll of bundle.clinicalRollups) {
    const header = [
      'CARE PATH (VHA)',
      'Site',
      'Volume',
      '% Contact 24h',
      '% Weekend DC',
      'Avg 24/7 calls/pt',
      'Avg check-in calls/pt',
    ];
    const data: (string | number)[][] = [header];
    for (const p of roll.byPathway) {
      data.push([
        p.carePath,
        p.site,
        p.volume,
        p.contact24Pct === null ? '-' : p.contact24Pct.toFixed(1),
        p.weekendPct === null ? '-' : p.weekendPct.toFixed(1),
        p.avgSupportLinePerPt === null
          ? '-'
          : p.avgSupportLinePerPt.toFixed(2),
        p.avgCheckInPerPt === null
          ? '-'
          : p.avgCheckInPerPt.toFixed(2),
      ]);
    }
    const safeName = roll.monthKey.slice(0, 28).replace(/[*?:/\\[\]]/g, '_');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(data),
      `Clinical_${safeName}`
    );
  }

  if (bundle.surveyIp || bundle.surveyIc) {
    const sx: (string | number | null)[][] = [['Survey', 'Metric', 'Value']];
    if (bundle.surveyIp) {
      sx.push(['IP', 'n', bundle.surveyIp.n]);
      sx.push(['IP', 'NPS (approx)', bundle.surveyIp.nps ?? '']);
      sx.push([
        'IP',
        '% overall ≥8 (approx)',
        bundle.surveyIp.pctOverallGte8 ?? '',
      ]);
    }
    if (bundle.surveyIc) {
      sx.push(['IC', 'n', bundle.surveyIc.n]);
      sx.push([
        'IC',
        '% rating ≥4',
        bundle.surveyIc.pctRatingGte4 ?? '',
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sx), 'Surveys');
  }

  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

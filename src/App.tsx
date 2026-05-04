import { useCallback, useState } from 'react';
import { buildAnalytics, type ParsedInputs } from './analytics/buildAnalytics';
import { parseSheetFromBuffer } from './ingest/parseXlsx';
import { parseCsvBuffer } from './ingest/parseCsv';
import { analyticsToWorkbook, downloadWorkbook } from './export/excelExport';
import { downloadExecutivePdf } from './export/pdfExport';
import type { AnalyticsBundle } from './data/types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './App.css';

type Slot = 'vha' | 'flowsheet' | 'peIp' | 'peIc';

const SLOT_LABEL: Record<Slot, string> = {
  vha: 'VHA extract (.xlsx)',
  flowsheet: 'Flowsheet extract (.xlsx)',
  peIp: 'Inpatient survey (.csv)',
  peIc: 'IC survey (.csv)',
};

async function fileToBuffer(f: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(f);
  });
}

export default function App() {
  const [files, setFiles] = useState<Partial<Record<Slot, File>>>({});
  const [bundle, setBundle] = useState<AnalyticsBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<'clinical' | 'experience' | 'linkage'>(
    'clinical'
  );

  const onFile = (slot: Slot, file: File | null) => {
    setFiles((prev) => {
      const n = { ...prev };
      if (file) n[slot] = file;
      else delete n[slot];
      return n;
    });
    setBundle(null);
  };

  const clearAll = () => {
    setFiles({});
    setBundle(null);
  };

  const generate = useCallback(async () => {
    setBusy(true);
    setBundle(null);
    try {
      const inputs: ParsedInputs = {};

      if (files.vha) {
        const buf = await fileToBuffer(files.vha);
        let pr = parseSheetFromBuffer(buf, 'Export');
        if (pr.errors.length && !pr.rows.length) {
          pr = parseSheetFromBuffer(buf);
        }
        inputs.vha = { rows: pr.rows, sheet: 'Export' };
      }

      if (files.flowsheet) {
        const buf = await fileToBuffer(files.flowsheet);
        const pr = parseSheetFromBuffer(buf);
        inputs.flowsheet = { rows: pr.rows };
      }

      if (files.peIp) {
        const buf = await fileToBuffer(files.peIp);
        const pr = parseCsvBuffer(buf);
        inputs.peIp = { rows: pr.rows, headers: pr.headers };
      }

      if (files.peIc) {
        const buf = await fileToBuffer(files.peIc);
        const pr = parseCsvBuffer(buf);
        inputs.peIc = { rows: pr.rows, headers: pr.headers };
      }

      const b = buildAnalytics(inputs);
      setBundle(b);
    } finally {
      setBusy(false);
    }
  }, [files]);

  const exportXlsx = () => {
    if (!bundle) return;
    const wb = analyticsToWorkbook(bundle);
    downloadWorkbook(wb, 'ic-analytics-export.xlsx');
  };

  const exportPdf = () => {
    if (!bundle) return;
    downloadExecutivePdf(bundle);
  };

  const chartData =
    bundle?.clinicalRollups.map((r) => ({
      month: r.monthLabel,
      volume: r.byPathway.reduce((s, p) => s + p.volume, 0),
    })) ?? [];

  return (
    <div className="app">
      <header className="hero">
        <h1>IC Analytics Portal</h1>
        <p className="lead">
          Upload extracts and survey CSVs. All processing stays in your browser —
          nothing is sent to a server. Clear data when finished on shared devices.
        </p>
        <button type="button" className="btn btn-ghost" onClick={clearAll}>
          Clear all data
        </button>
      </header>

      <section className="panel">
        <h2>1. Uploads</h2>
        <div className="upload-grid">
          {(Object.keys(SLOT_LABEL) as Slot[]).map((slot) => (
            <label key={slot} className="file-slot">
              <span>{SLOT_LABEL[slot]}</span>
              <input
                type="file"
                accept={slot.startsWith('pe') ? '.csv' : '.xlsx,.xls'}
                onChange={(e) =>
                  onFile(slot, e.target.files?.[0] ?? null)
                }
              />
              {files[slot] && (
                <span className="fname">{files[slot]!.name}</span>
              )}
            </label>
          ))}
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !files.vha}
            onClick={() => void generate()}
          >
            {busy ? 'Working…' : 'Generate analytics'}
          </button>
          {!files.vha && (
            <span className="hint">VHA extract is required.</span>
          )}
        </div>
      </section>

      {bundle && (
        <>
          {bundle.errors.length > 0 && (
            <section className="panel error-panel">
              <h2>Errors</h2>
              <ul>
                {bundle.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </section>
          )}

          {bundle.warnings.length > 0 && (
            <section className="panel warn-panel">
              <h2>Warnings</h2>
              <ul>
                {bundle.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <div className="tabs">
              <button
                type="button"
                className={active === 'clinical' ? 'active' : ''}
                onClick={() => setActive('clinical')}
              >
                Clinical KPIs
              </button>
              <button
                type="button"
                className={active === 'experience' ? 'active' : ''}
                onClick={() => setActive('experience')}
              >
                Patient experience
              </button>
              <button
                type="button"
                className={active === 'linkage' ? 'active' : ''}
                onClick={() => setActive('linkage')}
              >
                Linkage
              </button>
              <div className="export-btns">
                <button type="button" className="btn btn-secondary" onClick={exportXlsx}>
                  Download Excel
                </button>
                <button type="button" className="btn btn-secondary" onClick={exportPdf}>
                  Download PDF summary
                </button>
              </div>
            </div>

            {active === 'clinical' && (
              <div className="report">
                <h3>
                  Enrolment volume by month (MRN + same hospital DC date as Flowsheet;
                  month = hospital DC)
                </h3>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="volume"
                        fill="var(--accent)"
                        name="Linked enrolments"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {bundle.clinicalRollups.map((roll) => (
                  <div key={roll.monthKey} className="rollup">
                    <h4>{roll.monthLabel}</h4>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>CARE PATH (VHA)</th>
                            <th>Site</th>
                            <th>Volume</th>
                            <th>% 24h contact</th>
                            <th>% weekend DC</th>
                            <th>Avg 24/7 / pt</th>
                            <th>Avg check-in / pt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roll.byPathway.map((p) => (
                            <tr key={p.pathwayId}>
                              <td>{p.carePath}</td>
                              <td>{p.site}</td>
                              <td>{p.volume}</td>
                              <td>
                                {p.contact24Pct === null
                                  ? '—'
                                  : `${p.contact24Pct.toFixed(1)}%`}
                              </td>
                              <td>
                                {p.weekendPct === null
                                  ? '—'
                                  : `${p.weekendPct.toFixed(1)}%`}
                              </td>
                              <td>
                                {p.avgSupportLinePerPt === null
                                  ? '—'
                                  : p.avgSupportLinePerPt.toFixed(2)}
                              </td>
                              <td>
                                {p.avgCheckInPerPt === null
                                  ? '—'
                                  : p.avgCheckInPerPt.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {active === 'experience' && (
              <div className="report">
                <div className="cards">
                  <div className="card">
                    <h4>Inpatient survey</h4>
                    {bundle.surveyIp ? (
                      <>
                        <p>
                          Responses: <strong>{bundle.surveyIp.n}</strong>
                        </p>
                        <p>
                          Approx. NPS (0–10 recommend):{' '}
                          <strong>
                            {bundle.surveyIp.nps ?? '—'}
                          </strong>
                        </p>
                        <p>
                          % overall ≥8 (approx.):{' '}
                          <strong>
                            {bundle.surveyIp.pctOverallGte8?.toFixed(1) ?? '—'}%
                          </strong>
                        </p>
                        {bundle.surveyIp.testimonialSamples.length > 0 && (
                          <>
                            <h5>Sample comments (truncated)</h5>
                            <ul className="quotes">
                              {bundle.surveyIp.testimonialSamples.map((t, i) => (
                                <li key={i}>{t}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    ) : (
                      <p>No inpatient CSV loaded.</p>
                    )}
                  </div>
                  <div className="card">
                    <h4>Integrated Care survey</h4>
                    {bundle.surveyIc ? (
                      <>
                        <p>
                          Responses: <strong>{bundle.surveyIc.n}</strong>
                        </p>
                        <p>
                          % rating ≥4 (1–5):{' '}
                          <strong>
                            {bundle.surveyIc.pctRatingGte4?.toFixed(1) ?? '—'}%
                          </strong>
                        </p>
                        {bundle.surveyIc.testimonialSamples.length > 0 && (
                          <>
                            <h5>Sample comments (truncated)</h5>
                            <ul className="quotes">
                              {bundle.surveyIc.testimonialSamples.map((t, i) => (
                                <li key={i}>{t}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    ) : (
                      <p>No IC survey CSV loaded.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {active === 'linkage' && (
              <div className="report">
                <table className="data-table">
                  <tbody>
                    <tr>
                      <td>VHA rows</td>
                      <td>{bundle.linkage.vhaRowCount}</td>
                    </tr>
                    <tr>
                      <td>Flowsheet rows</td>
                      <td>{bundle.linkage.flowsheetRowCount}</td>
                    </tr>
                    <tr>
                      <td>VHA ↔ Flowsheet (MRN + same hospital DC date)</td>
                      <td>{bundle.linkage.vhaMrnHospDcMatched}</td>
                    </tr>
                    <tr>
                      <td>Merged rows with Hospital Site</td>
                      <td>{bundle.linkage.mergedWithSite}</td>
                    </tr>
                    <tr>
                      <td>Merged rows without Hospital Site</td>
                      <td>{bundle.linkage.mergedWithoutSite}</td>
                    </tr>
                    <tr>
                      <td>IP survey rows</td>
                      <td>{bundle.linkage.peIpRows}</td>
                    </tr>
                    <tr>
                      <td>IP rows with MRN in clinical cohort</td>
                      <td>{bundle.linkage.peIpWithClinical}</td>
                    </tr>
                    <tr>
                      <td>IC survey rows</td>
                      <td>{bundle.linkage.peIcRows}</td>
                    </tr>
                    <tr>
                      <td>IC rows with MRN in clinical cohort</td>
                      <td>{bundle.linkage.peIcWithClinical}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

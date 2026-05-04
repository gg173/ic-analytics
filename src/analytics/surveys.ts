import { normalizePatientId } from '../identity/patientId';
import type { SurveyIcSummary, SurveyIpSummary } from '../data/types';

function firstDigitScore(text: string): number | null {
  const m = text.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function summarizeIpSurvey(
  rows: Record<string, unknown>[],
  headers: string[],
  _clinicalPatientKeys: Set<string>
): SurveyIpSummary {
  const overallCol = headers.find((h) =>
    /overall.*scale.*0.*10/i.test(h)
  );
  const recommendCol = headers.find((h) =>
    /recommend.*friends/i.test(h)
  );
  const commentCol = headers.find((h) =>
    /what else would you like/i.test(h)
  );

  let n = 0;
  let nRecommend = 0;
  let promoters = 0;
  let detractors = 0;
  let overallGte8 = 0;
  let overallN = 0;
  const testimonials: string[] = [];

  for (const row of rows) {
    n += 1;

    if (recommendCol) {
      const raw = row[recommendCol];
      const s = raw === null || raw === undefined ? '' : String(raw);
      const score = firstDigitScore(s);
      if (score !== null) {
        nRecommend += 1;
        if (score >= 9 && score <= 10) promoters += 1;
        if (score >= 0 && score <= 6) detractors += 1;
      }
    }

    if (overallCol) {
      const raw = row[overallCol];
      const s = raw === null || raw === undefined ? '' : String(raw);
      const score = firstDigitScore(s);
      if (score !== null) {
        overallN += 1;
        if (score >= 8) overallGte8 += 1;
      }
    }

    if (commentCol) {
      const t = row[commentCol];
      if (t && String(t).trim().length > 20 && testimonials.length < 5) {
        testimonials.push(redactTestimonial(String(t)));
      }
    }
  }

  const npsDenom = promoters + detractors;
  const nps =
    nRecommend > 0 && npsDenom > 0
      ? Math.round(((promoters - detractors) / nRecommend) * 100)
      : null;

  const pctOverallGte8 =
    overallN > 0 ? (100 * overallGte8) / overallN : null;

  return {
    n,
    nRecommend,
    nps,
    pctOverallGte8,
    testimonialSamples: testimonials,
  };
}

export function summarizeIcSurvey(
  rows: Record<string, unknown>[],
  headers: string[],
  _clinicalPatientKeys: Set<string>
): SurveyIcSummary {
  const ratingCol = headers.find((h) =>
    /Integrated Care Program.*1-5/i.test(h)
  );
  const commentCol = headers.find((h) =>
    /what else would you like/i.test(h)
  );

  let n = 0;
  let gte4 = 0;
  const testimonials: string[] = [];

  for (const row of rows) {
    n += 1;
    if (ratingCol) {
      const raw = row[ratingCol];
      const score =
        typeof raw === 'number'
          ? raw
          : firstDigitScore(String(raw ?? ''));
      if (score !== null && score >= 4) gte4 += 1;
    }
    if (commentCol) {
      const t = row[commentCol];
      if (t && String(t).trim().length > 20 && testimonials.length < 5) {
        testimonials.push(redactTestimonial(String(t)));
      }
    }
  }

  return {
    n,
    pctRatingGte4: n > 0 ? (100 * gte4) / n : null,
    testimonialSamples: testimonials,
  };
}

function redactTestimonial(s: string): string {
  const cut = s.slice(0, 280);
  return cut.length < s.length ? `${cut}…` : cut;
}

export function countSurveyLinkage(
  rows: Record<string, unknown>[],
  patientIdHeader: string | undefined,
  clinical: Set<string>
): number {
  if (!patientIdHeader) return 0;
  let c = 0;
  for (const row of rows) {
    const pk = normalizePatientId(row[patientIdHeader]);
    if (pk && clinical.has(pk)) c += 1;
  }
  return c;
}

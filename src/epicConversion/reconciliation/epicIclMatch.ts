import { mapEpicIclToVhaIcl } from './epicIclMap';

function stripParentheticals(value: string): string {
  return value.replace(/\([^)]*\)/g, '').replace(/#[^\s,]*/g, '').trim();
}

/** Display form of VHA SSDB ic_lead (drops `(UHN)` and `(#id)` suffixes per name). */
export function formatVhaIcLeadDisplay(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const primary = value.split(';')[0].trim();
  const parts = primary
    .split(',')
    .map((part) => stripParentheticals(part).trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

export interface ParsedIclName {
  surname: string;
  given: string;
}

/** Epic export format: `MANALO, HERSHEY` */
export function parseEpicIcl(value: string | null | undefined): ParsedIclName | null {
  if (!value?.trim()) return null;
  const [surnameRaw, givenRaw] = value.split(',').map((part) => part.trim());
  if (!surnameRaw) return null;
  return {
    surname: surnameRaw.toUpperCase(),
    given: (givenRaw ?? '').toUpperCase(),
  };
}

/** VHA SSDB format: `MANALO (UHN), HERSHEY (#17725)` */
export function parseVhaIcl(value: string | null | undefined): ParsedIclName | null {
  if (!value?.trim()) return null;
  const primary = value.split(';')[0].trim();
  const commaIndex = primary.indexOf(',');
  if (commaIndex === -1) {
    return { surname: stripParentheticals(primary).toUpperCase(), given: '' };
  }
  const surname = stripParentheticals(primary.slice(0, commaIndex)).toUpperCase();
  const given = stripParentheticals(primary.slice(commaIndex + 1)).toUpperCase();
  const givenToken = given.split(/\s+/)[0] ?? '';
  return { surname, given: givenToken };
}

function vhaIclContainsExpected(vhaIcl: string, expectedVhaIcl: string): boolean {
  const expected = expectedVhaIcl.trim();
  if (vhaIcl.trim() === expected) return true;
  return vhaIcl
    .split(';')
    .some((segment) => segment.trim() === expected);
}

function fuzzyIclNamesMatch(epicIcl: string | null | undefined, vhaIcl: string | null | undefined): boolean {
  const epic = parseEpicIcl(epicIcl);
  const vha = parseVhaIcl(vhaIcl);
  if (!epic || !vha) {
    return (epicIcl ?? '').trim().toLowerCase() === (vhaIcl ?? '').trim().toLowerCase();
  }
  if (epic.surname !== vha.surname) return false;
  if (!epic.given || !vha.given) return true;
  const epicGiven = epic.given.replace(/\s+/g, '');
  const vhaGiven = vha.given.replace(/\s+/g, '');
  return vhaGiven.startsWith(epicGiven) || epicGiven.startsWith(vhaGiven);
}

export function iclNamesMatch(
  epicIcl: string | null | undefined,
  vhaIcl: string | null | undefined
): boolean {
  if (!epicIcl?.trim() || !vhaIcl?.trim()) {
    return (epicIcl ?? '').trim().toLowerCase() === (vhaIcl ?? '').trim().toLowerCase();
  }

  const expectedVhaIcl = mapEpicIclToVhaIcl(epicIcl);
  if (expectedVhaIcl && vhaIclContainsExpected(vhaIcl, expectedVhaIcl)) {
    return true;
  }

  return fuzzyIclNamesMatch(epicIcl, vhaIcl);
}

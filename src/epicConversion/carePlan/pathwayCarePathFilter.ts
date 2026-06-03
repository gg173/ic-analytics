import type { CarePlanPatientLink } from './types';

/** Middle segment of a care path key (e.g. CP-THR-VAT → THR). */
export function extractCarePathPathwaySegment(carePath: string): string {
  const segments = carePath.split('-').map((segment) => segment.trim());
  return segments[1] || carePath;
}

/** Whether a VHA pathway code corresponds to a care path segment (e.g. UHN-THR ↔ THR). */
export function carePathBelongsToPathway(carePath: string, pathway: string): boolean {
  const segment = extractCarePathPathwaySegment(carePath);
  const code = pathway.trim().toUpperCase();
  const seg = segment.trim().toUpperCase();
  if (!code || !seg) return false;
  const parts = code.split('-').map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 && parts[1] === seg;
}

export interface PathwayCarePathFilterGroup {
  pathway: string;
  carePaths: string[];
}

export function buildPathwayCarePathFilterGroups(
  links: readonly Pick<CarePlanPatientLink, 'pathway' | 'carePath'>[]
): PathwayCarePathFilterGroup[] {
  const pathways = new Set<string>();
  const carePathsByPathway = new Map<string, Set<string>>();

  const ensurePathway = (pathway: string) => {
    pathways.add(pathway);
    if (!carePathsByPathway.has(pathway)) {
      carePathsByPathway.set(pathway, new Set());
    }
  };

  for (const link of links) {
    const pathway = link.pathway?.trim();
    const carePath = link.carePath?.trim();
    if (pathway) ensurePathway(pathway);
    if (!carePath) continue;

    const assignedPathway =
      pathway && carePathBelongsToPathway(carePath, pathway)
        ? pathway
        : [...pathways].find((candidate) => carePathBelongsToPathway(carePath, candidate)) ??
          pathway ??
          `UHN-${extractCarePathPathwaySegment(carePath)}`;

    ensurePathway(assignedPathway);
    carePathsByPathway.get(assignedPathway)!.add(carePath);
  }

  return [...pathways]
    .sort((a, b) => a.localeCompare(b))
    .map((pathway) => ({
      pathway,
      carePaths: [...(carePathsByPathway.get(pathway) ?? [])].sort((a, b) =>
        a.localeCompare(b)
      ),
    }));
}

export function flattenPathwayCarePathFilterOptions(
  groups: readonly PathwayCarePathFilterGroup[]
): string[] {
  return groups.flatMap((group) => group.carePaths);
}

export function pathwayOnlyFilterOptions(
  groups: readonly PathwayCarePathFilterGroup[]
): string[] {
  return groups.filter((group) => group.carePaths.length === 0).map((group) => group.pathway);
}

export type PathwayCarePathFilterSelection = {
  /** null = all care paths selected. */
  carePaths: string[] | null;
  /** null = all pathway-only rows selected (pathways with no care paths in data). */
  pathwaysOnly: string[] | null;
};

export const PATHWAY_CARE_PATH_FILTER_ALL: PathwayCarePathFilterSelection = {
  carePaths: null,
  pathwaysOnly: null,
};

export const PATHWAY_CARE_PATH_FILTER_NONE: PathwayCarePathFilterSelection = {
  carePaths: [],
  pathwaysOnly: [],
};

export function isPathwayCarePathFilterActive(
  selection: PathwayCarePathFilterSelection
): boolean {
  return selection.carePaths !== null || selection.pathwaysOnly !== null;
}

export function isPathwayCarePathFilterAllSelected(
  selection: PathwayCarePathFilterSelection
): boolean {
  return selection.carePaths === null && selection.pathwaysOnly === null;
}

function pathwayFilterValueListsEqual(
  a: readonly string[] | null,
  b: readonly string[] | null
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function toggleValuesInList(
  selected: readonly string[] | null,
  allValues: readonly string[],
  values: readonly string[]
): string[] | null {
  const current = selected ?? [...allValues];
  const allIncluded = values.length > 0 && values.every((value) => current.includes(value));
  const next = allIncluded
    ? current.filter((value) => !values.includes(value))
    : [...new Set([...current, ...values])];

  if (next.length === 0) return [];
  if (allValues.length > 0 && allValues.every((value) => next.includes(value))) return null;
  return next;
}

export function togglePathwayGroupInSelection(
  selection: PathwayCarePathFilterSelection,
  group: PathwayCarePathFilterGroup,
  groups: readonly PathwayCarePathFilterGroup[]
): PathwayCarePathFilterSelection {
  if (group.carePaths.length > 0) {
    const allCarePaths = flattenPathwayCarePathFilterOptions(groups);
    return {
      ...selection,
      carePaths: toggleValuesInList(selection.carePaths, allCarePaths, group.carePaths),
      pathwaysOnly: null,
    };
  }

  const allPathwaysOnly = pathwayOnlyFilterOptions(groups);
  return {
    ...selection,
    pathwaysOnly: toggleValuesInList(selection.pathwaysOnly, allPathwaysOnly, [group.pathway]),
  };
}

export function toggleCarePathInSelection(
  selection: PathwayCarePathFilterSelection,
  carePath: string,
  groups: readonly PathwayCarePathFilterGroup[]
): PathwayCarePathFilterSelection {
  const allCarePaths = flattenPathwayCarePathFilterOptions(groups);
  return {
    ...selection,
    carePaths: toggleValuesInList(selection.carePaths, allCarePaths, [carePath]),
    pathwaysOnly: null,
  };
}

export function effectiveCarePathSelection(
  selection: PathwayCarePathFilterSelection,
  groups: readonly PathwayCarePathFilterGroup[]
): string[] {
  const all = flattenPathwayCarePathFilterOptions(groups);
  return selection.carePaths ?? all;
}

export function effectivePathwaysOnlySelection(
  selection: PathwayCarePathFilterSelection,
  groups: readonly PathwayCarePathFilterGroup[]
): string[] {
  const all = pathwayOnlyFilterOptions(groups);
  return selection.pathwaysOnly ?? all;
}

export function isPathwayGroupChecked(
  group: PathwayCarePathFilterGroup,
  selection: PathwayCarePathFilterSelection,
  groups: readonly PathwayCarePathFilterGroup[]
): boolean {
  if (group.carePaths.length > 0) {
    const effective = effectiveCarePathSelection(selection, groups);
    return group.carePaths.every((carePath) => effective.includes(carePath));
  }
  return effectivePathwaysOnlySelection(selection, groups).includes(group.pathway);
}

export function isPathwayGroupIndeterminate(
  group: PathwayCarePathFilterGroup,
  selection: PathwayCarePathFilterSelection,
  groups: readonly PathwayCarePathFilterGroup[]
): boolean {
  if (isPathwayGroupChecked(group, selection, groups)) return false;
  if (group.carePaths.length === 0) return false;
  const effective = effectiveCarePathSelection(selection, groups);
  return group.carePaths.some((carePath) => effective.includes(carePath));
}

export function prunePathwayCarePathFilterSelection(
  selection: PathwayCarePathFilterSelection,
  groups: readonly PathwayCarePathFilterGroup[]
): PathwayCarePathFilterSelection {
  if (!isPathwayCarePathFilterActive(selection)) return selection;

  const allCarePaths = flattenPathwayCarePathFilterOptions(groups);
  const allPathwaysOnly = pathwayOnlyFilterOptions(groups);

  const validCarePaths =
    selection.carePaths?.filter((carePath) => allCarePaths.includes(carePath)) ?? null;
  const validPathwaysOnly =
    selection.pathwaysOnly?.filter((pathway) => allPathwaysOnly.includes(pathway)) ?? null;

  const carePaths =
    validCarePaths === null
      ? null
      : validCarePaths.length === 0
        ? []
        : validCarePaths.length === allCarePaths.length
          ? null
          : validCarePaths;
  const pathwaysOnly =
    validPathwaysOnly === null
      ? null
      : validPathwaysOnly.length === 0
        ? []
        : validPathwaysOnly.length === allPathwaysOnly.length
          ? null
          : validPathwaysOnly;

  if (
    pathwayFilterValueListsEqual(carePaths, selection.carePaths) &&
    pathwayFilterValueListsEqual(pathwaysOnly, selection.pathwaysOnly)
  ) {
    return selection;
  }
  return { carePaths, pathwaysOnly };
}

function pathwayGroupFullySelected(
  group: PathwayCarePathFilterGroup,
  effectiveCarePaths: readonly string[],
  effectivePathwaysOnly: readonly string[]
): boolean {
  if (group.carePaths.length > 0) {
    return group.carePaths.every((carePath) => effectiveCarePaths.includes(carePath));
  }
  return effectivePathwaysOnly.includes(group.pathway);
}

export function matchesPathwayCarePathFilter(
  link: Pick<CarePlanPatientLink, 'pathway' | 'carePath'>,
  selection: PathwayCarePathFilterSelection,
  groups: readonly PathwayCarePathFilterGroup[]
): boolean {
  if (!isPathwayCarePathFilterActive(selection)) return true;

  const effectiveCarePaths = effectiveCarePathSelection(selection, groups);
  const effectivePathwaysOnly = effectivePathwaysOnlySelection(selection, groups);

  if (!effectiveCarePaths.length && !effectivePathwaysOnly.length) return false;

  const carePath = link.carePath?.trim();
  const pathway = link.pathway?.trim();

  if (carePath) {
    return effectiveCarePaths.includes(carePath);
  }

  if (pathway) {
    const group = groups.find((entry) => entry.pathway === pathway);
    if (group) {
      return pathwayGroupFullySelected(group, effectiveCarePaths, effectivePathwaysOnly);
    }
    return effectivePathwaysOnly.includes(pathway);
  }

  return false;
}

export function linkMatchesPathwayCarePathScope(
  link: Pick<CarePlanPatientLink, 'pathway' | 'carePath'>,
  selection: PathwayCarePathFilterSelection,
  groups: readonly PathwayCarePathFilterGroup[]
): boolean {
  if (!isPathwayCarePathFilterActive(selection)) return true;
  return matchesPathwayCarePathFilter(link, selection, groups);
}

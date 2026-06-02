import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type {
  DischargeDateSource,
  EpicConversionInsertRow,
  EpicConversionRecord,
  IclDecision,
} from '../types';
import {
  buildSsdbAbsenceDischargeUpdate,
  enrollIdsAbsentFromSsdbUpload,
} from '../ingest/ssdbReconciliation';
import {
  countStrategyBreakdown,
  DISCHARGE_STRATEGY,
  EPISODE_CONVERSION_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
  type StrategyBreakdown,
} from '../progress/recordStrategyTabs';

export type DischargeStatusTarget = 'icl' | 'episode';
export type EpisodeConversionStatusTarget = 'icl' | 'discharge';

export interface DischargeDetailsUpdate {
  discharge_date_source: DischargeDateSource | null;
  discharge_date: string | null;
  discharge_reason: string | null;
}

const INSERT_CHUNK = 400;
const ENROLL_ID_LOOKUP_CHUNK = 500;
export interface EpicConversionInsertOptions {
  /** When set, enrollees missing from this upload are auto-discharged (SSDB only). */
  ssdbUploadEnrollIds?: ReadonlySet<string>;
  dischargedBy?: string;
}

export interface EpicConversionInsertResult {
  error: string | null;
  inserted: number;
  skippedDuplicates: number;
  autoDischarged: number;
  strategyBreakdown: StrategyBreakdown;
}

export function useEpicConversionRecords() {
  const [records, setRecords] = useState<EpicConversionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('epic_conversion_records')
      .select('*')
      .order('imported_at', { ascending: false })
      .order('mrn', { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      setRecords([]);
    } else {
      setRecords((data as EpicConversionRecord[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dischargeAbsentFromSsdbUpload = useCallback(
    async (
      uploadEnrollIds: ReadonlySet<string>,
      dischargedBy: string
    ): Promise<{ error: string | null; count: number }> => {
      const { data, error: fetchError } = await supabase
        .from('epic_conversion_records')
        .select('id, enroll_id, lvd, hosp_dc_date, registration_date, pathway')
        .not('enroll_id', 'is', null)
        .is('status', null);

      if (fetchError) return { error: fetchError.message, count: 0 };

      const activeRecords = (data ?? []) as Pick<
        EpicConversionRecord,
        'id' | 'enroll_id' | 'lvd' | 'hosp_dc_date' | 'registration_date' | 'pathway'
      >[];
      const absentEnrollIds = enrollIdsAbsentFromSsdbUpload(activeRecords, uploadEnrollIds);
      if (!absentEnrollIds.length) return { error: null, count: 0 };

      const absentEnrollIdSet = new Set(absentEnrollIds);
      const recordsToDischarge = activeRecords.filter(
        (r) => r.enroll_id && absentEnrollIdSet.has(r.enroll_id)
      );
      const dischargedAt = new Date().toISOString();
      let count = 0;

      for (const record of recordsToDischarge) {
        const update = buildSsdbAbsenceDischargeUpdate(record, dischargedBy, dischargedAt);
        const { error: updateError } = await supabase
          .from('epic_conversion_records')
          .update(update)
          .eq('id', record.id);

        if (updateError) return { error: updateError.message, count };
        count += 1;
      }

      return { error: null, count };
    },
    []
  );

  const insertRows = useCallback(async (
    rows: EpicConversionInsertRow[],
    importedBy?: string | null,
    options?: EpicConversionInsertOptions
  ): Promise<EpicConversionInsertResult> => {
    const enrollIds = [
      ...new Set(rows.map((row) => row.enroll_id).filter((id): id is string => !!id)),
    ];

    const existingEnrollIds = new Set<string>();
    for (let i = 0; i < enrollIds.length; i += ENROLL_ID_LOOKUP_CHUNK) {
      const batch = enrollIds.slice(i, i + ENROLL_ID_LOOKUP_CHUNK);
      const { data, error: lookupError } = await supabase
        .from('epic_conversion_records')
        .select('enroll_id')
        .in('enroll_id', batch);

      if (lookupError) {
        return {
          error: lookupError.message,
          inserted: 0,
          skippedDuplicates: 0,
          autoDischarged: 0,
          strategyBreakdown: countStrategyBreakdown([]),
        };
      }
      for (const row of data ?? []) {
        if (row.enroll_id) existingEnrollIds.add(row.enroll_id);
      }
    }

    const rowsToInsert = rows.filter(
      (row) => !row.enroll_id || !existingEnrollIds.has(row.enroll_id)
    );
    const skippedDuplicates = rows.length - rowsToInsert.length;

    if (rowsToInsert.length) {
      // Stamp every chunk with one shared timestamp so a single upload groups as
      // one import in the UI (rather than one per 400-row chunk).
      const importedAt = new Date().toISOString();
      for (let i = 0; i < rowsToInsert.length; i += INSERT_CHUNK) {
        const chunk = rowsToInsert
          .slice(i, i + INSERT_CHUNK)
          .map((row) => ({
            ...row,
            imported_at: importedAt,
            imported_by: importedBy ?? null,
          }));
        const { error: insertError } = await supabase.from('epic_conversion_records').insert(chunk);
        if (insertError) {
          return {
            error: insertError.message,
            inserted: 0,
            skippedDuplicates,
            autoDischarged: 0,
            strategyBreakdown: countStrategyBreakdown([]),
          };
        }
      }
    }

    let autoDischarged = 0;
    if (options?.ssdbUploadEnrollIds && options.dischargedBy) {
      const { error: reconcileError, count } = await dischargeAbsentFromSsdbUpload(
        options.ssdbUploadEnrollIds,
        options.dischargedBy
      );
      if (reconcileError) {
        return {
          error: reconcileError,
          inserted: rowsToInsert.length,
          skippedDuplicates,
          autoDischarged: 0,
          strategyBreakdown: countStrategyBreakdown(rowsToInsert),
        };
      }
      autoDischarged = count;
    }

    await refresh();
    return {
      error: null,
      inserted: rowsToInsert.length,
      skippedDuplicates,
      autoDischarged,
      strategyBreakdown: countStrategyBreakdown(rowsToInsert),
    };
  }, [dischargeAbsentFromSsdbUpload, refresh]);

  const setIclDecision = useCallback(
    async (id: string, decision: IclDecision, decisionBy: string | null) => {
      const icl_decision = decision === 'pending' ? null : decision;
      const icl_decision_by = decision === 'pending' ? null : decisionBy;
      const icl_decision_at = decision === 'pending' ? null : new Date().toISOString();

      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ icl_decision, icl_decision_by, icl_decision_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                icl_decision,
                icl_decision_by,
                icl_decision_at,
                updated_at: new Date().toISOString(),
              }
            : r
        )
      );
      return { error: null as string | null };
    },
    []
  );

  const setDischargeDetails = useCallback(
    async (id: string, details: DischargeDetailsUpdate) => {
      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update(details)
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                ...details,
                updated_at: new Date().toISOString(),
              }
            : r
        )
      );
      return { error: null as string | null };
    },
    []
  );

  const submitDischarge = useCallback(async (id: string, dischargedBy: string) => {
    const discharged_at = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('epic_conversion_records')
      .update({
        status: 'discharged',
        discharged_by: dischargedBy,
        discharged_at,
      })
      .eq('id', id);

    if (updateError) return { error: updateError.message };

    setRecords((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'discharged',
              discharged_by: dischargedBy,
              discharged_at,
              updated_at: discharged_at,
            }
          : r
      )
    );
    return { error: null as string | null };
  }, []);

  const undoDischarge = useCallback(async (id: string) => {
    const { error: updateError } = await supabase
      .from('epic_conversion_records')
      .update({
        status: null,
        discharged_by: null,
        discharged_at: null,
        discharge_date_source: null,
        discharge_date: null,
        discharge_reason: null,
      })
      .eq('id', id);

    if (updateError) return { error: updateError.message };

    setRecords((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: null,
              discharged_by: null,
              discharged_at: null,
              discharge_date_source: null,
              discharge_date: null,
              discharge_reason: null,
              updated_at: new Date().toISOString(),
            }
          : r
      )
    );
    return { error: null as string | null };
  }, []);

  const clearDischargePendingFields = {
    discharge_date_source: null,
    discharge_date: null,
    discharge_reason: null,
  } as const;

  const changeFromDischargePending = useCallback(
    async (
      id: string,
      target: DischargeStatusTarget,
      context: {
        episode_conversion_strategy: string | null;
      },
      decisionBy: string | null
    ) => {
      const strategy = context.episode_conversion_strategy;
      const isIclReassessment = strategy === ICL_REASSESSMENT_STRATEGY;
      const isDirectDischarge = strategy === DISCHARGE_STRATEGY;

      let update: Record<string, unknown>;
      if (target === 'icl') {
        if (isIclReassessment) {
          update = {
            ...clearDischargePendingFields,
            icl_decision: null,
            icl_decision_by: null,
            icl_decision_at: null,
          };
        } else if (isDirectDischarge) {
          update = {
            ...clearDischargePendingFields,
            episode_conversion_strategy: ICL_REASSESSMENT_STRATEGY,
            icl_decision: null,
            icl_decision_by: null,
            icl_decision_at: null,
          };
        } else {
          return { error: 'This record cannot be moved to ICL Decision from discharge.' };
        }
      } else if (isIclReassessment) {
        update = {
          ...clearDischargePendingFields,
          icl_decision: 'convert',
          icl_decision_by: decisionBy,
          icl_decision_at: decisionBy ? new Date().toISOString() : null,
        };
      } else if (isDirectDischarge) {
        update = {
          ...clearDischargePendingFields,
          episode_conversion_strategy: EPISODE_CONVERSION_STRATEGY,
        };
      } else {
        return { error: 'This record cannot be moved to Episode Conversion from discharge.' };
      }

      const updated_at = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ ...update, updated_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...update, updated_at } : r))
      );
      return { error: null as string | null };
    },
    []
  );

  const changeFromEpisodeConversionPending = useCallback(
    async (
      id: string,
      target: EpisodeConversionStatusTarget,
      context: {
        episode_conversion_strategy: string | null;
        icl_decision: EpicConversionRecord['icl_decision'];
      },
      decisionBy: string | null
    ) => {
      const strategy = context.episode_conversion_strategy;
      const isIclReassessment = strategy === ICL_REASSESSMENT_STRATEGY;
      const isEpisodeConversion = strategy === EPISODE_CONVERSION_STRATEGY;
      const completionClears = { completed_by: null, completed_at: null } as const;

      let update: Record<string, unknown>;
      if (target === 'discharge') {
        if (isIclReassessment && context.icl_decision === 'convert') {
          update = {
            ...clearDischargePendingFields,
            ...completionClears,
            icl_decision: 'discharge',
            icl_decision_by: decisionBy,
            icl_decision_at: decisionBy ? new Date().toISOString() : null,
          };
        } else if (isEpisodeConversion) {
          update = {
            ...completionClears,
            episode_conversion_strategy: DISCHARGE_STRATEGY,
          };
        } else {
          return { error: 'This record cannot be moved to discharge from episode conversion.' };
        }
      } else if (isIclReassessment && context.icl_decision === 'convert') {
        update = {
          ...completionClears,
          icl_decision: null,
          icl_decision_by: null,
          icl_decision_at: null,
        };
      } else if (isEpisodeConversion) {
        update = {
          ...completionClears,
          episode_conversion_strategy: ICL_REASSESSMENT_STRATEGY,
          icl_decision: null,
          icl_decision_by: null,
          icl_decision_at: null,
        };
      } else {
        return { error: 'This record cannot be moved to ICL Decision from episode conversion.' };
      }

      const updated_at = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ ...update, updated_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...update, updated_at } : r))
      );
      return { error: null as string | null };
    },
    []
  );

  const setCompletion = useCallback(
    async (id: string, completedBy: string | null) => {
      const completed_by = completedBy;
      const completed_at = completedBy ? new Date().toISOString() : null;

      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ completed_by, completed_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, completed_by, completed_at, updated_at: new Date().toISOString() }
            : r
        )
      );
      return { error: null as string | null };
    },
    []
  );

  const setCarePlanCompletion = useCallback(
    async (id: string, completedBy: string | null) => {
      const care_plan_completed_by = completedBy;
      const care_plan_completed_at = completedBy ? new Date().toISOString() : null;

      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ care_plan_completed_by, care_plan_completed_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                care_plan_completed_by,
                care_plan_completed_at,
                updated_at: new Date().toISOString(),
              }
            : r
        )
      );
      return { error: null as string | null };
    },
    []
  );

  const deleteImport = useCallback(
    async (sourceFilename: string, importedAt: string) => {
      const { error: deleteError } = await supabase
        .from('epic_conversion_records')
        .delete()
        .eq('source_filename', sourceFilename)
        .eq('imported_at', importedAt);

      if (deleteError) return { error: deleteError.message };
      await refresh();
      return { error: null as string | null };
    },
    [refresh]
  );

  return {
    records,
    loading,
    error,
    refresh,
    insertRows,
    setCompletion,
    setCarePlanCompletion,
    changeFromDischargePending,
    changeFromEpisodeConversionPending,
    setDischargeDetails,
    submitDischarge,
    undoDischarge,
    setIclDecision,
    deleteImport,
  };
}

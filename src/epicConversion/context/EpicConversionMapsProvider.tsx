import { createContext, useContext, type ReactNode } from 'react';
import { useEpicIclMaps, type EpicIclNameMapRow } from '../hooks/useEpicIclMaps';
import { useEpicPathwayMaps, type EpicPathwayNameMapRow } from '../hooks/useEpicPathwayMaps';

interface MapSlice<TRow> {
  rows: TRow[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface EpicConversionMapsContextValue {
  icl: MapSlice<EpicIclNameMapRow>;
  pathway: MapSlice<EpicPathwayNameMapRow>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const EpicConversionMapsContext = createContext<EpicConversionMapsContextValue | null>(null);

export function EpicConversionMapsProvider({ children }: { children: ReactNode }) {
  const icl = useEpicIclMaps();
  const pathway = useEpicPathwayMaps();

  const value: EpicConversionMapsContextValue = {
    icl: {
      rows: icl.rows,
      loading: icl.loading,
      error: icl.error,
      refresh: icl.refresh,
    },
    pathway: {
      rows: pathway.rows,
      loading: pathway.loading,
      error: pathway.error,
      refresh: pathway.refresh,
    },
    loading: icl.loading || pathway.loading,
    refresh: async () => {
      await Promise.all([icl.refresh(), pathway.refresh()]);
    },
  };

  return (
    <EpicConversionMapsContext.Provider value={value}>{children}</EpicConversionMapsContext.Provider>
  );
}

export function useEpicConversionMapsContext(): EpicConversionMapsContextValue {
  const ctx = useContext(EpicConversionMapsContext);
  if (!ctx) {
    throw new Error('useEpicConversionMapsContext must be used within EpicConversionMapsProvider');
  }
  return ctx;
}

export function useEpicConversionMapsContextOptional(): EpicConversionMapsContextValue | null {
  return useContext(EpicConversionMapsContext);
}

/** @deprecated Use EpicConversionMapsProvider */
export const EpicIclMapProvider = EpicConversionMapsProvider;

/** @deprecated Use useEpicConversionMapsContext().icl */
export function useEpicIclMapContext(): MapSlice<EpicIclNameMapRow> & { refresh: () => Promise<void> } {
  const { icl } = useEpicConversionMapsContext();
  return icl;
}

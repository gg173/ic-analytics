import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../homecare/hooks/useAuth';
import {
  ICL_MAPPING_CRUD_CONFIG,
  MappingCrudTable,
  PATHWAY_MAPPING_CRUD_CONFIG,
} from '../epicConversion/components/MappingCrudTable';
import { useEpicConversionMapsContext } from '../epicConversion/context/EpicConversionMapsProvider';

type AdminTab = 'icl' | 'pathway';

export function EpicConversionAdminPage() {
  const { canManageEpicIclMaps } = useAuth();
  const { icl, pathway, loading, refresh } = useEpicConversionMapsContext();
  const [tab, setTab] = useState<AdminTab>('icl');
  const [message, setMessage] = useState<string | null>(null);

  if (!canManageEpicIclMaps) {
    return <Navigate to="/epic-conversion" replace />;
  }

  const activeError = tab === 'icl' ? icl.error : pathway.error;

  return (
    <div className="hc-page">
      <p className="hc-muted">
        <Link to="/epic-conversion">← Epic Conversion</Link>
      </p>
      <h1>Epic conversion mappings</h1>
      <p className="hc-muted">
        Manage Epic-to-VHA label mappings used when importing conversion reports and reconciling
        against SSDB data. Changes apply immediately without re-uploading files.
      </p>
      {(activeError || message) && (
        <div className="hc-admin-messages">
          {activeError && <p className="hc-error">{activeError}</p>}
          {message && <p className="hc-info">{message}</p>}
        </div>
      )}

      <div className="hc-filter-bar">
        <button
          type="button"
          className={`hc-chip${tab === 'icl' ? ' hc-chip--active' : ''}`}
          onClick={() => setTab('icl')}
        >
          ICL mappings
        </button>
        <button
          type="button"
          className={`hc-chip${tab === 'pathway' ? ' hc-chip--active' : ''}`}
          onClick={() => setTab('pathway')}
        >
          Pathway mappings
        </button>
      </div>

      {loading ? (
        <p className="hc-muted">Loading mappings…</p>
      ) : tab === 'icl' ? (
        <MappingCrudTable
          config={ICL_MAPPING_CRUD_CONFIG}
          rows={icl.rows}
          onRefresh={refresh}
          onMessage={setMessage}
        />
      ) : (
        <MappingCrudTable
          config={PATHWAY_MAPPING_CRUD_CONFIG}
          rows={pathway.rows}
          onRefresh={refresh}
          onMessage={setMessage}
        />
      )}
    </div>
  );
}

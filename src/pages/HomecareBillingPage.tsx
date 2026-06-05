import { useCallback, useState } from 'react';
import { useAuth } from '../homecare/hooks/useAuth';
import { usePayPeriods } from '../billing/hooks/usePayPeriods';
import { useVhaPayCycles } from '../billing/hooks/useVhaPayCycles';
import { DashboardTab } from '../billing/components/DashboardTab';
import { PayCyclesTab } from '../billing/components/PayCyclesTab';
import { RulesTab } from '../billing/components/RulesTab';
import { FileImportTab } from '../billing/components/FileImportTab';

type BillingTab = 'dashboard' | 'pay_cycles' | 'file_import' | 'rules';

const TAB_LABELS: Record<BillingTab, string> = {
  dashboard:   'Dashboard',
  pay_cycles:  'Pay Cycles',
  file_import: 'File Import',
  rules:       'Rules',
};

export function HomecareBillingPage() {
  const { user, profile, canEdit, isUhnAdmin, isAppAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<BillingTab>('pay_cycles');
  // Track the most recent service date seen in an upload so Pay Cycles
  // can navigate its calendar to the right month
  const [importedDate, setImportedDate] = useState<string | null>(null);

  const {
    payPeriods,
    loading: periodsLoading,
    error: periodsError,
    refresh: refreshPeriods,
  } = usePayPeriods();

  const { cycles: vhaCycles, loading: cyclesLoading } = useVhaPayCycles();

  const canEditRules = isAppAdmin || isUhnAdmin;

  const handleImportComplete = useCallback(async (mostRecentDate: string | null) => {
    setImportedDate(mostRecentDate);
    await refreshPeriods();
  }, [refreshPeriods]);

  if (!user) return null;

  return (
    <>
      {/* ── Tab bar ─────────────────────────────────────────── */}
      <div className="hc-page hc-page--split">
        <nav
          className="hc-strategy-tabs hc-strategy-tabs--below-title"
          aria-label="Billing workspace"
        >
          <div className="hc-strategy-tabs-list">
            {(Object.keys(TAB_LABELS) as BillingTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`hc-strategy-tab${activeTab === tab ? ' hc-strategy-tab--active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </nav>

        {periodsError && (
          <p className="hc-form-error" style={{ padding: '0 1.5rem' }}>
            {periodsError}
          </p>
        )}
      </div>

      {/* ── Tab content ─────────────────────────────────────── */}
      <div className="hc-epic-page-content hc-billing-page-content">
        {activeTab === 'dashboard' && (
          <DashboardTab
            payPeriods={payPeriods}
            vhaCycles={vhaCycles}
            periodsLoading={periodsLoading}
            cyclesLoading={cyclesLoading}
          />
        )}

        {activeTab === 'pay_cycles' && (
          <PayCyclesTab
            payPeriods={payPeriods}
            loading={periodsLoading}
            error={periodsError}
            canEdit={canEdit}
            profile={profile}
            onRefresh={refreshPeriods}
            initialDate={importedDate}
          />
        )}

        {activeTab === 'file_import' && (
          <FileImportTab
            profile={profile}
            canEdit={canEdit}
            onImportComplete={handleImportComplete}
          />
        )}

        {activeTab === 'rules' && (
          <RulesTab canEditRules={canEditRules} />
        )}
      </div>
    </>
  );
}

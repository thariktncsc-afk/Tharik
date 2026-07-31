'use client';

/**
 * Application Settings — React port of src/markup/pageSettings.ts.
 *
 * Same rows and layout. The fields that actually persist (__config: the
 * organisation name and the cereal account number) are bound to the data
 * layer; the remaining rows were demo-only in the legacy screen and stay
 * static here too. Save flushes the store and shows the same banner.
 *
 * Backup & Restore works against the data layer: export downloads every
 * store in the engine's own backup shape (a legacy export restores here and
 * vice versa); restore writes the stores back and persists them. The users
 * roster is server-owned (hashed passwords) and is exported for reference
 * but never restored from a file.
 */
import { useRef, useState } from 'react';
import { crsData, useStore, type StoreKey } from '@/lib/dataStore';
import { useUsers } from '@/lib/dataStore';

type Config = {
  orgName?: string;
  regionName?: string;
  accountLabel?: string;
  submitToOffice?: string;
  cerealAccountNo?: string;
};

/** The engine's backup format (BACKUP_STORES in 18-backup-init.js). */
const BACKUP_KEYS: { key: StoreKey; kind: 'object' | 'array' }[] = [
  { key: 'entryStore', kind: 'object' },
  { key: 'inspectionStore', kind: 'object' },
  { key: 'monthlyStore', kind: 'object' },
  { key: 'meManualStore', kind: 'object' },
  { key: 'meSourceStore', kind: 'object' },
  { key: 'meRemitStore', kind: 'object' },
  { key: 'meGunnyStore', kind: 'object' },
  { key: 'meCardStore', kind: 'object' },
  { key: 'salesCloseStore', kind: 'object' },
  { key: 'receiptStore', kind: 'array' },
];

export default function SettingsPage() {
  const config = useStore<Config>('__config') ?? {};
  const counters = useStore<Record<string, number>>('__counters') ?? {};
  const users = useUsers();
  const [savedBanner, setSavedBanner] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{ msg: string; tone: 'ok' | 'warn' | 'error' } | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const setConfig = (patch: Partial<Config>) => {
    crsData.update<Config>('__config', (draft) => Object.assign(draft, patch));
  };

  const save = async () => {
    await crsData.save();
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 3000);
  };

  const status = (msg: string, tone: 'ok' | 'warn' | 'error') => setBackupStatus({ msg, tone });

  const collectBackup = () => {
    const data: Record<string, unknown> = {};
    for (const st of BACKUP_KEYS) {
      data[st.key] = crsData.get(st.key) ?? (st.kind === 'array' ? [] : {});
    }
    data.userStore = users; // reference only — never restored from a file
    data.__counters = counters;
    data.__meta = { exportedAt: new Date().toISOString(), source: 'nextjs' };
    return data;
  };

  const exportBackup = () => {
    try {
      const json = JSON.stringify(collectBackup(), null, 2);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tncsc-crs-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setRawText(json);
      status('Backup exported.', 'ok');
    } catch (e) {
      status(`Could not build the backup: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  const applyBackup = async (parsed: Record<string, unknown>, sourceName: string) => {
    let applied = 0;
    for (const st of BACKUP_KEYS) {
      const v = parsed[st.key];
      if (v === undefined || v === null) continue;
      const okShape = st.kind === 'array' ? Array.isArray(v) : typeof v === 'object' && !Array.isArray(v);
      if (!okShape) continue;
      crsData.set(st.key, v);
      applied++;
    }
    if (parsed.__counters && typeof parsed.__counters === 'object') {
      crsData.set('__counters', parsed.__counters);
    }
    if (!applied) {
      status(`${sourceName} did not contain any recognisable stores.`, 'error');
      return;
    }
    const saved = await crsData.save();
    status(
      `Restored ${applied} module(s) from ${sourceName}${saved ? ' and saved to the server' : ' — saving…'}.` +
        ' Users are managed by the server and were not changed.',
      'ok',
    );
  };

  const importFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => status(`Could not read ${file.name}.`, 'error');
    reader.onload = () => {
      try {
        void applyBackup(JSON.parse(String(reader.result)), file.name);
      } catch (e) {
        status(`That file is not valid backup JSON (${e instanceof Error ? e.message : e}).`, 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  };

  const importText = () => {
    if (!rawText.trim()) {
      status('Paste backup JSON into the box first.', 'warn');
      return;
    }
    try {
      void applyBackup(JSON.parse(rawText), 'pasted text');
    } catch (e) {
      status(`That text is not valid backup JSON (${e instanceof Error ? e.message : e}).`, 'error');
    }
  };

  const copyRaw = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      status('Backup JSON copied to the clipboard.', 'ok');
    } catch {
      status('Could not copy automatically — select the text and copy it manually.', 'warn');
    }
  };

  const toneStyle =
    backupStatus?.tone === 'error'
      ? { background: '#FEE2E2', color: '#991B1B' }
      : backupStatus?.tone === 'warn'
        ? { background: '#FEF3C7', color: '#92400E' }
        : { background: '#DCFCE7', color: '#15803D' };

  const row = (title: string, key: string, control: React.ReactNode) => (
    <div className="stat-row">
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="text-sm text-muted font-mono">{key}</div>
      </div>
      <div style={{ width: 300 }}>{control}</div>
    </div>
  );

  return (
    <div className="page active" id="page-settings">
      <div className="page-header">
        <div className="page-title">Application Settings</div>
        <div className="page-sub">Configure system-wide settings</div>
      </div>
      <div className="card">
        {savedBanner ? (
          <div className="success-banner" style={{ margin: '16px 16px 0' }}>
            ✅ Settings saved successfully.
          </div>
        ) : null}
        <div style={{ padding: '0 20px' }}>
          {row('Application Name', 'app_name', <input defaultValue="TNCSC CRS Statement Management System" readOnly />)}
          {row(
            'Organisation Name',
            'org_name',
            <input
              value={config.orgName ?? 'Tamil Nadu Civil Supplies Corporation'}
              onChange={(e) => setConfig({ orgName: e.target.value })}
            />,
          )}
          {row('Financial Year Start Month', 'financial_year_start_month', <input defaultValue={4} type="number" min={1} max={12} readOnly />)}
          {row('Max Login Attempts', 'max_login_attempts', <input defaultValue={3} type="number" readOnly />)}
          {row('Account Lock Duration (Minutes)', 'account_lock_minutes', <input defaultValue={30} type="number" readOnly />)}
          {row(
            'Cereal Account Number',
            'cereal_account_no',
            <input
              value={config.cerealAccountNo ?? ''}
              onChange={(e) => setConfig({ cerealAccountNo: e.target.value.trim() })}
            />,
          )}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={() => void save()}>
            💾 Save Settings
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Backup &amp; Restore</div>
          <div className="text-sm text-muted" style={{ marginBottom: 14 }}>
            Data is saved to the server automatically. Export a backup file for an extra copy, or
            restore one to roll every module back to that snapshot.
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={exportBackup}>
              ⬇ Export Backup (.json)
            </button>
            <button
              className="btn"
              style={{ background: '#F1F5F9', color: '#334155', border: '1px solid #CBD5E1' }}
              onClick={() => fileRef.current?.click()}
            >
              ⬆ Restore from File
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => importFile(e.currentTarget)}
            />
            <button
              className="btn"
              style={{ background: '#F1F5F9', color: '#334155', border: '1px solid #CBD5E1' }}
              onClick={() => setRawOpen((v) => !v)}
            >
              ⌨ Paste / Copy JSON
            </button>
          </div>

          {backupStatus ? (
            <div
              style={{
                marginTop: 12,
                padding: '9px 13px',
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 600,
                ...toneStyle,
              }}
            >
              {backupStatus.msg}
            </div>
          ) : null}

          {rawOpen ? (
            <div style={{ marginTop: 12 }}>
              <div className="text-sm text-muted" style={{ marginBottom: 6 }}>
                Use this when file download or upload is blocked (for example inside a preview frame).
              </div>
              <textarea
                spellCheck={false}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                style={{
                  width: '100%',
                  height: 150,
                  fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
                  fontSize: 11,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 9,
                }}
                placeholder="Paste backup JSON here to restore, or press Export to fill this box."
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  className="btn"
                  style={{ background: '#F1F5F9', color: '#334155', border: '1px solid #CBD5E1' }}
                  onClick={() => void copyRaw()}
                >
                  📋 Copy
                </button>
                <button className="btn btn-primary" onClick={importText}>
                  Restore from pasted text
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

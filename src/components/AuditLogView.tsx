import { useState } from "react";
import { useAppState } from "../lib/app-state";
import { AuditAction, AuditActionDisplayNames } from "../lib/audit";
import { exportAuditLogCSV } from "../lib/export";
import { formatDateTime } from "../lib/utils";
import { HelpPanel } from "./HelpPanel";

export function AuditLogView() {
  const { auditLog } = useAppState();
  const [filterAction, setFilterAction] = useState<string>("all");

  const filtered = filterAction === "all"
    ? auditLog
    : auditLog.filter((e) => e.action === filterAction);

  // Newest first
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const downloadCSV = () => {
    const content = exportAuditLogCSV(sorted);
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit_log.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Audit Log</h1>
      <HelpPanel subtitle="Timestamped record of every import, sale, edit, and deletion for IRS documentation." />

      <div className="flex items-center gap-4 mb-6">
        <select
          className="select text-sm"
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
        >
          <option value="all">All Actions</option>
          {Object.values(AuditAction).map((a) => (
            <option key={a} value={a}>{AuditActionDisplayNames[a]}</option>
          ))}
        </select>
        {sorted.length > 0 && (
          <button className="btn-secondary text-sm" onClick={downloadCSV}>
            📊 Export CSV
          </button>
        )}
        <span className="text-sm text-gray-400">{sorted.length} entries</span>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4 opacity-50">📝</div>
          <h2 className="text-xl text-gray-500">No audit entries</h2>
          <p className="text-gray-400 mt-2">Actions you take will be logged here</p>
        </div>
      ) : (
        <div className="card">
          <div className="grid grid-cols-[180px_180px_1fr] gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-200 dark:border-gray-700">
            <div>Timestamp</div>
            <div>Action</div>
            <div>Details</div>
          </div>
          {sorted.map((entry) => (
            <div key={entry.id} className="grid grid-cols-[180px_180px_1fr] gap-2 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
              <div className="text-gray-500 tabular-nums">{formatDateTime(entry.timestamp)}</div>
              <div>
                <span className="badge badge-blue text-xs">
                  {AuditActionDisplayNames[entry.action]}
                </span>
              </div>
              <div className="text-gray-600 dark:text-gray-400 truncate">{entry.details}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

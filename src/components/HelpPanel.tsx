import { useState } from "react";

interface HelpPanelProps {
  subtitle: string;
  expandedContent?: React.ReactNode;
}

/**
 * Contextual help for each view.
 * Shows a brief subtitle, with an optional expandable "How it works" panel.
 */
export function HelpPanel({ subtitle, expandedContent }: HelpPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-6">
      <p className="text-gray-500 text-sm">{subtitle}</p>
      {expandedContent && (
        <>
          <button
            onClick={() => setOpen(!open)}
            className="text-xs text-orange-500 hover:text-orange-600 mt-1 flex items-center gap-1"
          >
            <span className={`inline-block transition-transform duration-150 ${open ? "rotate-90" : ""}`}>▶</span>
            {open ? "Hide details" : "How it works"}
          </button>
          {open && (
            <div className="mt-3 p-4 rounded-lg bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-gray-200 space-y-2 animate-fade-in border border-gray-200 dark:border-zinc-700">
              {expandedContent}
            </div>
          )}
        </>
      )}
    </div>
  );
}

import React from 'react';
import { Gavel } from 'lucide-react';

export const DecisionList: React.FC = () => {
  const decisions = [
    { id: '1', content: 'Use React + Vite for Phase 4 frontend' },
    { id: '2', content: 'Tailwind CSS as the primary styling framework' },
    { id: '3', content: 'SQLite for local data persistence' },
  ];

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <h3 className="font-bold text-slate-800 flex items-center gap-2">
        <Gavel className="w-4 h-4 text-amber-500" />
        Decisions
      </h3>
      
      <div className="space-y-3">
        {decisions.map(decision => (
          <div key={decision.id} className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-900 flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            {decision.content}
          </div>
        ))}
      </div>
    </div>
  );
};

import React from 'react';
import { FileText, Sparkles } from 'lucide-react';

export const SummaryView: React.FC = () => {
  const summary = "Today's discussion focused on the Phase 4 dashboard implementation. The team decided to use React + Vite + Tailwind CSS for the frontend. Key priorities include real-time processing status and a clean overview of AI-extracted tasks. We also identified a potential bottleneck in the transcription API which needs further investigation in Phase 5.";

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-600" />
          Latest Summary
        </h3>
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">
          <Sparkles className="w-3 h-3" />
          AI Generated
        </span>
      </div>
      
      <div className="flex-1 bg-slate-50 p-5 rounded-xl border border-dashed border-slate-200">
        <p className="text-slate-600 leading-relaxed italic">
          "{summary}"
        </p>
      </div>
    </div>
  );
};

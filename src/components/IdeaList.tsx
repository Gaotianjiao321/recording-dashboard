import React from 'react';
import { Lightbulb } from 'lucide-react';

export const IdeaList: React.FC = () => {
  const ideas = [
    { id: '1', content: 'Add a search feature for past recordings' },
    { id: '2', content: 'Integration with Google Calendar for automatic summaries' },
    { id: '3', content: 'Voice-controlled dashboard navigation' },
  ];

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <h3 className="font-bold text-slate-800 flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-emerald-500" />
        Ideas
      </h3>
      
      <div className="space-y-3">
        {ideas.map(idea => (
          <div key={idea.id} className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-900 flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            {idea.content}
          </div>
        ))}
      </div>
    </div>
  );
};

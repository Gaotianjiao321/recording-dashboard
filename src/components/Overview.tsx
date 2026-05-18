import React from 'react';
import { Mic, Loader2, Clock } from 'lucide-react';

export const Overview: React.FC = () => {
  // Mock data - in real app would use useQuery
  const stats = {
    todayCount: 5,
    processingCount: 1,
    totalDuration: '1h 24m'
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
      <h3 className="font-bold text-slate-800 flex items-center gap-2">
        <Mic className="w-4 h-4 text-indigo-600" />
        Daily Overview
      </h3>
      
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-sm font-medium">Today's Recordings</p>
            <p className="text-2xl font-bold text-slate-800">{stats.todayCount}</p>
          </div>
          <div className="bg-white p-2 rounded-lg shadow-sm">
            <Mic className="w-5 h-5 text-indigo-500" />
          </div>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-sm font-medium">Processing Now</p>
            <p className="text-2xl font-bold text-indigo-600 flex items-center gap-2">
              {stats.processingCount}
              <Loader2 className="w-5 h-5 animate-spin" />
            </p>
          </div>
          <div className="bg-white p-2 rounded-lg shadow-sm">
            <Clock className="w-5 h-5 text-slate-400" />
          </div>
        </div>
      </div>
    </div>
  );
};

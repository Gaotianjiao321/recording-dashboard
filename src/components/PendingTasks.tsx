import React, { useState } from 'react';
import { Check, X, ClipboardList, Clock } from 'lucide-react';
import { Task } from '../types';

export const PendingTasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([
    { id: '1', title: 'Confirm the UI design with the design team', status: 'pending_confirm', createdAt: '2026-05-18T10:30:00Z', source: 'Meeting at 10:00 AM' },
    { id: '2', title: 'Schedule Phase 5 integration test', status: 'pending_confirm', createdAt: '2026-05-18T11:15:00Z', source: 'Internal Sync' },
    { id: '3', title: 'Update documentation for the new API endpoints', status: 'pending_confirm', createdAt: '2026-05-18T11:45:00Z', source: 'Developer Discussion' },
  ]);

  const handleConfirm = (id: string) => {
    setTasks(tasks.filter(t => t.id !== id));
  };

  const handleDismiss = (id: string) => {
    setTasks(tasks.filter(t => t.id !== id));
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-indigo-600" />
          Pending Tasks
          <span className="ml-2 bg-rose-100 text-rose-600 text-xs px-2 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </h3>
      </div>
      
      <div className="divide-y divide-slate-100">
        {tasks.length > 0 ? (
          tasks.map(task => (
            <div key={task.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-slate-700 font-medium mb-1">{task.title}</p>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span>•</span>
                  <span>{task.source}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button 
                  onClick={() => handleDismiss(task.id)}
                  className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                  title="Dismiss"
                >
                  <X className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => handleConfirm(task.id)}
                  className="p-2 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all"
                  title="Confirm"
                >
                  <Check className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="p-12 flex flex-col items-center justify-center text-slate-400">
            <Check className="w-12 h-12 mb-2 opacity-20" />
            <p>All tasks confirmed!</p>
          </div>
        )}
      </div>
    </div>
  );
};

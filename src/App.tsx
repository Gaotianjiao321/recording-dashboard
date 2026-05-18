import React from 'react';
import { 
  LayoutDashboard, 
  CheckCircle2, 
  MessageSquareQuestion, 
  Lightbulb, 
  FileText, 
  Mic,
  Settings,
  Bell
} from 'lucide-react';
import { Overview } from './components/Overview';
import { PendingTasks } from './components/PendingTasks';
import { DecisionList } from './components/DecisionList';
import { QuestionList } from './components/QuestionList';
import { SummaryView } from './components/SummaryView';
import { IdeaList } from './components/IdeaList';

function App() {
  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-slate-800 text-lg">Joy Recorder</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <a href="#" className="flex items-center gap-3 p-3 bg-indigo-50 text-indigo-700 rounded-xl font-medium">
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </a>
          <a href="#" className="flex items-center gap-3 p-3 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <CheckCircle2 className="w-5 h-5" />
            Tasks
          </a>
          <a href="#" className="flex items-center gap-3 p-3 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <MessageSquareQuestion className="w-5 h-5" />
            Questions
          </a>
          <a href="#" className="flex items-center gap-3 p-3 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <Lightbulb className="w-5 h-5" />
            Ideas
          </a>
          <a href="#" className="flex items-center gap-3 p-3 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <FileText className="w-5 h-5" />
            History
          </a>
        </nav>
        
        <div className="p-4 border-t border-slate-100">
          <button className="flex items-center gap-3 w-full p-3 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <Settings className="w-5 h-5" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
          <h2 className="text-xl font-semibold text-slate-800">Recording Dashboard</h2>
          <div className="flex items-center gap-4">
            <button className="p-2 text-slate-400 hover:text-slate-600 relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs border border-indigo-200">
              JY
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* Top Row: Overview and Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
              <Overview />
            </div>
            <div className="lg:col-span-2">
              <SummaryView />
            </div>
          </div>

          {/* Middle Row: Pending Tasks */}
          <div>
            <PendingTasks />
          </div>

          {/* Bottom Row: Decisions, Questions, Ideas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-8">
            <DecisionList />
            <QuestionList />
            <IdeaList />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

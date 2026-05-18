import React from 'react';
import { HelpCircle } from 'lucide-react';

export const QuestionList: React.FC = () => {
  const questions = [
    { id: '1', content: 'How to handle long recordings exceeding 1 hour?' },
    { id: '2', content: 'What is the retry strategy for LLM parsing failures?' },
  ];

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <h3 className="font-bold text-slate-800 flex items-center gap-2">
        <HelpCircle className="w-4 h-4 text-rose-500" />
        Open Questions
      </h3>
      
      <div className="space-y-3">
        {questions.map(question => (
          <div key={question.id} className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-900 flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-rose-400"></span>
            {question.content}
          </div>
        ))}
      </div>
    </div>
  );
};

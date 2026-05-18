export interface DashboardStats {
  todayCount: number;
  processingCount: number;
  totalDuration: string;
}

export interface Task {
  id: string;
  title: string;
  status: 'pending_confirm' | 'confirmed' | 'dismissed';
  createdAt: string;
  source: string;
}

export interface Decision {
  id: string;
  content: string;
  createdAt: string;
}

export interface Question {
  id: string;
  content: string;
  createdAt: string;
}

export interface Idea {
  id: string;
  content: string;
  createdAt: string;
}

export interface SummaryData {
  summary: string;
  decisions: Decision[];
  openQuestions: Question[];
  ideas: Idea[];
}

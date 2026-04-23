export interface Job {
  title: string;
  url: string;
  location: string;
  department: string;
}

export interface Analysis {
  title: string;
  requirements: string[];
  nice_to_have: string[];
  match_score: number;
  strengths: string[];
  gaps: string[];
  summary: string;
}

export interface HistoryEntry {
  date: string;
  title: string;
  url: string;
  score: number | null;
  saved_to: string | null;
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface LlmAttemptMetric {
  attempt: number;
  tool_call: string;
  temperature: number;
  latency_ms: number;
  token_usage: TokenUsage;
  error: string | null;
  retry_of: number | null;
}

export interface ContactInfo {
  name?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  location?: string;
}

export type FillMode = 'type' | 'instant_per_field' | 'instant';

export interface AutofillOptions {
  name: string;
  email: string;
  phone?: string;
  linkedin?: string;
  resumeText?: string;
  coverLetter?: string;
  mode?: FillMode;
  typingDelay?: number;
  fieldPause?: number;
}

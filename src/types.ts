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

// ── User profiles ─────────────────────────────────────────────────────────────

export type WorkType       = 'remote' | 'hybrid' | 'on-site' | 'any';
export type FilterMode     = 'hard' | 'soft';
export type ExperienceLevel = 'entry' | 'mid' | 'senior' | 'any';

export const DEPARTMENTS = [
  'Engineering', 'Product', 'Design', 'Sales', 'Marketing',
  'HR', 'Finance', 'Operations', 'Legal', 'Consulting', 'Other',
] as const;
export type Department = typeof DEPARTMENTS[number];

export interface UserPreferences {
  work_type:        WorkType;
  work_type_mode:   FilterMode;
  departments:      Department[];  // empty = "any"
  departments_mode: FilterMode;
  salary_min:       number | null; // in $k, null = not set
  salary_mode:      FilterMode;
  exp_level:        ExperienceLevel;
  exp_level_mode:   FilterMode;
  location_pref:      string;
  location_pref_mode: FilterMode;
}

export interface User {
  id:          number;
  name:        string;
  email:       string;
  phone:       string;
  linkedin:    string;
  resume_text: string;
  created_at:  string;
  updated_at:  string;
  preferences: UserPreferences;
  // Address
  street:      string;
  city:        string;
  state:       string;
  zip:         string;
  // Application facts
  work_authorized:      string;   // 'Yes' | 'No' | ''
  requires_sponsorship: string;   // 'Yes' | 'No' | ''
  available_start:      string;   // e.g. 'Immediately' or '2025-08-01'
  years_experience:     string;   // e.g. '3-5 years'
  ts_proficiency:       string;   // e.g. 'Expert – I write production TS daily'
  llm_frameworks:       string[]; // e.g. ['LangChain', 'Ollama']
  additional_info:      string;
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export interface ApplyEvent {
  type:     'navigating' | 'form_found' | 'filling' | 'field_filled' | 'upload_skipped' | 'paused' | 'error' | 'debug';
  message?: string;
  field?:   string;
  filled?:  number;
  total?:   number;
}

export type AtsType = 'agent' | 'greenhouse' | 'lever' | 'ashby' | 'workable' | '';

export interface JobSite {
  id:       number;
  name:     string;
  url:      string;
  notes:    string;
  active:   boolean;
  added_at: string;
  ats_type: AtsType;
  ats_slug: string;
}

// ── Job feed ──────────────────────────────────────────────────────────────────

export type FeedFilterResult = 'pass' | 'hard_skip' | 'soft_warn';

export interface FeedJobResult {
  job:           Job;
  site_id:       number;
  site_name:     string;
  filter_result: FeedFilterResult;
  warnings:      string[];
  analysis:      Analysis | null;
  analyzed:      boolean;
}

export interface FeedScanEvent {
  type:         string;
  site_id?:     number;
  site_name?:   string;
  site_index?:  number;
  total_sites?: number;
  job_count?:   number;
  skipped?:     number;
  analyzed?:    number;
  from_cache?:  boolean;
  removed?:     { title: string; url: string }[];
  job?:         FeedJobResult & { from_cache?: boolean };
  message?:     string;
}

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

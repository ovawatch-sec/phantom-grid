
export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  scan_count: number;
}

export interface Target {
  id: string;
  project_id: string;
  domain: string;
  is_oos: boolean;
  added_at: string;
}

export interface AdCredentials {
  ad_domain: string;   // e.g. CORP.LOCAL ("" for local auth)
  username: string;
  password: string;
  ntlm_hash: string;   // NT hash for pass-the-hash; alternative to password
}

export interface Scan {
  id: string;
  project_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  tools: string[];
  ad_domain: string;   // non-secret auth metadata (password/hash never stored)
  username: string;
  wordlist: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string;
}

export interface ToolInfo {
  name: string;
  category: string;
  description: string;
  parallel_group: string;
  requires_root: boolean;
  binary_name?: string;
  binary?: string;
  available: boolean;
  availability_error?: string;
}

export interface ToolResult {
  id: string;
  scan_id: string;
  project_id: string;
  tool: string;
  category: string;
  domain: string;
  data: any[];
  count: number;
  elapsed_s: number;
  created_at: string;
  error: string;
}

export interface ScanProgressEvent {
  tool: string;
  status: 'running' | 'done' | 'error' | 'skipped' | 'start' | 'completed' | 'failed' | 'cancelled';
  message: string;
  count: number;
  ts: string;
  domain?: string;
  phase?: string;
  phase_index?: number;
  phase_total?: number;
  completed_tools?: number;
  total_tools?: number;
  overall_completed_tools?: number;
  overall_total_tools?: number;
}

export interface StorageConfig {
  azure_enabled: boolean;
  connection_string: string;
  account_name: string;
  account_key: string;
  table_prefix: string;
}

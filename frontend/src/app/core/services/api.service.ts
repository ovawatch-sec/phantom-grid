
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Project, Target, Scan, ToolResult, ToolInfo, StorageConfig, AdCredentials } from '../models';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = '/api';

  constructor(private http: HttpClient, private auth: AuthService) {}

  // ── Projects ──────────────────────────────────────────────────
  getProjects(): Observable<Project[]> {
    return this.http.get<Project[]>(`${this.base}/projects/`);
  }
  getProject(id: string): Observable<Project> {
    return this.http.get<Project>(`${this.base}/projects/${id}`);
  }
  createProject(name: string, description: string): Observable<Project> {
    return this.http.post<Project>(`${this.base}/projects/`, { name, description });
  }
  deleteProject(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/projects/${id}`);
  }

  // ── Targets ───────────────────────────────────────────────────
  getTargets(projectId: string): Observable<Target[]> {
    return this.http.get<Target[]>(`${this.base}/projects/${projectId}/targets`);
  }
  addTarget(projectId: string, domain: string, isOos = false): Observable<Target> {
    return this.http.post<Target>(`${this.base}/projects/${projectId}/targets`, { domain, is_oos: isOos });
  }
  deleteTarget(projectId: string, targetId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/projects/${projectId}/targets/${targetId}`);
  }

  // ── Scans ─────────────────────────────────────────────────────
  startScan(projectId: string, tools: string[], credentials: AdCredentials,
            wordlist?: string, reusePrevious = false): Observable<Scan> {
    return this.http.post<Scan>(`${this.base}/scans/`, {
      project_id: projectId, tools, credentials, wordlist, reuse_previous: reusePrevious,
    });
  }
  getScans(projectId: string): Observable<Scan[]> {
    return this.http.get<Scan[]>(`${this.base}/scans/${projectId}/list`);
  }
  getScan(scanId: string): Observable<Scan> {
    return this.http.get<Scan>(`${this.base}/scans/${scanId}`);
  }
  cancelScan(scanId: string): Observable<any> {
    return this.http.post<any>(`${this.base}/scans/${scanId}/cancel`, {});
  }

  /** SSE URL carrying the bearer token as a query param (EventSource can't set headers). */
  progressStreamUrl(scanId: string): string {
    const token = this.auth.token;
    const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${this.base}/scans/${scanId}/progress${suffix}`;
  }

  // ── Results ───────────────────────────────────────────────────
  getResults(scanId: string): Observable<ToolResult[]> {
    return this.http.get<ToolResult[]>(`${this.base}/results/${scanId}`);
  }
  getResultsSummary(scanId: string): Observable<any> {
    return this.http.get<any>(`${this.base}/results/${scanId}/summary`);
  }

  // ── Tools ─────────────────────────────────────────────────────
  getTools(): Observable<ToolInfo[]> {
    return this.http.get<ToolInfo[]>(`${this.base}/tools/`);
  }

  // ── Settings ──────────────────────────────────────────────────
  getStorageConfig(): Observable<StorageConfig> {
    return this.http.get<StorageConfig>(`${this.base}/settings/storage`);
  }
  saveStorageConfig(cfg: StorageConfig): Observable<any> {
    return this.http.post<any>(`${this.base}/settings/storage`, cfg);
  }

  artifactUrl(scanId: string, path: string): string {
    return `${this.base}/results/${scanId}/artifact?path=${encodeURIComponent(path)}${this.tokenQuery()}`;
  }

  artifactTextUrl(scanId: string, path: string): string {
    return `${this.base}/results/${scanId}/artifact-text?path=${encodeURIComponent(path)}${this.tokenQuery()}`;
  }

  /** Token as an extra query param — artifacts load via <img>/<a>, which can't set headers. */
  private tokenQuery(): string {
    const token = this.auth.token;
    return token ? `&token=${encodeURIComponent(token)}` : '';
  }
}

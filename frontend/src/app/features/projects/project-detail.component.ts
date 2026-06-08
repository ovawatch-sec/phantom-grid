
import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { Project, Target, Scan, ToolInfo, AdCredentials } from '../../core/models';

const DEFAULT_TOOLS = [
  'host_discovery','lookupsid','asrep_roast','kerberoast',
  'smb_shares','winrm_check','ldap_dump','bloodhound',
  'crack_asrep','crack_kerberoast'
];

// Ordered to match the scan engine's six AD phases.
const TOOL_GROUPS: Record<string, string[]> = {
  'Host Discovery':            ['host_discovery'],
  'User & Group Enumeration':  ['lookupsid'],
  'Kerberos Attacks':          ['asrep_roast','kerberoast'],
  'Shares & Services':         ['smb_shares','winrm_check','ldap_dump'],
  'Graph Collection':          ['bloodhound'],
  'Credential Cracking':       ['crack_asrep','crack_kerberoast'],
};

@Component({
  selector: 'sg-project-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  template: `
    <div class="page">
      <!-- Breadcrumb -->
      <div class="breadcrumb">
        <a routerLink="/projects">Projects</a>
        <span class="sep">›</span>
        <span>{{project()?.name}}</span>
      </div>

      @if (project(); as p) {
        <div class="page-header">
          <div>
            <h1 class="page-title">{{p.name}}</h1>
            @if (p.description) { <p class="page-sub">{{p.description}}</p> }
          </div>
          <button class="btn btn-danger btn-sm" (click)="deleteProject()">Delete Project</button>
        </div>

        <!-- Tabs -->
        <div class="tab-bar">
          <button class="tab-btn" [class.active]="tab==='targets'" (click)="tab='targets'">Targets</button>
          <button class="tab-btn" [class.active]="tab==='scan'" (click)="tab='scan'">Launch Scan</button>
          <button class="tab-btn" [class.active]="tab==='history'" (click)="tab='history'">Scan History</button>
        </div>

        <!-- Targets -->
        @if (tab === 'targets') {
          <div class="targets-layout">
            <div class="card">
              <div class="section-head">
                <span class="section-title">In-Scope Targets</span>
                <span class="section-count">{{inscope().length}}</span>
              </div>
              <div class="add-target">
                <input class="form-input" [(ngModel)]="newTarget" placeholder="dc01.corp.local or 10.0.0.10" (keyup.enter)="addTarget(false)" />
                <button class="btn btn-primary btn-sm" (click)="addTarget(false)">Add</button>
              </div>
              @if (inscope().length === 0) {
                <div class="empty-state" style="padding:24px"><div class="empty-icon" style="font-size:24px">⊡</div><p>No targets yet</p></div>
              } @else {
                <ul class="target-list">
                  @for (t of inscope(); track t.id) {
                    <li class="target-item">
                      <span class="target-domain">{{t.domain}}</span>
                      <span class="badge badge-alive">In-Scope</span>
                      <button class="btn btn-ghost btn-sm" (click)="removeTarget(t)">✕</button>
                    </li>
                  }
                </ul>
              }
            </div>
            <div class="card">
              <div class="section-head">
                <span class="section-title">Out-of-Scope</span>
                <span class="section-count">{{oos().length}}</span>
              </div>
              <div class="add-target">
                <input class="form-input" [(ngModel)]="newOos" placeholder="*.internal.domain.com" (keyup.enter)="addTarget(true)" />
                <button class="btn btn-outline btn-sm" (click)="addTarget(true)">Add OOS</button>
              </div>
              @if (oos().length === 0) {
                <div class="empty-state" style="padding:24px"><p>No OOS rules</p></div>
              } @else {
                <ul class="target-list">
                  @for (t of oos(); track t.id) {
                    <li class="target-item">
                      <span class="target-domain">{{t.domain}}</span>
                      <span class="badge badge-dead">OOS</span>
                      <button class="btn btn-ghost btn-sm" (click)="removeTarget(t)">✕</button>
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        <!-- Launch Scan -->
        @if (tab === 'scan') {
          <div class="card" style="max-width:720px">
            <h3 style="font-family:var(--font-head);font-weight:600;margin-bottom:16px">Configure Scan</h3>

            @if (inscope().length === 0) {
              <div class="alert alert-warning">Add at least one in-scope target before launching a scan.</div>
            }

            <!-- Domain credentials -->
            <div class="cred-box">
              <div class="tg-name" style="margin-bottom:10px">Domain Credentials</div>
              <div class="cred-grid">
                <div class="form-group">
                  <label class="form-label">Domain</label>
                  <input class="form-input" [(ngModel)]="adDomain" placeholder="CORP.LOCAL" />
                </div>
                <div class="form-group">
                  <label class="form-label">Username</label>
                  <input class="form-input" [(ngModel)]="username" placeholder="svc-account" />
                </div>
              </div>
              <div class="auth-toggle">
                <label class="radio"><input type="radio" name="authm" value="password" [(ngModel)]="authMethod" /> Password</label>
                <label class="radio"><input type="radio" name="authm" value="hash" [(ngModel)]="authMethod" /> NTLM Hash</label>
              </div>
              @if (authMethod === 'password') {
                <div class="form-group">
                  <label class="form-label">Password</label>
                  <input class="form-input" type="password" [(ngModel)]="password" placeholder="••••••••" autocomplete="off" />
                </div>
              } @else {
                <div class="form-group">
                  <label class="form-label">NTLM Hash</label>
                  <input class="form-input mono" [(ngModel)]="ntlmHash" placeholder="aad3b...:31d6c..." autocomplete="off" />
                </div>
              }
              <div class="cred-note">Credentials are sent to the engine in memory only — never written to storage or logs.</div>
            </div>

            @for (entry of toolGroupEntries; track entry[0]) {
              <div class="tool-group">
                <div class="tg-head">
                  <span class="tg-name">{{entry[0]}}</span>
                  <button class="btn btn-ghost btn-sm" (click)="toggleGroup(entry[1])">Toggle All</button>
                </div>
                <div class="tg-tools">
                  @for (t of entry[1]; track t) {
                    <label class="tool-chk" [class.unavail]="!toolAvail(t)" [title]="toolError(t)">
                      <input type="checkbox" [checked]="selectedTools.has(t)" (change)="toggleTool(t)" [disabled]="!toolAvail(t)" />
                      <span class="tool-name">{{t}}</span>
                      @if (!toolAvail(t)) { <span class="badge badge-dead" style="font-size:9px">{{unavailableLabel(t)}}</span> }
                    </label>
                  }
                </div>
              </div>
            }

            <div class="form-group" style="margin-top:16px">
              <label class="form-label">Password list for cracking (optional)</label>
              <input class="form-input" [(ngModel)]="customWordlist" placeholder="/app/data/wordlists/rockyou.txt" />
            </div>

            <button class="btn btn-primary" style="margin-top:8px"
              [disabled]="inscope().length === 0 || launching() || !credsValid()"
              (click)="launchScan()">
              @if (launching()) { <span class="spinner-sm"></span> } Launch Scan ({{selectedTools.size}} tools)
            </button>
            @if (!credsValid()) {
              <div class="cred-note" style="color:var(--sev-medium)">Enter a username and a password or NTLM hash to launch.</div>
            }
          </div>

          <!-- Resume vs. new scan prompt -->
          @if (showResumePrompt()) {
            <div class="modal-backdrop" (click)="cancelResumePrompt()">
              <div class="modal-card" (click)="$event.stopPropagation()">
                <h3>Previous scan detected</h3>
                <p class="modal-text">
                  This project already has scan results. Continue from the previous
                  results (reuses finished tools, only runs new/missing ones), or start
                  a fresh scan from scratch?
                </p>
                <div class="modal-actions">
                  <button class="btn btn-outline btn-sm" (click)="cancelResumePrompt()">Cancel</button>
                  <button class="btn btn-outline btn-sm" (click)="confirmLaunch(false)">Start New Scan</button>
                  <button class="btn btn-primary btn-sm" (click)="confirmLaunch(true)">Continue Previous</button>
                </div>
              </div>
            </div>
          }
        }

        <!-- History -->
        @if (tab === 'history') {
          <div class="card">
            <div class="section-head">
              <span class="section-title">Scan History</span>
              <span class="section-count">{{scans().length}}</span>
            </div>
            @if (scans().length === 0) {
              <div class="empty-state"><div class="empty-icon">◈</div><p>No scans run yet</p></div>
            } @else {
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Scan ID</th><th>Status</th><th>Tools</th><th>Started</th><th>Completed</th><th>Actions</th></tr></thead>
                  <tbody>
                    @for (s of scans(); track s.id) {
                      <tr>
                        <td class="td-mono" style="font-size:11px">{{s.id.slice(0,8)}}…</td>
                        <td><span class="badge badge-{{s.status}}">{{s.status}}</span></td>
                        <td>{{s.tools.length}} tools</td>
                        <td style="font-size:11px;color:var(--text-dim)">{{s.started_at | date:'short'}}</td>
                        <td style="font-size:11px;color:var(--text-dim)">{{s.completed_at | date:'short'}}</td>
                        <td>
                          @if (s.status === 'running') {
                            <a class="btn btn-outline btn-sm" [routerLink]="['/scan', s.id, 'progress']">Live</a>
                          } @else if (s.status === 'completed') {
                            <a class="btn btn-primary btn-sm" [routerLink]="['/scan', s.id, 'results']">Results</a>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .page { padding:32px; max-width:1200px; margin:0 auto; }
    .breadcrumb { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-dim); margin-bottom:20px; }
    .breadcrumb a { color:var(--accent); }
    .sep { color:var(--text-faint); }
    .page-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px; }
    .page-title { font-family:var(--font-head); font-size:24px; font-weight:700; }
    .page-sub { color:var(--text-dim); font-size:13px; margin-top:4px; }
    .targets-layout { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    @media (max-width:700px) { .targets-layout { grid-template-columns:1fr; } }
    .add-target { display:flex; gap:8px; margin-bottom:14px; }
    .add-target .form-input { flex:1; }
    .target-list { list-style:none; }
    .target-item { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--border); }
    .target-item:last-child { border-bottom:none; }
    .target-domain { font-family:var(--font-mono); font-size:12px; flex:1; }
    .tool-group { margin-bottom:18px; }
    .tg-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
    .tg-name { font-family:var(--font-head); font-size:12px; font-weight:600; color:var(--text-dim); text-transform:uppercase; letter-spacing:.06em; }
    .tg-tools { display:flex; flex-wrap:wrap; gap:8px; }
    .tool-chk { display:flex; align-items:center; gap:6px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:var(--radius); padding:6px 10px; cursor:pointer; transition:border-color 150ms; }
    .tool-chk:hover { border-color:var(--accent); }
    .tool-chk.unavail { opacity:.5; cursor:not-allowed; }
    .tool-name { font-family:var(--font-mono); font-size:12px; }
    input[type=checkbox] { accent-color:var(--accent); cursor:pointer; }
    .cred-box { background:var(--bg-elevated); border:1px solid var(--border); border-radius:var(--radius-lg); padding:16px; margin-bottom:20px; }
    .cred-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    @media (max-width:560px) { .cred-grid { grid-template-columns:1fr; } }
    .form-group { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; }
    .auth-toggle { display:flex; gap:18px; margin:6px 0 12px; }
    .radio { display:flex; align-items:center; gap:6px; font-size:12px; font-family:var(--font-mono); cursor:pointer; }
    .form-input.mono { font-family:var(--font-mono); font-size:12px; }
    .cred-note { font-size:11px; color:var(--text-dim); margin-top:4px; }
    .modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; z-index:200; }
    .modal-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-lg); padding:24px; max-width:460px; width:90%; }
    .modal-card h3 { font-family:var(--font-head); font-weight:600; margin-bottom:10px; }
    .modal-text { color:var(--text-dim); font-size:13px; line-height:1.5; margin-bottom:20px; }
    .modal-actions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
  `]
})
export class ProjectDetailComponent implements OnInit {
  project = signal<Project | null>(null);
  targets = signal<Target[]>([]);
  scans = signal<Scan[]>([]);
  availableTools = signal<ToolInfo[]>([]);
  launching = signal(false);
  showResumePrompt = signal(false);
  tab = 'targets';
  newTarget = '';
  newOos = '';
  customWordlist = '';
  selectedTools = new Set<string>(DEFAULT_TOOLS);

  // Domain credentials (held only in the form; never persisted by the backend).
  adDomain = '';
  username = '';
  authMethod: 'password' | 'hash' = 'password';
  password = '';
  ntlmHash = '';

  credsValid(): boolean {
    const hasSecret = this.authMethod === 'password' ? !!this.password : !!this.ntlmHash.trim();
    return !!this.username.trim() && hasSecret;
  }

  inscope = computed(() => this.targets().filter((t: any) => !t.is_oos));
  oos     = computed(() => this.targets().filter((t: any) => t.is_oos));
  get toolGroupEntries() { return Object.entries(TOOL_GROUPS); }

  constructor(private route: ActivatedRoute, private api: ApiService, private router: Router) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.getProject(id).subscribe(p => this.project.set(p));
    this.api.getTargets(id).subscribe(ts => this.targets.set(ts));
    this.api.getScans(id).subscribe(ss => this.scans.set(ss.sort((a,b) => b.created_at.localeCompare(a.created_at))));
    this.api.getTools().subscribe(ts => this.availableTools.set(ts));
  }

  toolAvail(name: string): boolean {
    const t = this.availableTools().find(x => x.name === name);
    return t ? t.available : true;
  }

  toolError(name: string): string {
    const t = this.availableTools().find(x => x.name === name);
    return t?.availability_error || '';
  }

  unavailableLabel(_name: string): string {
    return 'not installed';
  }

  addTarget(isOos: boolean) {
    const domain = isOos ? this.newOos.trim() : this.newTarget.trim();
    if (!domain) return;
    const pid = this.project()!.id;
    this.api.addTarget(pid, domain, isOos).subscribe(t => {
      this.targets.update(ts => [...ts, t]);
      if (isOos) this.newOos = ''; else this.newTarget = '';
    });
  }

  removeTarget(t: Target) {
    this.api.deleteTarget(this.project()!.id, t.id).subscribe(() =>
      this.targets.update(ts => ts.filter(x => x.id !== t.id)));
  }

  toggleTool(name: string) {
    if (!this.toolAvail(name)) return;
    if (this.selectedTools.has(name)) this.selectedTools.delete(name);
    else this.selectedTools.add(name);
  }

  toggleGroup(tools: string[]) {
    const available = tools.filter(t => this.toolAvail(t));
    const allOn = available.every(t => this.selectedTools.has(t));
    available.forEach(t => allOn ? this.selectedTools.delete(t) : this.selectedTools.add(t));
  }

  /** A finished prior scan means we can offer to resume from its results. */
  private hasPriorScan(): boolean {
    return this.scans().some(s => ['completed', 'cancelled', 'failed'].includes(s.status));
  }

  launchScan() {
    if (this.inscope().length === 0 || this.launching()) return;
    // If the project already has results, ask whether to resume or start fresh.
    if (this.hasPriorScan()) {
      this.showResumePrompt.set(true);
      return;
    }
    this.startScan(false);
  }

  confirmLaunch(reusePrevious: boolean) {
    this.showResumePrompt.set(false);
    this.startScan(reusePrevious);
  }

  cancelResumePrompt() {
    this.showResumePrompt.set(false);
  }

  private startScan(reusePrevious: boolean) {
    if (this.inscope().length === 0 || !this.credsValid()) return;
    this.launching.set(true);
    const credentials: AdCredentials = {
      ad_domain: this.adDomain.trim(),
      username: this.username.trim(),
      password: this.authMethod === 'password' ? this.password : '',
      ntlm_hash: this.authMethod === 'hash' ? this.ntlmHash.trim() : '',
    };
    this.api.startScan(this.project()!.id, [...this.selectedTools], credentials,
                       this.customWordlist || undefined, reusePrevious)
      .subscribe({
        next: scan => {
          this.password = ''; this.ntlmHash = '';   // do not keep secrets in the form
          this.router.navigate(['/scan', scan.id, 'progress']);
        },
        error: () => this.launching.set(false),
      });
  }

  deleteProject() {
    if (!confirm('Delete this project and all its data?')) return;
    this.api.deleteProject(this.project()!.id).subscribe(() => this.router.navigate(['/projects']));
  }
}

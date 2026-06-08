import { Component, OnInit, signal, computed, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToolResult } from '../../core/models';
import Chart from 'chart.js/auto';

type TabId = 'overview' | 'hosts' | 'accounts' | 'kerberos' | 'shares' | 'services' | 'directory' | 'credentials';

@Component({
  selector: 'pg-results',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  template: `
    <div class="page">
      <div class="breadcrumb">
        <a routerLink="/projects">Projects</a><span class="sep">›</span><span>Scan Results</span>
      </div>

      <div class="results-header">
        <h1 class="page-title">Active Directory Findings</h1>
        <div class="header-actions">
          <button class="btn btn-outline btn-sm" (click)="exportJson()">Export JSON</button>
          <span class="mono text-dim">{{scanId.slice(0,8)}}…</span>
        </div>
      </div>

      @if (loading()) {
        <div class="empty-state"><div class="empty-icon">◈</div><p>Loading findings…</p></div>
      } @else {
        <!-- Tabs -->
        <div class="tab-bar">
          @for (t of tabs; track t.id) {
            <button class="tab-btn" [class.active]="activeTab()===t.id" (click)="setTab(t.id)">
              {{t.label}}
              @if (tabCount(t.id) > 0) { <span class="tab-count">{{tabCount(t.id)}}</span> }
            </button>
          }
        </div>

        <!-- OVERVIEW -->
        @if (activeTab() === 'overview') {
          <div class="stat-grid">
            <div class="stat-card"><span class="stat-num">{{hosts().length}}</span><span class="stat-lbl">Hosts</span></div>
            <div class="stat-card"><span class="stat-num">{{users().length}}</span><span class="stat-lbl">Users</span></div>
            <div class="stat-card"><span class="stat-num">{{groups().length}}</span><span class="stat-lbl">Groups</span></div>
            <div class="stat-card"><span class="stat-num">{{kerb().length}}</span><span class="stat-lbl">Kerberos Hashes</span></div>
            <div class="stat-card"><span class="stat-num">{{shares().length}}</span><span class="stat-lbl">SMB Shares</span></div>
            <div class="stat-card loot"><span class="stat-num">{{creds().length}}</span><span class="stat-lbl">Cracked Creds</span></div>
          </div>
          <div class="chart-row">
            <div class="card chart-card"><h3>Accounts</h3><div class="chart-wrap"><canvas id="chart-accounts"></canvas></div></div>
            <div class="card chart-card"><h3>Results by Tool</h3><div class="chart-wrap"><canvas id="chart-tools"></canvas></div></div>
          </div>
        }

        <!-- HOSTS -->
        @if (activeTab() === 'hosts') {
          <div class="card">
            @if (hosts().length === 0) { <p class="text-dim">No hosts responded.</p> }
            @else {
              <div class="table-wrap"><table>
                <thead><tr><th>Host</th><th>Hostname</th><th>Details</th></tr></thead>
                <tbody>
                  @for (h of hosts(); track $index) {
                    <tr><td class="td-mono">{{h['host']}}</td><td class="td-mono">{{h['hostname']}}</td><td class="text-dim">{{h['info']}}</td></tr>
                  }
                </tbody>
              </table></div>
            }
          </div>
        }

        <!-- ACCOUNTS -->
        @if (activeTab() === 'accounts') {
          <div class="card">
            <div class="filter-bar">
              <input class="form-input" placeholder="Filter name…" [ngModel]="acctQ()" (ngModelChange)="acctQ.set($event)" />
              <select class="form-select" [ngModel]="acctType()" (ngModelChange)="acctType.set($event)">
                <option value="all">All</option><option value="user">Users</option><option value="group">Groups</option>
              </select>
              <button class="btn btn-outline btn-sm" (click)="exportTxt(filteredAccounts().map(toName), 'accounts.txt')">Export</button>
            </div>
            @if (filteredAccounts().length === 0) { <p class="text-dim">No users or groups enumerated.</p> }
            @else {
              <div class="table-wrap"><table>
                <thead><tr><th>Name</th><th>Type</th></tr></thead>
                <tbody>
                  @for (a of filteredAccounts(); track $index) {
                    <tr><td class="td-mono">{{a['name']}}</td><td><span class="badge" [class.badge-alive]="a['type']==='group'">{{a['type']}}</span></td></tr>
                  }
                </tbody>
              </table></div>
            }
          </div>
        }

        <!-- KERBEROS -->
        @if (activeTab() === 'kerberos') {
          <div class="card">
            <div class="filter-bar">
              <input class="form-input" placeholder="Filter principal…" [ngModel]="kerbQ()" (ngModelChange)="kerbQ.set($event)" />
              <button class="btn btn-outline btn-sm" (click)="exportTxt(filteredKerb().map(toHash), 'kerberos_hashes.txt')">Export Hashes</button>
            </div>
            @if (filteredKerb().length === 0) { <p class="text-dim">No AS-REP or Kerberoast hashes captured.</p> }
            @else {
              @for (k of filteredKerb(); track $index) {
                <div class="hash-row">
                  <div class="hash-head">
                    <span class="badge badge-high">{{k['type']}}</span>
                    <span class="td-mono">{{k['user'] || k['spn']}}</span>
                    <button class="btn btn-ghost btn-sm" (click)="copy(k['hash'])">Copy hash</button>
                  </div>
                  <code class="hash-blob">{{k['hash']}}</code>
                </div>
              }
            }
          </div>
        }

        <!-- SHARES -->
        @if (activeTab() === 'shares') {
          <div class="card">
            @if (shares().length === 0) { <p class="text-dim">No readable/writable SMB shares found.</p> }
            @else {
              <div class="table-wrap"><table>
                <thead><tr><th>Host</th><th>Share</th><th>Permissions</th></tr></thead>
                <tbody>
                  @for (s of shares(); track $index) {
                    <tr><td class="td-mono">{{s['host']}}</td><td class="td-mono">{{s['share']}}</td>
                      <td><span class="badge" [class.badge-critical]="(s['permissions']||'').includes('WRITE')" [class.badge-medium]="!(s['permissions']||'').includes('WRITE')">{{s['permissions']}}</span></td></tr>
                  }
                </tbody>
              </table></div>
            }
          </div>
        }

        <!-- SERVICES -->
        @if (activeTab() === 'services') {
          <div class="card">
            @if (services().length === 0) { <p class="text-dim">No service access checks recorded.</p> }
            @else {
              <div class="table-wrap"><table>
                <thead><tr><th>Host</th><th>Service</th><th>Access</th></tr></thead>
                <tbody>
                  @for (s of services(); track $index) {
                    <tr><td class="td-mono">{{s['host']}}</td><td class="td-mono">{{s['service']}}</td>
                      <td><span class="badge" [class.badge-critical]="(s['access']||'').includes('Pwn3d')" [class.badge-alive]="s['access']==='authenticated'" [class.badge-dead]="s['access']==='denied'">{{s['access']}}</span></td></tr>
                  }
                </tbody>
              </table></div>
            }
          </div>
        }

        <!-- DIRECTORY (LDAP + BloodHound files) -->
        @if (activeTab() === 'directory') {
          <div class="card">
            @if (dirFiles().length === 0) { <p class="text-dim">No LDAP dump or BloodHound collection files.</p> }
            @else {
              <ul class="file-list">
                @for (f of dirFiles(); track $index) {
                  <li class="file-item">
                    <span class="badge badge-tool">{{f['kind']}}</span>
                    <a class="file-name td-mono" [href]="artifactPath(f['path'])" target="_blank" rel="noopener">{{f['file']}}</a>
                    <span class="text-dim">{{f['host']}}</span>
                    <span class="file-size">{{fmtBytes(f['bytes'])}}</span>
                  </li>
                }
              </ul>
            }
          </div>
        }

        <!-- CREDENTIALS (cracked) -->
        @if (activeTab() === 'credentials') {
          <div class="card loot-card">
            <div class="filter-bar">
              <span class="loot-title">Recovered Credentials</span>
              <button class="btn btn-outline btn-sm" (click)="exportTxt(creds().map(toUserPass), 'credentials.txt')">Export</button>
            </div>
            @if (creds().length === 0) { <p class="text-dim">No credentials were cracked. Provide a wordlist and select the cracking tools to attempt recovery.</p> }
            @else {
              <div class="table-wrap"><table>
                <thead><tr><th>Username</th><th>Password</th><th></th></tr></thead>
                <tbody>
                  @for (c of creds(); track $index) {
                    <tr><td class="td-mono">{{c['user']}}</td><td class="td-mono loot-pw">{{c['password']}}</td>
                      <td><button class="btn btn-ghost btn-sm" (click)="copy(c['user'] + ':' + c['password'])">Copy</button></td></tr>
                  }
                </tbody>
              </table></div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .page { padding:32px; max-width:1200px; margin:0 auto; }
    .breadcrumb { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-dim); margin-bottom:20px; }
    .breadcrumb a { color:var(--accent); } .sep { color:var(--text-faint); }
    .results-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
    .page-title { font-family:var(--font-head); font-size:24px; font-weight:700; }
    .header-actions { display:flex; align-items:center; gap:12px; }
    .tab-bar { display:flex; gap:4px; flex-wrap:wrap; border-bottom:1px solid var(--border); margin-bottom:20px; }
    .tab-btn { padding:8px 14px; font-family:var(--font-head); font-size:12px; font-weight:600; color:var(--text-dim); border-bottom:2px solid transparent; cursor:pointer; background:none; }
    .tab-btn.active { color:var(--accent); border-bottom-color:var(--accent); }
    .tab-count { font-family:var(--font-mono); font-size:10px; background:var(--bg-elevated); padding:1px 6px; border-radius:8px; margin-left:4px; }
    .stat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:20px; }
    .stat-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-lg); padding:18px; display:flex; flex-direction:column; gap:4px; }
    .stat-card.loot { border-color:var(--accent); box-shadow:0 0 18px var(--accent-glow); }
    .stat-num { font-family:var(--font-display); font-size:28px; font-weight:700; color:var(--accent); }
    .stat-lbl { font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:.08em; }
    .chart-row { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    @media (max-width:760px) { .chart-row { grid-template-columns:1fr; } }
    .chart-card h3 { font-family:var(--font-head); font-size:13px; margin-bottom:12px; }
    .chart-wrap { height:240px; position:relative; }
    .filter-bar { display:flex; gap:8px; align-items:center; margin-bottom:14px; flex-wrap:wrap; }
    .filter-bar .form-input { flex:1; min-width:160px; }
    .table-wrap { overflow-x:auto; }
    .td-mono { font-family:var(--font-mono); font-size:12px; }
    .text-dim { color:var(--text-dim); }
    .hash-row { background:var(--bg-elevated); border:1px solid var(--border); border-radius:var(--radius); padding:10px 12px; margin-bottom:8px; }
    .hash-head { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
    .hash-blob { display:block; font-family:var(--font-mono); font-size:10px; color:var(--text-dim); word-break:break-all; line-height:1.4; }
    .file-list { list-style:none; }
    .file-item { display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--border); }
    .file-item:last-child { border-bottom:none; }
    .file-name { color:var(--accent); flex:1; }
    .file-size { font-family:var(--font-mono); font-size:11px; color:var(--text-faint); }
    .loot-card { border-color:var(--accent); }
    .loot-title { font-family:var(--font-head); font-weight:700; color:var(--accent); flex:1; }
    .loot-pw { color:var(--accent); font-weight:600; }
    .empty-state { text-align:center; padding:60px; color:var(--text-dim); }
    .empty-icon { font-size:32px; margin-bottom:8px; }
  `]
})
export class ResultsComponent implements OnInit, AfterViewInit {
  scanId!: string;
  results = signal<ToolResult[]>([]);
  loading = signal(true);
  activeTab = signal<TabId>('overview');

  acctQ = signal('');
  acctType = signal('all');
  kerbQ = signal('');

  tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'hosts', label: 'Hosts' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'kerberos', label: 'Kerberos' },
    { id: 'shares', label: 'Shares' },
    { id: 'services', label: 'Services' },
    { id: 'directory', label: 'Directory' },
    { id: 'credentials', label: 'Credentials' },
  ];

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  ngOnInit() {
    this.scanId = this.route.snapshot.paramMap.get('scanId')!;
    this.api.getResults(this.scanId).subscribe({
      next: rs => { this.results.set(rs); this.loading.set(false); setTimeout(() => this.initCharts(), 100); },
      error: () => this.loading.set(false),
    });
  }
  ngAfterViewInit() { setTimeout(() => this.initCharts(), 200); }

  setTab(t: TabId) { this.activeTab.set(t); if (t === 'overview') setTimeout(() => this.initCharts(), 80); }

  // ── Data extractors ─────────────────────────────────────────────
  private byCategory(cat: string) { return this.results().filter(r => r.category === cat).flatMap(r => r.data); }
  private byTool(tool: string) { return this.results().filter(r => r.tool === tool).flatMap(r => r.data); }
  /** Flatten a category's rows while keeping the owning target host. */
  private withHost(filterFn: (r: ToolResult) => boolean, extra: Record<string, any> = {}) {
    return this.results().filter(filterFn).flatMap(r => r.data.map(d => ({ ...d, host: d['host'] || r.domain, ...extra })));
  }

  hosts = computed(() => this.byCategory('discovery'));
  accounts = computed(() => this.byCategory('account'));
  users = computed(() => this.accounts().filter((a: any) => a['type'] === 'user'));
  groups = computed(() => this.accounts().filter((a: any) => a['type'] === 'group'));
  kerb = computed(() => this.byCategory('kerberos'));
  shares = computed(() => this.withHost(r => r.category === 'share'));
  services = computed(() => this.byCategory('service'));
  creds = computed(() => this.byCategory('cred'));

  dirFiles = computed(() => [
    ...this.withHost(r => r.tool === 'ldap_dump', { kind: 'ldap' }).map((f: any) => ({ ...f, path: `${f['host']}/ldap/${f['file']}` })),
    ...this.withHost(r => r.tool === 'bloodhound', { kind: 'bloodhound' }).map((f: any) => ({ ...f, path: `${f['host']}/bloodhound/${f['file']}` })),
  ]);

  filteredAccounts = computed(() => {
    let rows = this.accounts();
    const q = this.acctQ().trim().toLowerCase();
    const type = this.acctType();
    if (type !== 'all') rows = rows.filter((a: any) => a['type'] === type);
    if (q) rows = rows.filter((a: any) => (a['name'] || '').toLowerCase().includes(q));
    return rows;
  });

  filteredKerb = computed(() => {
    const q = this.kerbQ().trim().toLowerCase();
    if (!q) return this.kerb();
    return this.kerb().filter((k: any) => ((k['user'] || k['spn'] || '') as string).toLowerCase().includes(q));
  });

  tabCount(t: TabId): number {
    const m: Record<TabId, number> = {
      overview: 0, hosts: this.hosts().length, accounts: this.accounts().length,
      kerberos: this.kerb().length, shares: this.shares().length, services: this.services().length,
      directory: this.dirFiles().length, credentials: this.creds().length,
    };
    return m[t] || 0;
  }

  // ── Template-safe mappers (no arrow functions in templates) ──────
  toName(a: any): string { return a['name'] || ''; }
  toHash(k: any): string { return k['hash'] || ''; }
  toUserPass(c: any): string { return `${c['user']}:${c['password']}`; }

  fmtBytes(n: number): string {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  }

  artifactPath(path: string | undefined): string { return path ? this.api.artifactUrl(this.scanId, path) : '#'; }
  copy(text: string) { navigator.clipboard.writeText(text || '').catch(() => {}); }

  exportTxt(lines: string[], fname: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.filter(Boolean).join('\n')], { type: 'text/plain' }));
    a.download = fname; a.click();
  }
  exportJson() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(this.results(), null, 2)], { type: 'application/json' }));
    a.download = `scan-${this.scanId.slice(0, 8)}.json`; a.click();
  }

  initCharts() {
    const acctCanvas = document.getElementById('chart-accounts') as HTMLCanvasElement;
    const toolCanvas = document.getElementById('chart-tools') as HTMLCanvasElement;
    if (acctCanvas && !(acctCanvas as any)._chartInstance) {
      const other = this.accounts().length - this.users().length - this.groups().length;
      const c = new Chart(acctCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Users', 'Groups', 'Other'],
          datasets: [{ data: [this.users().length, this.groups().length, Math.max(0, other)],
            backgroundColor: ['#b072ff', '#00bfff', '#546e7a'], borderColor: '#0b1628', borderWidth: 3 }],
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { position: 'right', labels: { color: '#c4d4eb', font: { size: 11 } } } } },
      });
      (acctCanvas as any)._chartInstance = c;
    }
    if (toolCanvas && !(toolCanvas as any)._chartInstance) {
      const r = this.results().filter(x => x.count > 0).slice(0, 12);
      const c = new Chart(toolCanvas, {
        type: 'bar',
        data: { labels: r.map(x => x.tool),
          datasets: [{ label: 'Results', data: r.map(x => x.count),
            backgroundColor: 'rgba(176,114,255,.5)', borderColor: '#b072ff', borderWidth: 1, borderRadius: 4 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { grid: { color: '#1a2e4a' }, ticks: { color: '#60789a' } }, y: { ticks: { color: '#c4d4eb' } } } },
      });
      (toolCanvas as any)._chartInstance = c;
    }
  }
}

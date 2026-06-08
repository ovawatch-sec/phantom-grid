import { Component, OnInit, OnDestroy, NgZone, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ScanProgressEvent } from '../../core/models';

type ProgressRow = ScanProgressEvent & { key: string };

@Component({
  selector: 'sg-scan-progress',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page">
      <div class="breadcrumb">
        <a routerLink="/projects">Projects</a>
        <span class="sep">›</span>
        <span>Scan Progress</span>
      </div>

      <div class="progress-header">
        <div>
          <h1 class="page-title">{{done() ? finalTitle() : 'Scan Running'}}</h1>
          <div class="mono text-dim">{{scanId.slice(0,8)}}…</div>
        </div>
        <div class="header-right">
          @if (!done()) {
            <button class="btn btn-danger btn-sm" [disabled]="cancelling()" (click)="cancelScan()">
              @if (cancelling()) { <span class="spinner-sm"></span> } Cancel Scan
            </button>
          }
          <div class="overall-box">
            <span>{{overallPercent()}}%</span>
            <small>{{completedTools()}} / {{totalTools()}} tools finished</small>
          </div>
        </div>
      </div>

      <div class="overall-progress">
        <div class="overall-fill" [style.width.%]="overallPercent()"></div>
      </div>

      @if (currentPhase()) {
        <div class="phase-banner" [class.phase-done]="done()">
          @if (!done()) { <span class="spinner-sm"></span> }
          <div>
            <span>{{currentPhase()}}</span>
            @if (phaseToolTotal() > 0) {
              <small>{{phaseToolDone()}} / {{phaseToolTotal()}} in this phase</small>
            }
          </div>
        </div>
      }

      <div class="progress-list">
        @for (ev of events(); track ev.key) {
          <div class="progress-item" [class]="'pi-' + ev.status">
            <div class="pi-icon">
              @switch (ev.status) {
                @case ('running') { <span class="spinner-sm"></span> }
                @case ('done') { <span class="pi-check">✓</span> }
                @case ('completed') { <span class="pi-check">✓</span> }
                @case ('error') { <span class="pi-x">✗</span> }
                @case ('failed') { <span class="pi-x">✗</span> }
                @case ('skipped') { <span class="pi-skip">—</span> }
                @case ('cancelled') { <span class="pi-skip">—</span> }
              }
            </div>
            <div class="pi-main">
              <div class="pi-line">
                <span class="pi-tool">{{ev.tool}}</span>
                @if (ev.domain) { <span class="pi-domain">{{ev.domain}}</span> }
                @if (ev.count) { <span class="pi-count">{{ev.count}} results</span> }
                <span class="badge badge-{{ev.status}}">{{ev.status}}</span>
              </div>
              @if (ev.message) { <div class="pi-msg">{{ev.message}}</div> }
            </div>
          </div>
        }
      </div>

      @if (done()) {
        <div class="done-banner" [class.done-ok]="!failed()" [class.done-err]="failed()">
          <span>{{finalTitle()}}</span>
          @if (!failed()) {
            <a class="btn btn-primary btn-sm" [routerLink]="['/scan', scanId, 'results']">View Results</a>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding:32px; max-width:900px; margin:0 auto; }
    .breadcrumb { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-dim); margin-bottom:20px; }
    .breadcrumb a { color:var(--accent); }
    .sep { color:var(--text-faint); }
    .progress-header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:12px; }
    .header-right { display:flex; align-items:center; gap:16px; }
    .page-title { font-family:var(--font-head); font-size:22px; font-weight:700; margin-bottom:4px; }
    .overall-box { display:flex; flex-direction:column; align-items:flex-end; gap:2px; font-family:var(--font-mono); }
    .overall-box span { color:var(--accent); font-size:20px; font-weight:700; }
    .overall-box small { color:var(--text-dim); font-size:11px; }
    .overall-progress { height:8px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:999px; overflow:hidden; margin-bottom:16px; }
    .overall-fill { height:100%; background:linear-gradient(90deg, rgba(0,232,122,.55), rgba(0,191,255,.75)); transition:width 250ms ease; }
    .phase-banner { display:flex; align-items:center; gap:10px; background:rgba(0,232,122,.07); border:1px solid rgba(0,232,122,.2); border-radius:var(--radius-lg); padding:12px 16px; margin-bottom:16px; font-family:var(--font-head); font-size:13px; color:var(--accent); }
    .phase-banner small { display:block; margin-top:2px; font-family:var(--font-mono); color:var(--text-dim); font-size:10px; }
    .phase-done { opacity:.85; }
    .progress-list { display:flex; flex-direction:column; gap:6px; margin-bottom:20px; }
    .progress-item { display:flex; align-items:flex-start; gap:10px; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); padding:10px 14px; transition:border-color 150ms; }
    .pi-running { border-color:rgba(255,147,64,.3); }
    .pi-done, .pi-completed { border-color:rgba(0,232,122,.25); }
    .pi-error, .pi-failed { border-color:rgba(255,71,87,.25); }
    .pi-icon { width:20px; text-align:center; flex-shrink:0; padding-top:1px; }
    .pi-check { color:var(--accent); font-weight:700; }
    .pi-x { color:var(--sev-critical); font-weight:700; }
    .pi-skip { color:var(--text-faint); }
    .pi-main { flex:1; min-width:0; }
    .pi-line { display:flex; align-items:center; gap:8px; min-width:0; }
    .pi-tool { font-family:var(--font-mono); font-size:12px; min-width:132px; }
    .pi-domain { font-family:var(--font-mono); font-size:10px; color:var(--text-faint); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pi-msg { margin-top:3px; font-size:12px; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pi-count { font-family:var(--font-mono); font-size:11px; color:var(--cyan); margin-left:auto; }
    .done-banner { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-radius:var(--radius-lg); border:1px solid; }
    .done-ok { background:rgba(0,232,122,.08); border-color:rgba(0,232,122,.3); color:var(--accent); }
    .done-err { background:rgba(255,71,87,.08); border-color:rgba(255,71,87,.3); color:var(--sev-critical); }
  `]
})
export class ScanProgressComponent implements OnInit, OnDestroy {
  scanId!: string;
  events = signal<ProgressRow[]>([]);
  currentPhase = signal('');
  done = signal(false);
  failed = signal(false);
  cancelling = signal(false);
  finalStatus = signal('');

  phaseToolDone = signal(0);
  phaseToolTotal = signal(0);
  totalTools = signal(0);
  completedTools = signal(0);

  overallPercent = computed(() => {
    const total = this.totalTools();
    if (this.done()) return 100;
    if (!total) return 0;
    return Math.min(99, Math.round((this.completedTools() / total) * 100));
  });

  finalTitle = computed(() => {
    const s = this.finalStatus();
    if (s === 'failed') return '✗ Scan failed';
    if (s === 'cancelled') return '— Scan cancelled';
    return '✓ Scan completed';
  });

  private es?: EventSource;
  private pollHandle?: number;

  constructor(private route: ActivatedRoute, private api: ApiService, private zone: NgZone) {}

  ngOnInit() {
    this.scanId = this.route.snapshot.paramMap.get('id')!;
    this.api.getScan(this.scanId).subscribe({
      next: scan => this.totalTools.set(scan.tools?.length || 0),
      error: () => {}
    });
    this.openStream();
    this.pollHandle = window.setInterval(() => this.checkScanStatus(), 5000);
  }

  ngOnDestroy() {
    this.es?.close();
    if (this.pollHandle) window.clearInterval(this.pollHandle);
  }

  cancelScan() {
    if (this.done() || this.cancelling()) return;
    if (!confirm('Cancel this scan? Running tools will be stopped.')) return;
    this.cancelling.set(true);
    this.api.cancelScan(this.scanId).subscribe({
      next: () => { this.cancelling.set(false); this.checkScanStatus(); },
      error: () => { this.cancelling.set(false); },
    });
  }

  private openStream() {
    this.es?.close();
    this.es = new EventSource(this.api.progressStreamUrl(this.scanId));

    // EventSource is not patched by zone.js, so its callbacks fire outside the
    // Angular zone and signal writes would not trigger change detection — the
    // progress UI would only repaint on some other zone event (or at scan end).
    // Re-enter the zone so every streamed event renders live.
    this.es.onmessage = (e) => {
      if (!e.data || e.data === '{}') return;
      this.zone.run(() => {
        try {
          const raw = JSON.parse(e.data);
          if (raw.heartbeat) return;
          this.applyEvent(raw as ScanProgressEvent);
        } catch {}
      });
    };

    // Never mark the scan complete just because SSE had a network/proxy hiccup.
    this.es.onerror = () => this.zone.run(() => this.checkScanStatus());
  }

  private applyEvent(ev: ScanProgressEvent) {
    if (ev.overall_total_tools) {
      this.completedTools.set(ev.overall_completed_tools || 0);
      this.totalTools.set(ev.overall_total_tools);
    }

    if (ev.tool === '__phase__') {
      if (ev.status === 'running') this.currentPhase.set(ev.message);
      if (ev.status === 'done') this.currentPhase.set(ev.message);
      this.phaseToolDone.set(ev.completed_tools || 0);
      this.phaseToolTotal.set(ev.total_tools || this.phaseToolTotal());
      return;
    }

    if (ev.total_tools) {
      this.phaseToolDone.set(ev.completed_tools || 0);
      this.phaseToolTotal.set(ev.total_tools);
    }

    if (ev.tool === '__domain__') return;

    if (ev.tool === '__scan__') {
      if (['completed', 'failed', 'cancelled'].includes(ev.status)) {
        this.markDone(ev.status);
      }
      return;
    }

    this.upsertEvent(ev);
    if (!ev.overall_total_tools) this.recalculateFinishedTools();
  }

  private upsertEvent(ev: ScanProgressEvent) {
    const row = { ...ev, key: this.eventKey(ev) } as ProgressRow;
    this.events.update(evs => {
      const idx = evs.findIndex(x => x.key === row.key);
      if (idx >= 0) {
        const copy = [...evs];
        copy[idx] = row;
        return copy;
      }
      return [...evs, row];
    });
  }

  private eventKey(ev: ScanProgressEvent): string {
    return `${ev.domain || ''}:${ev.phase_index || 0}:${ev.tool}`;
  }

  private recalculateFinishedTools() {
    const terminal = new Set(['done', 'error', 'skipped', 'completed', 'failed', 'cancelled']);
    const handoff = new Set(['subdomain-merge', 'alive-subdomains', 'alive-urls']);
    const rows = this.events().filter(e => !e.tool.startsWith('__') && !handoff.has(e.tool));
    const finished = rows.filter(e => terminal.has(e.status)).length;
    this.completedTools.set(finished);
    this.totalTools.set(Math.max(this.totalTools(), rows.length));
  }

  private checkScanStatus() {
    if (this.done()) return;
    this.api.getScan(this.scanId).subscribe({
      next: scan => {
        if (['completed', 'failed', 'cancelled'].includes(scan.status)) {
          this.markDone(scan.status);
        }
      },
      error: () => {}
    });
  }

  private markDone(status: string) {
    this.finalStatus.set(status);
    this.done.set(true);
    this.failed.set(status === 'failed' || status === 'cancelled');
    this.es?.close();
    if (this.pollHandle) window.clearInterval(this.pollHandle);
    this.recalculateFinishedTools();
  }
}

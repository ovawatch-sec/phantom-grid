import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { StorageConfig } from '../../core/models';

@Component({
  selector: 'pg-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <h1 class="page-title">Settings</h1>
      <p class="page-sub" style="margin-bottom:28px">Configure result storage.</p>

      <div class="card" style="max-width:720px">
        <h3 class="section-title">Azure Table Storage</h3>
        <p class="section-copy">Optional — results are always saved to disk. Enable Azure for additional cloud backup and multi-instance sync.</p>

        <label class="toggle-row" style="margin-bottom:20px">
          <span>Enable Azure Table Storage</span>
          <input type="checkbox" [(ngModel)]="storageCfg.azure_enabled" />
        </label>

        @if (storageCfg.azure_enabled) {
          <div class="form-group">
            <label class="form-label">Connection String (preferred)</label>
            <input class="form-input" [(ngModel)]="storageCfg.connection_string" placeholder="DefaultEndpointsProtocol=https;AccountName=…" />
          </div>
          <p class="separator">— OR use account name + key —</p>
          <div class="form-group">
            <label class="form-label">Account Name</label>
            <input class="form-input" [(ngModel)]="storageCfg.account_name" placeholder="mystorageaccount" />
          </div>
          <div class="form-group">
            <label class="form-label">Account Key</label>
            <input class="form-input" type="password" [(ngModel)]="storageCfg.account_key" placeholder="Leave blank to keep existing key" />
          </div>
          <div class="form-group">
            <label class="form-label">Table Prefix</label>
            <input class="form-input" [(ngModel)]="storageCfg.table_prefix" placeholder="phantomgrid" />
            <span class="hint">Tables: {{storageCfg.table_prefix}}Projects, {{storageCfg.table_prefix}}Targets, {{storageCfg.table_prefix}}Scans, {{storageCfg.table_prefix}}Results</span>
          </div>
        }

        @if (storageSaved()) {
          <div class="alert alert-success" style="margin-bottom:16px">✓ Storage configuration saved</div>
        }
        @if (storageError()) {
          <div class="alert alert-danger" style="margin-bottom:16px">✗ {{storageError()}}</div>
        }

        <button class="btn btn-primary" (click)="saveStorage()" [disabled]="storageSaving()">
          @if (storageSaving()) { <span class="spinner-sm"></span> }
          Save Storage
        </button>
      </div>

      <div class="card" style="max-width:720px;margin-top:16px">
        <h3 class="section-title" style="margin-bottom:16px">About</h3>
        <div class="about-row"><span>Version</span><span class="mono">1.0.0</span></div>
        <div class="about-row"><span>Storage</span><span class="mono">File (always) + Azure (optional)</span></div>
        <div class="about-row"><span>Output Directory</span><span class="mono">/app/output</span></div>
        <div class="about-row"><span>Data Directory</span><span class="mono">/app/data</span></div>
      </div>
    </div>
  `,
  styles: [`
    .page { padding:32px; max-width:1200px; margin:0 auto; }
    .page-title { font-family:var(--font-head); font-size:24px; font-weight:700; }
    .section-title { font-family:var(--font-head); font-weight:600; margin-bottom:4px; }
    .section-copy { font-size:12px; color:var(--text-dim); margin-bottom:20px; }
    .toggle-row { display:flex; align-items:center; justify-content:space-between; cursor:pointer; }
    input[type=checkbox] { width:18px; height:18px; accent-color:var(--accent); }
    .separator { font-size:11px; color:var(--text-faint); margin:-12px 0 16px; text-align:center; }
    .hint { font-size:11px; color:var(--text-dim); }
    .about-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border); font-size:13px; }
    .about-row:last-child { border-bottom:none; }
  `]
})
export class SettingsComponent implements OnInit {
  storageCfg: StorageConfig = { azure_enabled:false, connection_string:'', account_name:'', account_key:'', table_prefix:'phantomgrid' };

  storageSaving = signal(false);
  storageSaved = signal(false);
  storageError = signal('');

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getStorageConfig().subscribe(c => { this.storageCfg = { ...c, account_key: '' }; });
  }

  saveStorage() {
    this.storageSaving.set(true); this.storageSaved.set(false); this.storageError.set('');
    this.api.saveStorageConfig(this.storageCfg).subscribe({
      next: () => { this.storageSaving.set(false); this.storageSaved.set(true); setTimeout(() => this.storageSaved.set(false), 3000); },
      error: e => { this.storageSaving.set(false); this.storageError.set(e.message || 'Save failed'); },
    });
  }
}

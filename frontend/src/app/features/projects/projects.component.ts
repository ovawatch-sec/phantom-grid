
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { Project } from '../../core/models';

@Component({
  selector: 'sg-projects',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Projects</h1>
          <p class="page-sub">Create and manage recon engagements</p>
        </div>
        <button class="btn btn-primary" (click)="showCreate = !showCreate">
          + New Project
        </button>
      </div>

      <!-- Create form -->
      @if (showCreate) {
        <div class="card create-card">
          <h3 class="create-title">New Project</h3>
          <div class="form-group">
            <label class="form-label">Project Name</label>
            <input class="form-input" [(ngModel)]="newName" placeholder="e.g. example.com bug bounty" />
          </div>
          <div class="form-group">
            <label class="form-label">Description (optional)</label>
            <textarea class="form-textarea" [(ngModel)]="newDesc" placeholder="Scope details, notes…"></textarea>
          </div>
          <div class="create-actions">
            <button class="btn btn-ghost" (click)="showCreate=false">Cancel</button>
            <button class="btn btn-primary" (click)="create()" [disabled]="!newName.trim()">Create</button>
          </div>
        </div>
      }

      @if (loading()) {
        <div class="empty-state"><div class="spinner-sm"></div><span>Loading…</span></div>
      } @else if (projects().length === 0) {
        <div class="empty-state">
          <div class="empty-icon">◈</div>
          <h3>No projects yet</h3>
          <p>Create your first recon project to get started.</p>
        </div>
      } @else {
        <div class="projects-grid">
          @for (p of projects(); track p.id) {
            <div class="project-card" [routerLink]="['/projects', p.id]">
              <div class="pc-head">
                <span class="pc-icon">◈</span>
                <span class="pc-name">{{p.name}}</span>
              </div>
              @if (p.description) {
                <p class="pc-desc">{{p.description}}</p>
              }
              <div class="pc-footer">
                <span class="pc-scans">{{p.scan_count}} scan{{p.scan_count !== 1 ? 's' : ''}}</span>
                <span class="pc-date">{{p.created_at | date:'mediumDate'}}</span>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding:32px; max-width:1200px; margin:0 auto; }
    .page-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:28px; }
    .page-title { font-family:var(--font-head); font-size:24px; font-weight:700; }
    .page-sub { color:var(--text-dim); font-size:13px; margin-top:4px; }
    .create-card { margin-bottom:24px; max-width:560px; }
    .create-title { font-family:var(--font-head); font-size:15px; font-weight:600; margin-bottom:16px; }
    .create-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }
    .projects-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }
    .project-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-lg); padding:20px; cursor:pointer; transition:all 150ms; }
    .project-card:hover { border-color:var(--accent); box-shadow:0 4px 20px rgba(176,114,255,.10); transform:translateY(-2px); }
    .pc-head { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
    .pc-icon { font-size:18px; color:var(--accent); }
    .pc-name { font-family:var(--font-head); font-size:15px; font-weight:600; }
    .pc-desc { font-size:12px; color:var(--text-dim); margin-bottom:12px; line-height:1.5; }
    .pc-footer { display:flex; justify-content:space-between; font-size:11px; color:var(--text-dim); font-family:var(--font-mono); }
  `]
})
export class ProjectsComponent implements OnInit {
  projects = signal<Project[]>([]);
  loading = signal(true);
  showCreate = false;
  newName = '';
  newDesc = '';

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getProjects().subscribe({
      next: (ps) => { this.projects.set(ps); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  create() {
    if (!this.newName.trim()) return;
    this.api.createProject(this.newName.trim(), this.newDesc.trim()).subscribe(p => {
      this.projects.update(ps => [p, ...ps]);
      this.showCreate = false;
      this.newName = '';
      this.newDesc = '';
    });
  }
}

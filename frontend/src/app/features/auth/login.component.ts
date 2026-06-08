import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

/**
 * Combined first-run setup / login screen.
 * The route supplies a `mode` ('setup' | 'login'); the component re-checks the
 * backend status on init so a stale link cannot show the wrong form.
 */
@Component({
  selector: 'sg-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo">
          <img src="assets/phantom-grid-mark.svg" alt="PhantomGrid" />
          <span>PHANTOM<span class="accent">GRID</span></span>
        </div>

        @if (mode() === 'setup') {
          <h1>Create a password</h1>
          <p class="sub">First run — set a password to protect this instance.</p>
        } @else {
          <h1>Sign in</h1>
          <p class="sub">Enter your password to continue.</p>
        }

        <div class="form-group">
          <label class="form-label">Password</label>
          <input class="form-input" type="password" autocomplete="current-password"
            [(ngModel)]="password" (keyup.enter)="submit()" placeholder="••••••••" />
        </div>

        @if (mode() === 'setup') {
          <div class="form-group">
            <label class="form-label">Confirm password</label>
            <input class="form-input" type="password" autocomplete="new-password"
              [(ngModel)]="confirm" (keyup.enter)="submit()" placeholder="••••••••" />
          </div>
        }

        @if (error()) { <div class="alert alert-danger">{{error()}}</div> }

        <button class="btn btn-primary auth-btn" [disabled]="busy()" (click)="submit()">
          @if (busy()) { <span class="spinner-sm"></span> }
          {{ mode() === 'setup' ? 'Set Password & Continue' : 'Sign In' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .auth-wrap { min-height:calc(100vh - var(--topbar-h)); display:flex; align-items:center; justify-content:center; padding:24px; }
    .auth-card { width:100%; max-width:380px; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-lg); padding:32px; }
    .auth-logo { display:flex; align-items:center; gap:10px; font-family:var(--font-display); font-weight:900; letter-spacing:.12em; margin-bottom:24px; }
    .auth-logo img { width:42px; height:42px; }
    .auth-logo .accent { color:var(--accent); }
    h1 { font-family:var(--font-head); font-size:20px; font-weight:700; margin-bottom:4px; }
    .sub { color:var(--text-dim); font-size:13px; margin-bottom:20px; }
    .auth-btn { width:100%; margin-top:8px; justify-content:center; }
  `]
})
export class LoginComponent implements OnInit {
  mode = signal<'login' | 'setup'>('login');
  password = '';
  confirm = '';
  busy = signal(false);
  error = signal('');

  constructor(private auth: AuthService, private route: ActivatedRoute, private router: Router) {}

  ngOnInit() {
    this.mode.set(this.route.snapshot.data['mode'] === 'setup' ? 'setup' : 'login');
    // Reconcile against the real backend state.
    this.auth.status().subscribe({
      next: s => {
        if (s.initialized && this.mode() === 'setup') this.router.navigate(['/login']);
        if (!s.initialized && this.mode() === 'login') this.router.navigate(['/setup']);
      },
      error: () => {},
    });
  }

  submit() {
    this.error.set('');
    if (!this.password) { this.error.set('Password is required.'); return; }

    if (this.mode() === 'setup') {
      if (this.password.length < 8) { this.error.set('Password must be at least 8 characters.'); return; }
      if (this.password !== this.confirm) { this.error.set('Passwords do not match.'); return; }
    }

    this.busy.set(true);
    const op = this.mode() === 'setup'
      ? this.auth.setup(this.password)
      : this.auth.login(this.password);

    op.subscribe({
      next: () => this.router.navigate(['/projects']),
      error: err => {
        this.busy.set(false);
        this.error.set(err?.error?.detail || 'Authentication failed.');
      },
    });
  }
}

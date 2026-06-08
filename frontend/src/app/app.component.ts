import { Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from "@angular/router";
import { AuthService } from "./core/services/auth.service";

@Component({
  selector: "sg-root",
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <header class="topbar">
        <div class="logo">
          <div class="logo-div">
            <img class="logo-img" src="assets/phantom-grid-mark.svg" alt="PhantomGrid" />
          </div>
          <span>PHANTOM<span class="logo-accent">GRID</span></span>
        </div>
        @if (auth.authenticated()) {
          <div class="topbar-sep"></div>
          <nav class="topbar-nav">
            <a class="nav-link" routerLink="/projects" routerLinkActive="active">Projects</a>
            <a class="nav-link" routerLink="/settings" routerLinkActive="active">Settings</a>
          </nav>
          <button class="nav-link logout" (click)="logout()">Logout</button>
        }
      </header>
      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [
    `
      .shell {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
      .topbar {
        position: sticky;
        top: 0;
        z-index: 100;
        height: var(--topbar-h);
        background: rgba(6, 12, 22, 0.96);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        padding: 0 24px;
        gap: 16px;
      }
      .logo {
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: var(--font-display);
        font-size: 13px;
        font-weight: 900;
        letter-spacing: 0.12em;
        color: var(--text);
        white-space: nowrap;
      }
      .logo-img {
        width: 50px;
        height: 50px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
      }
      .logo-accent {
        color: var(--accent);
      }

      .topbar-sep {
        width: 1px;
        height: 28px;
        background: var(--border);
        flex-shrink: 0;
      }
      .topbar-nav {
        display: flex;
        gap: 4px;
      }
      .logout {
        margin-left: auto;
        background: none;
        border: 1px solid var(--border);
        cursor: pointer;
      }
      .nav-link {
        padding: 6px 14px;
        border-radius: var(--radius);
        font-family: var(--font-head);
        font-size: 13px;
        font-weight: 500;
        color: var(--text-dim);
        transition: all 150ms;
        text-decoration: none;
      }
      .nav-link:hover {
        color: var(--text);
        background: var(--bg-elevated);
      }
      .nav-link.active {
        color: var(--accent);
        background: rgba(0, 232, 122, 0.1);
      }
      .main-content {
        flex: 1;
      }
    `,
  ],
})
export class AppComponent {
  auth = inject(AuthService);
  private router = inject(Router);

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}

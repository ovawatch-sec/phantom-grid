import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

const TOKEN_KEY = 'sg_token';

/**
 * Single-password authentication client.
 * Persists the bearer token in localStorage and exposes a reactive auth state.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private base = '/api/auth';
  /** Reactive flag the guard/UI read to know if a token is present. */
  authenticated = signal<boolean>(!!localStorage.getItem(TOKEN_KEY));

  constructor(private http: HttpClient) {}

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  status(): Observable<{ initialized: boolean }> {
    return this.http.get<{ initialized: boolean }>(`${this.base}/status`);
  }

  setup(password: string): Observable<{ token: string }> {
    return this.http
      .post<{ token: string }>(`${this.base}/setup`, { password })
      .pipe(tap(res => this.store(res.token)));
  }

  login(password: string): Observable<{ token: string }> {
    return this.http
      .post<{ token: string }>(`${this.base}/login`, { password })
      .pipe(tap(res => this.store(res.token)));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.authenticated.set(false);
  }

  private store(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.authenticated.set(true);
  }
}

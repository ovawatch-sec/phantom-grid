import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Protects application routes:
 *  - sends first-time visitors to /setup when no password exists yet,
 *  - sends unauthenticated visitors to /login,
 *  - otherwise allows navigation.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.authenticated()) {
    return true;
  }

  return auth.status().pipe(
    map(status => {
      if (!status.initialized) {
        return router.createUrlTree(['/setup']);
      }
      return router.createUrlTree(['/login']);
    }),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};

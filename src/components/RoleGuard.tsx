/**
 * RoleGuard — block routes by role.
 *
 * Onboarding users have a deliberately narrow workspace. Any direct URL
 * to a forbidden page redirects to /clients instead of rendering the page.
 *
 * Onboarding IS allowed on /contacts and /calendar — but those pages
 * apply onboarding-scoped filters internally (trial / activation / check-in
 * records only). They are not full-CRM access.
 *
 * Leadership/SDR routes are unrestricted except for leadership-only surfaces.
 */
import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useUser } from '@/lib/user-context';

// Onboarding workspace = Awaiting Credentials · Onboarding Queue · Active Clients · Contacts.
const ONBOARDING_FORBIDDEN = new Set<string>([
  '/pipeline',
  '/payments',
  '/approvals',
  '/settings',
  '/team',
  '/admin',
  '/dashboard',
  '/calendar',
  '/conversions',
]);

// Leadership-only routes — SDRs are redirected to their workspace.
// /clients and /team are SDR-accessible (page-level filters scope the data
// to records they own / their own performance).
const LEADERSHIP_ONLY = new Set<string>([
  '/payments',
  '/approvals',
  '/conversions',
  '/settings',
  '/admin',
  '/team',
]);

interface Props {
  path: string;
  children: ReactNode;
}

export function RoleGuard({ path, children }: Props) {
  const { role } = useUser();

  if (role === 'onboarding' && ONBOARDING_FORBIDDEN.has(path)) {
    return <Navigate to="/clients" replace />;
  }

  if (role === 'sdr' && LEADERSHIP_ONLY.has(path)) {
    return <Navigate to="/pipeline" replace />;
  }

  return <>{children}</>;
}

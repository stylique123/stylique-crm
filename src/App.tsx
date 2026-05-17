import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, HashRouter, Route, Routes, Navigate } from "react-router-dom";
import { initLifecycleAutomation } from "@/engine/lifecycle-automation";
import { getLeads } from "@/lib/store";
import { seedSampleData } from "@/lib/seed-data";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider, useUser } from "@/lib/user-context";
import { CompanyStoreProvider } from "@/lib/company-store";
// DirectiveStore removed — directives feature is fully retired.
import { AttendanceProvider } from "@/lib/attendance-store";
import { LeaveProvider } from "@/lib/leave-store";
import { KPIDefinitionsProvider } from "@/lib/kpi-definitions-store";
import { EmployeeProvider } from "@/lib/employee-store";
import { BackendAuthGate } from "@/components/BackendAuthGate";
import { AppLayout } from "@/components/AppLayout";
import { RoleGuard } from "@/components/RoleGuard";

const AdminPage = lazy(() => import("./pages/AdminPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const ContactsPage = lazy(() => import("./pages/ContactsPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const NotFound = lazy(() => import("./pages/NotFound"));
const OnboardingClientsPage = lazy(() => import("./pages/OnboardingClientsPage"));
const PeoplePerformancePage = lazy(() => import("./pages/PeoplePerformancePage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const PipelinePage = lazy(() => import("./pages/PipelinePage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const queryClient = new QueryClient();
const Router = typeof window !== 'undefined' && window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

function PageShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      {children}
    </Suspense>
  );
}

initLifecycleAutomation();

// Preview/QA bootstrap.
// 1. ?reset=1  → wipe ALL persisted CRM state, then re-seed cleanly.
// 2. Version-guarded auto-seed → seeds exactly once per SEED_VERSION,
//    avoiding partial / mixed-state re-seeding on subsequent loads.
const SEED_VERSION = 'v5';
const SEED_VERSION_KEY = 'stylique:seedVersion';
try {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === '1') {
      // Preserve role selection across reset so QA can pin a role and reset data.
      const role = window.localStorage.getItem('stylique:currentUser');
      window.localStorage.clear();
      if (role) window.localStorage.setItem('stylique:currentUser', role);
      // Strip ?reset=1 so the next reload doesn't loop.
      const url = new URL(window.location.href);
      url.searchParams.delete('reset');
      window.history.replaceState({}, '', url.toString());
    }
    const seededVersion = window.localStorage.getItem(SEED_VERSION_KEY);
    const noLeads = getLeads().length === 0;
    if (noLeads && seededVersion !== SEED_VERSION) {
      seedSampleData();
      window.localStorage.setItem(SEED_VERSION_KEY, SEED_VERSION);
    } else if (noLeads) {
      // Empty store but already marked seeded → user explicitly cleared leads;
      // do not silently re-seed.
    } else if (seededVersion !== SEED_VERSION) {
      // Existing data from a prior version — mark current version without
      // re-seeding to avoid duplicates.
      window.localStorage.setItem(SEED_VERSION_KEY, SEED_VERSION);
    }
  }
} catch (e) {
  console.warn('[auto-seed] skipped:', e);
}

function IndexRedirect() {
  const { role } = useUser();
  switch (role) {
    case 'ceo':
    case 'coo':
      return <Navigate to="/dashboard" replace />;
    case 'onboarding':
      return <Navigate to="/clients" replace />;
    default:
      return <Navigate to="/dashboard" replace />;
  }
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <UserProvider>
        <BackendAuthGate>
          <CompanyStoreProvider>
            {/* DirectiveStoreProvider removed */}
              <AttendanceProvider>
                <LeaveProvider>
                  <EmployeeProvider>
                  <KPIDefinitionsProvider>
                  <Toaster />
                  <Sonner />
                  <Router>
                    <Routes>
                      <Route path="/" element={<AppLayout><IndexRedirect /></AppLayout>} />
                      <Route path="/dashboard" element={<RoleGuard path="/dashboard"><AppLayout><PageShell><Dashboard /></PageShell></AppLayout></RoleGuard>} />
                      <Route path="/tasks" element={<Navigate to="/pipeline" replace />} />
                      <Route path="/pipeline" element={<RoleGuard path="/pipeline"><AppLayout><PageShell><PipelinePage /></PageShell></AppLayout></RoleGuard>} />
                      <Route path="/calendar" element={<RoleGuard path="/calendar"><AppLayout><PageShell><CalendarPage /></PageShell></AppLayout></RoleGuard>} />
                      <Route path="/contacts" element={<RoleGuard path="/contacts"><AppLayout><PageShell><ContactsPage /></PageShell></AppLayout></RoleGuard>} />
                      <Route path="/approvals" element={<Navigate to="/clients#payment" replace />} />
                      <Route path="/payments" element={<RoleGuard path="/payments"><AppLayout><PageShell><PaymentsPage /></PageShell></AppLayout></RoleGuard>} />
                      <Route path="/clients" element={<RoleGuard path="/clients"><AppLayout><PageShell><OnboardingClientsPage /></PageShell></AppLayout></RoleGuard>} />
                      <Route path="/team" element={<RoleGuard path="/team"><AppLayout><PageShell><PeoplePerformancePage /></PageShell></AppLayout></RoleGuard>} />
                      <Route path="/admin" element={<RoleGuard path="/admin"><AppLayout><PageShell><AdminPage /></PageShell></AppLayout></RoleGuard>} />
                      {/* Legacy redirects */}
                      <Route path="/directives" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/decisions" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/risks" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/trials" element={<Navigate to="/pipeline" replace />} />
                      <Route path="/ended" element={<Navigate to="/pipeline" replace />} />
                      <Route path="/lost" element={<Navigate to="/pipeline" replace />} />
                      <Route path="/settings" element={<RoleGuard path="/settings"><AppLayout><PageShell><SettingsPage /></PageShell></AppLayout></RoleGuard>} />
                      <Route path="/revenue" element={<Navigate to="/clients" replace />} />
                      <Route path="/people" element={<Navigate to="/team" replace />} />
                      <Route path="/kpi" element={<Navigate to="/team" replace />} />
                      <Route path="/kpi-editor" element={<Navigate to="/team" replace />} />
                      <Route path="/attendance" element={<Navigate to="/team" replace />} />
                      <Route path="/team-performance" element={<Navigate to="/team" replace />} />
                      {/* /conversions has been folded into /clients to remove duplicate commercial pages. */}
                      <Route path="/conversions" element={<Navigate to="/clients" replace />} />
                      <Route path="*" element={<PageShell><NotFound /></PageShell>} />
                    </Routes>
                  </Router>
                  </KPIDefinitionsProvider>
                  </EmployeeProvider>
                </LeaveProvider>
              </AttendanceProvider>
            {/* /DirectiveStoreProvider removed */}
          </CompanyStoreProvider>
        </BackendAuthGate>
      </UserProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

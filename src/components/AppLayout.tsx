import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useUser } from '@/lib/user-context';
import { TEAM_MEMBERS } from '@/types/crm';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { User } from 'lucide-react';

export function AppLayout({ children }: { children: ReactNode }) {
  const { currentUser, setCurrentUser, role, userName } = useUser();
  const location = useLocation();

  const roleColors: Record<string, string> = {
    ceo: 'bg-primary/15 text-primary',
    coo: 'bg-primary/15 text-primary',
    sdr: 'bg-info/15 text-info',
    onboarding: 'bg-warning/15 text-warning',
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center justify-between border-b px-3 sm:px-4 bg-card/60 backdrop-blur-sm sticky top-0 z-10">
            <SidebarTrigger className="mr-2" />
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <User className="h-3 w-3 text-muted-foreground hidden sm:block" />
                <Select value={currentUser} onValueChange={setCurrentUser}>
                  <SelectTrigger className="w-28 sm:w-36 h-7 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_MEMBERS.map(m => (
                      <SelectItem key={m.id} value={m.id} className="text-xs">
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Badge className={`text-[9px] px-1.5 ${roleColors[role] || ''}`}>{role.toUpperCase()}</Badge>
              </div>
              <NotificationBell />
            </div>
          </header>
          <main className="flex-1 px-3 py-4 sm:px-6 sm:py-5 overflow-auto">
            <ErrorBoundary routeName={location.pathname} key={location.pathname}>
              {children}
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

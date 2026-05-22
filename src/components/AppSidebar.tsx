/**
 * STYLIQUE CRM — Sidebar Navigation
 * Strict role-based nav. NO Directives anywhere.
 */
import {
  LayoutDashboard, Users, Calendar,
  GitBranch, ClipboardCheck,
  Building2, Settings as SettingsIcon, CreditCard, Clock,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useUser } from '@/lib/user-context';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';

interface NavItem { title: string; url: string; icon: typeof GitBranch; }

function getNavItems(role: string): { main: NavItem[]; more: NavItem[] } {
  switch (role) {
    case 'ceo':
    case 'coo':
    case 'operations':
      return {
        main: [
          { title: 'Command Center', url: '/dashboard', icon: LayoutDashboard },
          { title: 'Clients', url: '/clients', icon: Building2 },
          { title: 'Payments', url: '/payments', icon: CreditCard },
          { title: 'Pipeline', url: '/pipeline', icon: GitBranch },
          { title: 'Contacts', url: '/contacts', icon: Users },
          { title: 'Calendar', url: '/calendar', icon: Calendar },
          { title: 'Attendance', url: '/team', icon: Clock },
        ],
        more: role === 'operations' ? [] : [
          { title: 'Settings', url: '/admin', icon: SettingsIcon },
        ],
      };
    case 'onboarding':
      // Onboarding workspace — client activation only.
      return {
        main: [
          { title: 'Onboarding Tasks', url: '/clients#queue', icon: ClipboardCheck },
          { title: 'Active Clients', url: '/clients#active', icon: Building2 },
          { title: 'Client Contacts', url: '/contacts', icon: Users },
        ],
        more: [],
      };
    case 'sdr':
    default:
      return {
        main: [
          { title: 'Command Center', url: '/dashboard', icon: LayoutDashboard },
          { title: 'Pipeline', url: '/pipeline', icon: GitBranch },
          { title: 'Clients', url: '/clients', icon: Building2 },
          { title: 'Contacts', url: '/contacts', icon: Users },
          { title: 'Calendar', url: '/calendar', icon: Calendar },
          { title: 'Attendance', url: '/team', icon: Clock },
        ],
        more: [],
      };
  }
}

export function AppSidebar() {
  const { state } = useSidebar();
  const { role } = useUser();
  const collapsed = state === 'collapsed';
  const { main, more } = getNavItems(role);

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className={`px-4 py-4 ${collapsed ? 'px-2' : ''}`}>
          {collapsed ? (
            <img src="/stylique-logo.png" alt="Stylique" className="mx-auto h-7 w-7 object-contain" />
          ) : (
            <div className="flex items-center gap-2">
              <img src="/stylique-logo.png" alt="Stylique" className="h-8 w-8 shrink-0 object-contain" />
              <span className="text-lg font-semibold tracking-tight text-sidebar-accent-foreground">
                Stylique <span className="text-primary/70 font-normal text-xs ml-1">CRM</span>
              </span>
            </div>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {main.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/pipeline'}
                      className="hover:bg-sidebar-accent/50 transition-colors text-sidebar-foreground"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span className="text-[13px]">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {more.length > 0 && (
          <SidebarGroup>
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/40 px-3 mb-1">
                More
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {more.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className="hover:bg-sidebar-accent/50 transition-colors text-sidebar-foreground/60"
                        activeClassName="bg-sidebar-accent text-primary font-medium"
                      >
                        <item.icon className="mr-2 h-3.5 w-3.5 shrink-0" />
                        {!collapsed && <span className="text-[12px]">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

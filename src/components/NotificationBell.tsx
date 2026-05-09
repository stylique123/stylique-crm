import { useState, useMemo } from 'react';
import { Bell } from 'lucide-react';
import { useCompanyStore } from '@/lib/company-store';
import { getTrialDaysLeft } from '@/types/crm';
import { getCanonicalState } from '@/engine/canonical-state';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

interface Notification {
  id: string;
  type: 'decision-due' | 'followup-due' | 'replied-lead';
  title: string;
  description: string;
  urgency: 'overdue' | 'warning' | 'info';
  route: string;
}

export function NotificationBell() {
  const { companies: leads } = useCompanyStore();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const notifications = useMemo(() => {
    const notifs: Notification[] = [];

    leads.forEach(lead => {
      const cs = getCanonicalState(lead);
      const isTrial = ['trial_active', 'trial_ready'].includes(cs.lifecycle_stage)
        || cs.trial_stage === 'active' || cs.trial_stage === 'ending' || cs.trial_stage === 'expired';
      const isClosedOrConverted = cs.lifecycle_stage === 'converted' || cs.lifecycle_stage === 'closed' || cs.lifecycle_stage === 'lost';

      // Decision due soon
      if (isTrial) {
        const days = getTrialDaysLeft(lead);
        if (days !== null && days <= 3) {
          notifs.push({
            id: `decision-${lead.id}`,
            type: 'decision-due',
            title: days <= 0 ? `Decision overdue` : `Decision due in ${days} day${days > 1 ? 's' : ''}`,
            description: `${lead.companyName}`,
            urgency: days <= 0 ? 'overdue' : 'warning',
            route: '/clients',
          });
        }
      }

      // Overdue follow-ups
      if (!isClosedOrConverted && lead.nextFollowUp) {
        const diff = new Date(lead.nextFollowUp).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
        if (diff < 0) {
          const daysOverdue = Math.ceil(Math.abs(diff) / (1000 * 60 * 60 * 24));
          notifs.push({
            id: `followup-${lead.id}`,
            type: 'followup-due',
            title: `Follow-up due`,
            description: `${lead.companyName} — was due ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} ago`,
            urgency: 'warning',
            route: `/pipeline?p=${lead.pipeline}`,
          });
        }
      }

      // Lead replied — needs response (canonical, alias-aware)
      if (cs.lifecycle_stage === 'replied' && lead.priority === 'high') {
        notifs.push({
          id: `replied-${lead.id}`,
          type: 'replied-lead',
          title: 'Reply received',
          description: `${lead.companyName}`,
          urgency: 'warning',
          route: `/pipeline?p=${lead.pipeline}`,
        });
      }
    });

    return notifs.sort((a, b) => {
      const order = { overdue: 0, warning: 1, info: 2 };
      return order[a.urgency] - order[b.urgency];
    });
  }, [leads]);

  const handleClick = (route: string) => {
    setOpen(false);
    navigate(route);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-lg hover:bg-secondary transition-colors">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {notifications.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-medium">
              {notifications.length > 9 ? '9+' : notifications.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-medium">Notifications</p>
          <p className="text-xs text-muted-foreground">{notifications.length} alert{notifications.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">All clear</p>
          ) : (
            notifications.map(n => (
              <button
                key={n.id}
                className="w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors border-b last:border-0"
                onClick={() => handleClick(n.route)}
              >
                <div className="flex items-start gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full mt-1.5 shrink-0",
                    n.urgency === 'overdue' ? 'bg-destructive' :
                    n.urgency === 'warning' ? 'bg-warning' : 'bg-info'
                  )} />
                  <div>
                    <p className="text-xs font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.description}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

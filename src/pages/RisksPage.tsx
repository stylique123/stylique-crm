/**
 * STYLIQUE CRM — Risks
 * Reads from central leadership-risk-engine. Approvals live in /decisions.
 * Strict eligibility: only items that meet the engine's thresholds appear here.
 */
import { useState, useMemo } from 'react';
import { useCompanyStore } from '@/lib/company-store';
import { useAttendance } from '@/lib/attendance-store';
import { useEmployees } from '@/lib/employee-store';
import { CompanyDetailSheet } from '@/components/CompanyDetailSheet';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, CreditCard, FlaskConical, Users, TrendingDown, Key,
  ChevronRight, Clock, CheckCircle, Calendar, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  computeLeadershipRisks, countRisksBySeverity,
  type RiskType, type RiskSeverity,
} from '@/engine/leadership-risk-engine';
import type { Lead } from '@/types/crm';

const TYPE_ICON: Record<RiskType, typeof AlertTriangle> = {
  payment_overdue: CreditCard,
  trial_expiring: FlaskConical,
  trial_at_risk: FlaskConical,
  churn_risk: TrendingDown,
  credentials_blocking: Key,
  onboarding_stalled: Activity,
  meeting_outcome_overdue: Calendar,
  repeat_attendance: Users,
  opportunity_stuck: Clock,
};

const SEVERITY_FILTERS: { value: 'all' | RiskSeverity; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
];

export default function RisksPage() {
  const { companies: leads, refresh } = useCompanyStore();
  const attendance = useAttendance();
  const employees = useEmployees();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [filter, setFilter] = useState<'all' | RiskSeverity>('all');

  const allRisks = useMemo(
    () => computeLeadershipRisks({ leads, attendance, employees }),
    [leads, attendance, employees]
  );
  const counts = countRisksBySeverity(allRisks);
  const visible = filter === 'all' ? allRisks : allRisks.filter(r => r.severity === filter);

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Risks</h1>
      </div>

      {/* Severity filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {SEVERITY_FILTERS.map(f => {
          const c = f.value === 'all' ? counts.total : counts[f.value as RiskSeverity];
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'h-7 px-3 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1.5',
                active
                  ? f.value === 'critical' ? 'bg-destructive/15 text-destructive border-destructive/30'
                  : f.value === 'high' ? 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30'
                  : f.value === 'medium' ? 'bg-muted text-foreground border-border'
                  : 'bg-secondary text-foreground border-border'
                  : 'bg-card text-muted-foreground border-border/40 hover:border-border'
              )}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{c}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle className="h-7 w-7 mx-auto text-[hsl(var(--success))]/50 mb-2" />
            <p className="text-sm font-medium text-muted-foreground">
              {filter === 'all' ? 'No active risks' : `No ${filter} risks`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map(risk => {
            const Icon = TYPE_ICON[risk.type];
            const isCritical = risk.severity === 'critical';
            const isHigh = risk.severity === 'high';
            return (
              <Card
                key={risk.id}
                className={cn(
                  'transition-colors bg-card border-border/50',
                  risk.lead && 'cursor-pointer hover:border-primary/30',
                  isCritical && 'border-l-2 border-l-destructive',
                  isHigh && 'border-l-2 border-l-[hsl(var(--warning))]'
                )}
                onClick={() => risk.lead && setSelectedLead(risk.lead)}
              >
                <CardContent className="py-3.5 px-4">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                      isCritical ? 'bg-destructive/10' :
                      isHigh ? 'bg-[hsl(var(--warning))]/10' : 'bg-muted/40'
                    )}>
                      <Icon className={cn(
                        'h-4 w-4',
                        isCritical ? 'text-destructive' :
                        isHigh ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground'
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-medium leading-snug">{risk.title}</h3>
                        <span className={cn(
                          'text-[9px] uppercase font-semibold tracking-wider',
                          isCritical ? 'text-destructive' :
                          isHigh ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground/60'
                        )}>
                          {risk.severity}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{risk.reason}</p>
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/70">
                        <span>Owner: {risk.owner}</span>
                        {risk.timePressure && (
                          <>
                            <span className="text-muted-foreground/30">·</span>
                            <span className={isCritical ? 'text-destructive' : isHigh ? 'text-[hsl(var(--warning))]' : ''}>
                              {risk.timePressure}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-[10px] text-primary/70 mt-1.5">→ {risk.unlock}</p>
                    </div>
                    {risk.lead && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0 mt-2" />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CompanyDetailSheet
        open={!!selectedLead}
        onOpenChange={o => { if (!o) { setSelectedLead(null); refresh(); } }}
        lead={selectedLead} defaultTab="overview"
        onAction={() => {}} onLeadUpdate={() => { refresh(); }}
      />
    </div>
  );
}

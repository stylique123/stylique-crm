import { useSyncExternalStore } from 'react';
import { TEAM_MEMBERS, SALES_MEMBERS, APPROVAL_MEMBERS, SDR_IDS, getTeamRosterVersion, subscribeTeamRoster } from '@/types/crm';
import { TEAM, getTeamVersion, subscribeTeam } from '@/types/roles';

/**
 * Subscribe to live team-roster changes. Returns the current arrays and a
 * version counter that flips whenever Settings adds/edits/deactivates a
 * teammate. Use in components that memoize on roster data.
 */
export function useTeamRoster() {
  const version = useSyncExternalStore(
    (cb) => {
      const u1 = subscribeTeamRoster(cb);
      const u2 = subscribeTeam(cb);
      return () => { u1(); u2(); };
    },
    () => getTeamRosterVersion() + getTeamVersion(),
    () => 0,
  );
  return { version, TEAM_MEMBERS, SALES_MEMBERS, APPROVAL_MEMBERS, SDR_IDS, TEAM };
}
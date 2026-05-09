/**
 * STYLIQUE CRM — Engine Index
 * 
 * Central re-export for all engine modules.
 */

export { getCanonicalTrialState, getTrialCounts, getTrialRole, getRoleTrialAction, getTrialSortPriority, getNextOnboardingTask, getVisibleTrialTasks, canViewCredentials, canEditCredentials, maskCredentialValue, getOnboardingStage, CHECK_IN_OUTCOMES, FEEDBACK_CALL_OUTCOMES } from './trial-engine';
export type { OnboardingStageKey, OnboardingStageInfo } from './trial-engine';
export { getCompanyStatus, getCompanyState, getEscalation, getPageCounts, getStageNextAction, getLifecyclePosition, isRevenueRisk, canActivateTrial, isValidTransition, getValidNextStages, type LifecycleStatus, type CompanyState, type CompanyFlags, type PageCounts, type LifecyclePosition } from './lifecycle-engine';
export { crmEventBus, emitCRMEvent, type CRMEvent, type CRMEventType } from './event-bus';
export { initLifecycleAutomation } from './lifecycle-automation';

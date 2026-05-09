## Plan: One Canonical Company Record

### Key Insight
The `Lead` type already IS the canonical company record with all needed fields. The problem is each page calls `getLeads()` independently, so state changes don't propagate. 

### Steps

**1. Create `useCompanyStore` — shared React context** (new file)
- Single `companies` state array, loaded once from `getLeads()`
- `refresh()`, `updateCompany()`, `getCompany(id)` methods
- All pages consume this context instead of calling `getLeads()` directly
- Changes from any page automatically reflect everywhere

**2. Clean up unused `entities.ts` & `entity-store.ts`**
- These define Company/Contact/Deal types that are never used
- Remove to eliminate confusion about which type is canonical

**3. Rename `Lead` → `Company` (type alias)**
- Add `export type Company = Lead` for clarity
- Gradual — no need to rename all usage, just add the alias

**4. Fix CompanyDetailSheet navigation**
- Ensure close button always visible (sticky header already exists)
- Add explicit close button for mobile
- Ensure tabs work on all viewports

**5. Wire all pages to `useCompanyStore`**
- Dashboard, Pipeline, Contacts, Trials, Conversions, Calendar, Tasks, ExecutionFeed
- Replace `useState + getLeads()` with `useCompanyStore()`
- One update = all pages see it immediately

**6. Verify counts match visible cards**
- All count logic reads from same store
- No separate computation per page

### Files Changed
- NEW: `src/lib/company-store.tsx` (context provider + hook)
- EDIT: `src/App.tsx` (wrap with provider)
- EDIT: All 8 page files (use hook instead of local state)
- EDIT: `src/types/crm.ts` (add Company alias)
- EDIT: `src/components/CompanyDetailSheet.tsx` (mobile close fix)
- DELETE: `src/types/entities.ts`, `src/lib/entity-store.ts`

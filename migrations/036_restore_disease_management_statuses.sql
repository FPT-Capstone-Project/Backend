BEGIN;

ALTER TABLE public.cultivation_issues
  DROP CONSTRAINT IF EXISTS chk_cultivation_issue_status,
  DROP CONSTRAINT IF EXISTS cultivation_issues_status_check;

ALTER TABLE public.cultivation_issues
  ADD CONSTRAINT chk_cultivation_issue_status CHECK (status IN (
    'OPEN',
    'WAITING_EXPERT',
    'IN_PROGRESS',
    'MONITORING',
    'WAITING_REVIEW',
    'RESOLVED',
    'PENDING_EXPERT',
    'UNDER_DIAGNOSIS',
    'NEED_MORE_INFO',
    'SOLUTION_PROVIDED',
    'PENDING_REVIEW',
    'REOPENED',
    'CANCELLED'
  )) NOT VALID;

COMMIT;

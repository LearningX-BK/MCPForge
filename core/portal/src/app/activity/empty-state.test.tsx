// @vitest-environment jsdom
//
// MCPForge — W0-J17: Activity's empty state carries the 03 §11.2
// ephemerality note verbatim ("No calls recorded yet. This local instance
// stores audit records in SQLite; they start empty on a fresh checkout.").
// A small, disclosed edit outside this task's primary `touches:` path
// (`core/portal/src/app/environments/**`) — see the task's final report.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./fixtures', () => ({
  CURRENT_USER_SUBJECT: 'user:test',
  loadActivityCalls: () => [],
  loadIntegrityVerification: () => ({
    deploymentId: 'local-dev',
    status: 'intact',
    rowsChecked: 0,
    origin: null,
    firstBreak: null,
  }),
}));

import ActivityPage from './page';

afterEach(cleanup);

describe('Activity empty state', () => {
  it('carries the ephemerality note, verbatim, when there is no audit data yet', () => {
    render(<ActivityPage />);
    expect(screen.getByTestId('activity-empty-state').textContent).toBe(
      'No calls recorded yet. This local instance stores audit records in SQLite; they start ' +
        'empty on a fresh checkout.',
    );
  });
});

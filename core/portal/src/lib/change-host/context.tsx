'use client';

// MCPForge — W0-J12: how the UI reaches a `ChangeHost` without learning which
// one it is (02 §10.1 item 1).
//
// Everything above this file — the branch chip, the change tray, the Propose
// dialog — takes `ChangeHost` (the interface) and `RepoState` (branch +
// remote). Neither `LocalGit` nor `HostedGit` is importable from here, and a
// test asserts no component file names either.
//
// `RepoState` may be supplied directly (the server component that renders the
// shell already knows it, so the branch chip needs no client round-trip) or
// left to the provider to load from the host on mount. Both paths exist
// because the portal is App Router: server-known values should not become
// client fetches, but a client-only story (tests, Storybook, a preview
// branch switch) still needs to work.
import * as React from 'react';

import type { ChangeHost, RemoteInfo } from './types';

export interface RepoState {
  /** The branch definitional data is read from (03 §6.4). Default `main`. */
  branch: string;
  remote: RemoteInfo;
}

export const DEFAULT_REPO_STATE: RepoState = {
  branch: 'main',
  remote: { configured: false },
};

interface ChangeHostContextValue {
  host: ChangeHost | undefined;
  repo: RepoState;
}

const ChangeHostContext = React.createContext<ChangeHostContextValue>({
  host: undefined,
  repo: DEFAULT_REPO_STATE,
});

export interface ChangeHostProviderProps {
  host?: ChangeHost | undefined;
  /** Server-known repo state; when omitted it is read from `host` on mount. */
  repo?: RepoState | undefined;
  children: React.ReactNode;
}

export function ChangeHostProvider({ host, repo, children }: ChangeHostProviderProps) {
  const [loaded, setLoaded] = React.useState<RepoState | undefined>(repo);

  React.useEffect(() => {
    if (repo !== undefined || host === undefined) return;
    let live = true;
    void (async () => {
      try {
        const [branch, remote] = await Promise.all([host.currentBranch(), host.describeRemote()]);
        if (live) setLoaded({ branch, remote });
      } catch {
        // A host that cannot answer leaves the safe default in place: `main`
        // and "no remote configured". Never guess a remote into existence —
        // that would put a review link in front of a user that does not exist.
        if (live) setLoaded(DEFAULT_REPO_STATE);
      }
    })();
    return () => {
      live = false;
    };
  }, [host, repo]);

  const value = React.useMemo<ChangeHostContextValue>(
    () => ({ host, repo: repo ?? loaded ?? DEFAULT_REPO_STATE }),
    [host, repo, loaded],
  );

  return <ChangeHostContext.Provider value={value}>{children}</ChangeHostContext.Provider>;
}

/** The host, or `undefined` when the tree is rendered without one. */
export function useOptionalChangeHost(): ChangeHost | undefined {
  return React.useContext(ChangeHostContext).host;
}

export function useRepoState(): RepoState {
  return React.useContext(ChangeHostContext).repo;
}

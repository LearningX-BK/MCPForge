// MCPForge — W0-J6: the app-shell barrel.
export { AppShell, type ShellProps } from './app-shell';
export { Sidebar, type SidebarProps } from './sidebar';
export { Topbar, persistTheme, type TopbarProps, type Density, type ThemeChoice } from './topbar';
export { BranchChip, NO_REMOTE_LABEL, type BranchChipProps } from './branch-chip';
export { ChangeTray, type ChangeTrayProps, type ChangeTrayItem } from './change-tray';
export {
  NAV,
  NAV_DESTINATIONS,
  NAV_GROUP_IDS,
  isDestinationActive,
  activeGroupId,
  type NavDestination,
  type NavGroup,
  type NavGroupId,
} from './nav';

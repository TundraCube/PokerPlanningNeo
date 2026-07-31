export interface ChangelogEntry {
  version: string;
  date: string;
  features: string[];
  fixes?: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    "version": "2026.07.31",
    "date": "2026-07-31",
    "features": [
      "Keep Room Active: option to make rooms persistent so bookmarked URLs never expire",
      "Jira Custom Domain: define your company Jira domain so task keys link directly to your issues without OAuth"
    ],
    "fixes": []
  },
  {
    "version": "2026.05.28",
    "date": "2026-05-28",
    "features": [
      "Seo improvement",
      "Seo fix",
      "Seo rewrite fix"
    ],
    "fixes": [
      "Normalize Jira task URLs to prevent duplicate protocol prefixes",
      "Rearrange stories"
    ]
  },
  {
    "version": "2026.05.27",
    "date": "2026-05-27",
    "features": [
      "Implement release popover with new features since last visit",
      "Filter technical chores from user-facing changelog",
      "Add deployment governance safety checks",
      "Show changelog popover to returning users without version in localStorage"
    ],
    "fixes": [
      "Cancel button style",
      "Update secondary badge tooltip to No link provided"
    ]
  },
  {
    "version": "2026.05.24",
    "date": "2026-05-24",
    "features": [
      "Make local player emulator visible to host only"
    ],
    "fixes": [
      "Resolve room joining guard auth timing and simplify guest rules",
      "Secure firestore rules, untrack secrets, and ignore build artifacts"
    ]
  },
  {
    "version": "2026.05.23",
    "date": "2026-05-23",
    "features": [
      "Adjust column distribution to 30%/70% on WFHD screens",
      "Implement two-column layout for WFHD/Ultrawide screens",
      "Replace duplicate and Jira sync alert dialogs with custom toasts",
      "Replace native browser alerts and confirms with custom styled toasts and modals",
      "Improve task UX, optimistic UI, fix SP sync bug",
      "Unify host controls and round results in sidebar and support id-based active task highlighting",
      "Sync jira files from main"
    ],
    "fixes": [
      "Resolve firebase api context issues, token expiry handling, and deprecated signals warnings",
      "Prevent grid blowout on ultrawide resolutions by using minmax(0, 1fr) columns",
      "Resolve Jira integration silently discarding tasks on expired tokens",
      "Resolve e2e test race condition and correct host view assertions"
    ]
  },
  {
    "version": "2026.05.20",
    "date": "2026-05-20",
    "features": [
      "Add SEO open graph meta tags and generate logo PNG assets",
      "Optimize layout for WFHD screens",
      "Improve card color spacing and ensure 13 is pink/red across all screens",
      "Unify voting card and results card colors based on estimate values",
      "Redesign host layout, remove players card grid, enlarge host voting deck",
      "Implement tasks list and local player emulator"
    ],
    "fixes": [
      "Truncate long participant names and prevent horizontal scroll in room sidebar",
      "Enforce global user-select and caret-color prevention with important overrides and explicit SVG targets",
      "Disable user-select globally to prevent blinking cursor on non-inputs",
      "Prevent blinking cursor on non-input focused elements"
    ]
  },
  {
    "version": "2025.12.07",
    "date": "2025-12-07",
    "features": [
      "Robust session ending and room guard implementation",
      "Implement editable room name and current story display for host",
      "Implement user-level grace period and fix UI",
      "Implement Leave Room functionality and refactor Room UI to use header and sidebar",
      "Implement zombie room cleanup and disconnection handling",
      "Complete initial game features and components",
      "Integrate sidebar and add loading state",
      "Refactor participants list with clean neon styling",
      "Implement neon voting cards with SVG-based gradient outlines",
      "Replace text branding with custom Neo SVG logo"
    ],
    "fixes": [
      "Merge coffee mug svg paths to resolve overlap",
      "Resolve re-entry modal, duplicate players, and vote sync issues"
    ]
  }
];

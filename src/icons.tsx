import type { ReactNode } from "react";

/**
 * The app's icon set, drawn on a 16px grid with 1.5px strokes, round caps,
 * and no fills except status dots.
 */
const PATHS: Record<string, ReactNode> = {
  open: (
    <>
      <path d="M1.8 3.6c0-.5.4-.9.9-.9h3l1.3 1.4h5.3c.5 0 .9.4.9.9v1.1H1.8z" />
      <path d="M1.8 5.6h12.4l-1.1 6.8c-.1.5-.5.9-1 .9H2.9c-.5 0-.9-.4-1-.9z" />
    </>
  ),
  refresh: (
    <>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13.2 2.2v3.1H10" />
    </>
  ),
  fetch: (
    <>
      <path d="M8 2v7" />
      <path d="M5.4 6.6 8 9.2l2.6-2.6" />
      <path d="M2.4 11v1.5c0 .5.4.9.9.9h9.4c.5 0 .9-.4.9-.9V11" />
    </>
  ),
  pull: (
    <>
      <path d="M8 2v7.4" />
      <path d="M5.2 6.7 8 9.5l2.8-2.8" />
      <path d="M2.5 13.2h11" />
      <path d="M4 11.5h8" opacity=".35" />
    </>
  ),
  push: (
    <>
      <path d="M8 9.6V2.2" />
      <path d="M5.2 5 8 2.2 10.8 5" />
      <path d="M2.5 13.2h11" />
      <path d="M4 11.5h8" opacity=".35" />
    </>
  ),
  branch: (
    <>
      <circle cx="4.4" cy="3.4" r="1.7" />
      <circle cx="4.4" cy="12.6" r="1.7" />
      <circle cx="11.6" cy="5.2" r="1.7" />
      <path d="M4.4 5.1v5.8" />
      <path d="M11.6 6.9c0 2.6-2.2 3.4-4.4 3.8" />
    </>
  ),
  tag: (
    <>
      <path d="M2.2 2.2h5.4c.4 0 .8.2 1.1.4l5 5c.5.5.5 1.3 0 1.8l-4.3 4.3c-.5.5-1.3.5-1.8 0l-5-5a1.6 1.6 0 0 1-.4-1.1z" />
      <circle cx="5.2" cy="5.2" r=".9" />
    </>
  ),
  commit: (
    <>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.2v3.7M8 11.1v3.7" />
    </>
  ),
  log: (
    <>
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="4" cy="12" r="1.6" />
      <path d="M4 5.6v4.8" />
      <path d="M7.4 4h6.4M7.4 12h6.4M7.4 8h4.8" opacity=".85" />
    </>
  ),
  console: (
    <>
      <rect x="1.6" y="2.4" width="12.8" height="11.2" rx="1.4" />
      <path d="m4.4 6 2 2-2 2M8.4 10.2h3.2" />
    </>
  ),
  settings: (
    <>
      <path d="M6.71 3.17 6.29 1.62h3.42l-.42 1.55 2.25 1.29 1.13-1.13 1.71 2.96-1.55.42v2.58l1.55.42-1.71 2.96-1.13-1.13-2.25 1.29.42 1.55H6.29l.42-1.55-2.25-1.29-1.13 1.13L1.62 9.71l1.55-.42V6.71l-1.55-.42 1.71-2.96 1.13 1.13z" />
      <circle cx="8" cy="8" r="2.25" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.3" />
      <path d="m10.3 10.3 3.5 3.5" />
    </>
  ),
  close: <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />,
  chevronDown: <path d="m4.2 6 3.8 3.8L11.8 6" />,
  chevronRight: <path d="m6 4.2 3.8 3.8L6 11.8" />,
  chevronUp: <path d="m4.2 10 3.8-3.8L11.8 10" />,
  expand: <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9.6 6.4M2.5 13.5l3.9-3.9" />,
  collapse: <path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5l4-4M6.5 9.5l-4 4" />,
  more: (
    <>
      <circle cx="3.2" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.8" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  check: <path d="m3.2 8.4 3.1 3.1 6.5-6.9" />,
  trash: (
    <>
      <path d="M2.8 4.4h10.4M6.4 4.4V2.8h3.2v1.6" />
      <path d="M4 4.4l.6 8.2c0 .5.4.8.9.8h5c.5 0 .9-.3.9-.8l.6-8.2" />
      <path d="M6.6 6.8v4.4M9.4 6.8v4.4" opacity=".5" />
    </>
  ),
  undo: (
    <>
      <path d="M5.3 3.2 2.5 6l2.8 2.8" />
      <path d="M2.8 6h6.1a4 4 0 0 1 0 8H6.4" />
    </>
  ),
  copy: (
    <>
      <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.2" />
      <path d="M10.6 5.4V3.6c0-.7-.5-1.2-1.2-1.2H3.6c-.7 0-1.2.5-1.2 1.2v5.8c0 .7.5 1.2 1.2 1.2h1.8" />
    </>
  ),
  external: <path d="M9.5 2.5h4v4M13.5 2.5 7.8 8.2M12 9.8v2.6c0 .6-.5 1.1-1.1 1.1H3.6c-.6 0-1.1-.5-1.1-1.1V5.1c0-.6.5-1.1 1.1-1.1h2.6" />,
  columns: (
    <>
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.2" />
      <path d="M8 2.6v10.8" />
    </>
  ),
  rows: (
    <>
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.2" />
      <path d="M1.8 8h12.4" />
    </>
  ),
  prevDiff: <path d="m6.8 8 4.6-4.6M3.2 3.2v9.6M11.4 3.4v9.2" />,
  nextDiff: <path d="m9.2 8-4.6 4.6M12.8 3.2v9.6M4.6 3.4v9.2" />,
  stage: (
    <>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4" opacity=".45" />
      <path d="M8 4.6v6.2M4.9 7.7h6.2" />
    </>
  ),
  unstage: (
    <>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4" opacity=".45" />
      <path d="M4.9 8h6.2" />
    </>
  ),
  stash: (
    <>
      <path d="M2 4.4h12v8.2c0 .6-.5 1.1-1.1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1z" />
      <path d="M2 4.4 3.5 2h9L14 4.4" />
      <path d="M6 7.4h4" />
    </>
  ),
  merge: (
    <>
      <circle cx="4.2" cy="3.6" r="1.6" />
      <circle cx="4.2" cy="12.4" r="1.6" />
      <circle cx="11.8" cy="12.4" r="1.6" />
      <path d="M4.2 5.2v5.6M4.2 8.6c3 0 4.6-1.6 5.6-3.4" />
    </>
  ),
  rebase: (
    <>
      <circle cx="4" cy="3.6" r="1.6" />
      <circle cx="12" cy="12.4" r="1.6" />
      <path d="M4 5.2v3.2c0 2 1.2 2.8 3 3.2" />
      <path d="m9.4 8.8 2.6 2.6" />
    </>
  ),
  cherry: (
    <>
      <circle cx="8" cy="9.4" r="2.6" />
      <path d="M8 6.8c0-2.6 1.6-4.2 4-4.2M8 6.8c-.4-2-1.4-3.2-3.2-3.8" />
      <path d="M8 12v2" />
    </>
  ),
  revert: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 5.2v3.4l2.3 1.4" />
      <path d="m2.6 8-1.6-1.8M2.6 8l1.8-1.5" opacity=".7" />
    </>
  ),
  reset: (
    <>
      <path d="M2.4 8a5.6 5.6 0 1 0 1.7-4" />
      <path d="M2 2.4v3.4h3.4" />
    </>
  ),
  ours: <path d="M13 8H3M6.4 4.6 3 8l3.4 3.4" />,
  theirs: <path d="M3 8h10M9.6 4.6 13 8l-3.4 3.4" />,
  sparkle: (
    <>
      <path d="M8 2.2 9.2 6l3.8 1.2L9.2 8.4 8 12.2 6.8 8.4 3 7.2 6.8 6z" />
      <path d="M12.6 1.6v1.8M11.7 2.5h1.8" opacity=".7" />
    </>
  ),
  file: (
    <>
      <path d="M3.4 1.8h6l3.2 3.2v9.2H3.4z" />
      <path d="M9.4 1.8v3.2h3.2" opacity=".6" />
    </>
  ),
  folder: <path d="M1.9 3.6c0-.5.4-.9.9-.9h3.2l1.3 1.5h5.9c.5 0 .9.4.9.9v7.4c0 .5-.4.9-.9.9H2.8c-.5 0-.9-.4-.9-.9z" />,
  folderOpen: (
    <>
      <path d="M1.9 3.6c0-.5.4-.9.9-.9h3.2l1.3 1.5h5.3c.5 0 .9.4.9.9v.9H1.9z" />
      <path d="M1.9 5.7h12.2l-1.1 6.2c-.1.5-.5.9-1 .9H2.9c-.5 0-.9-.4-.9-.9z" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.2 14.2 13H1.8z" />
      <path d="M8 6v3.4" />
      <circle cx="8" cy="11.3" r=".7" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 7.2v3.6" />
      <circle cx="8" cy="5.1" r=".7" fill="currentColor" stroke="none" />
    </>
  ),
  error: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" />
    </>
  ),
  git: (
    <>
      <circle cx="4.2" cy="3.6" r="1.5" />
      <circle cx="4.2" cy="12.4" r="1.5" />
      <circle cx="11.8" cy="8" r="1.5" />
      <path d="M4.2 5.1v5.8M5.6 4.4l4.7 3M5.6 11.6l4.7-3" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.2" r="2.6" />
      <path d="M3 13.2c.3-2.4 2.4-4 5-4s4.7 1.6 5 4" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  hash: <path d="M6 2.6 5 13.4M11 2.6l-1 10.8M2.8 6h10.6M2.6 10h10.6" />,
  diff: (
    <>
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.2" />
      <path d="M8 2.6v10.8" />
      <path d="M3.8 5.6h2M4.8 4.6v2M10.4 8.2h2" />
    </>
  ),
  eye: (
    <>
      <path d="M1.6 8s2.3-4.2 6.4-4.2S14.4 8 14.4 8 12.1 12.2 8 12.2 1.6 8 1.6 8z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  edit: (
    <>
      <path d="M10.4 2.6 13.4 5.6 5.8 13.2 2.2 13.8l.6-3.6z" />
      <path d="m9.2 3.8 3 3" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.2v7.4M5.2 6.8 8 9.6l2.8-2.8" />
      <path d="M2.6 12.8h10.8" />
    </>
  ),
  list: (
    <>
      <path d="M5.4 3.8h8.6M5.4 8h8.6M5.4 12.2h8.6" />
      <circle cx="2.6" cy="3.8" r=".8" fill="currentColor" stroke="none" />
      <circle cx="2.6" cy="8" r=".8" fill="currentColor" stroke="none" />
      <circle cx="2.6" cy="12.2" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  graph: (
    <>
      <circle cx="4" cy="3.2" r="1.5" />
      <circle cx="4" cy="12.8" r="1.5" />
      <circle cx="12" cy="8" r="1.5" />
      <path d="M4 4.7v6.6M5.5 4.1c2.6 1 4.4 1.8 5.2 2.6M5.5 11.9c2.6-1 4.4-1.8 5.2-2.6" />
    </>
  ),
  drag: (
    <>
      <circle cx="5" cy="4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="11" cy="4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="5" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="11" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r=".9" fill="currentColor" stroke="none" />
      <circle cx="11" cy="12" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon${className ? " " + className : ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

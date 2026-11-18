// Line icons from the approved mockup, drawn on a 24px grid.
const ICON_PATHS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  box: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  bag: 'M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2',
  truck: 'M2 6h12v10H2zM14 9h4l4 4v3h-8M6 19.5a1.5 1.5 0 1 0 0-.01M17 19.5a1.5 1.5 0 1 0 0-.01',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M16 13.5h2',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 12h6M12 9v6',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  chart: 'M5 20V11M11 20V5M17 20v-7M3 20h18',
  rise: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.2a2.6 2.6 0 1 1 3.2 2.5c-.7.2-.7.9-.7 1.6M12 16.8h.01',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  x: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  check: 'M5 12l5 5L20 7',
} as const;

export type IconName = keyof typeof ICON_PATHS;

// Icons that point in a reading direction are mirrored in Arabic.
const DIRECTIONAL_ICONS: ReadonlySet<IconName> = new Set(['logout']);

export function Icon({ name, size = 18, strokeWidth = 1.9 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      className={DIRECTIONAL_ICONS.has(name) ? 'flip' : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

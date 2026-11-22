import type { JSX } from 'react'

export type IconName =
  | 'home'
  | 'bolt'
  | 'route'
  | 'book'
  | 'chart'
  | 'sliders'
  | 'play'
  | 'pause'
  | 'stop'
  | 'check'
  | 'x'
  | 'plus'
  | 'minus'
  | 'chevronR'
  | 'chevronL'
  | 'chevronD'
  | 'flame'
  | 'trophy'
  | 'clock'
  | 'download'
  | 'share'
  | 'upload'
  | 'trash'
  | 'info'
  | 'lock'
  | 'moon'
  | 'sun'
  | 'sparkle'
  | 'target'
  | 'arrowR'
  | 'rotate'
  | 'skip'
  | 'volume'
  | 'monitor'
  | 'flag'
  | 'medal'
  | 'calendar'
  | 'hourglass'
  | 'layers'
  | 'mountain'
  | 'rocket'
  | 'wing'
  | 'crown'
  | 'ladder'
  | 'hand'
  | 'person'
  | 'balance'
  | 'diamond'
  | 'hook'
  | 'magnet'
  | 'shield'
  | 'star'
  | 'dumbbell'
  | 'compass'
  | 'leaf'
  | 'flask'
  | 'repeat'
  | 'pencil'
  | 'alert'
  | 'refresh'
  | 'eye'
  | 'hammer'

const PATHS: Record<IconName, JSX.Element> = {
  home: (
    <>
      <path d="M3 10.75 12 3l9 7.75" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  bolt: <path d="M13 2 4.5 13.5H11L9.5 22 18 10.5h-6.5L13 2z" />,
  route: (
    <>
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="5" r="2.2" />
      <path d="M8.2 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8" />
    </>
  ),
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20v-6" />
      <path d="M9.3 20V9" />
      <path d="M14.6 20v-8" />
      <path d="M20 20V4" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h16" />
      <circle cx="9.5" cy="7" r="2.2" fill="var(--t-surface)" />
      <path d="M4 15.5h16" />
      <circle cx="15" cy="15.5" r="2.2" fill="var(--t-surface)" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,
  check: <path d="M4.5 12.5 10 18 19.5 7" />,
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  chevronR: <path d="M9 5.5l6.5 6.5L9 18.5" />,
  chevronL: <path d="M15 5.5 8.5 12l6.5 6.5" />,
  chevronD: <path d="M5.5 9 12 15.5 18.5 9" />,
  flame: (
    <path d="M12 22c3.9 0 6.5-2.6 6.5-6.2 0-3.8-2.8-5.7-3.9-8.8-1.6 1.5-2.5 2.8-2.7 4.7-.9-.8-1.8-2.2-1.9-3.9C7.7 9.7 5.5 12 5.5 15.8 5.5 19.4 8.1 22 12 22z" />
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
      <path d="M8 5H5v1.5A3.5 3.5 0 0 0 8.5 10" />
      <path d="M16 5h3v1.5A3.5 3.5 0 0 1 15.5 10" />
      <path d="M12 13v4" />
      <path d="M8.5 20h7" />
      <path d="M10 17h4v3h-4z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V3.5" />
      <path d="m7.5 8 4.5-4.5L16.5 8" />
      <path d="M8 11.5H6.5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2H16" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5V15" />
      <path d="m7 10.5 5 5 5-5" />
      <path d="M4.5 20.5h15" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V3.5" />
      <path d="m7 8.5 5-5 5 5" />
      <path d="M4.5 20.5h15" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 13.5h9l1-13.5" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.8v.4" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  moon: <path d="M20.5 14A8.5 8.5 0 1 1 10 3.5 7 7 0 0 0 20.5 14z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5 13.8 9 19.5 11 13.8 13 12 18.5 10.2 13 4.5 11 10.2 9 12 3.5z" />
      <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </>
  ),
  arrowR: (
    <>
      <path d="M4.5 12h15" />
      <path d="m13.5 6 6 6-6 6" />
    </>
  ),
  rotate: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 3.5v4h-4" />
    </>
  ),
  skip: (
    <>
      <path d="M6 5.5v13l8.5-6.5L6 5.5z" fill="currentColor" stroke="none" />
      <path d="M17.5 5.5v13" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6" />
      <path d="M17.8 6.6a8 8 0 0 1 0 10.8" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12.5" rx="2" />
      <path d="M9 20.5h6M12 17v3.5" />
    </>
  ),
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  medal: <><circle cx="12" cy="15" r="5" /><path d="M8.5 10.5 6 3h4l2 4 2-4h4l-2.5 7.5" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M8.5 3v4M15.5 3v4" /></>,
  hourglass: <><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></>,
  mountain: <><path d="m3 20 6-11 4 7 2-3 6 7H3z" /></>,
  rocket: <><path d="M12 3c3 2 5 5 5 9l-2 4H9l-2-4c0-4 2-7 5-9z" /><circle cx="12" cy="10" r="1.6" /><path d="M9 16l-2 4M15 16l2 4" /></>,
  wing: <><path d="M3 18c4 0 8-2 10-6 1-2 2-4 5-6 0 5-1 8-4 11-3 2-7 2-11 1z" /><path d="M9 15c2-1 4-3 5-5" /></>,
  crown: <><path d="m4 8 4 4 4-7 4 7 4-4-2 11H6L4 8z" /></>,
  ladder: <><path d="M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8" /></>,
  hand: <><path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2.5-3.5a1.5 1.5 0 0 1 2.3-1.8L8 14" /></>,
  person: <><circle cx="12" cy="5" r="2" /><path d="M12 8v7M8 11l4-3 4 3M9.5 21 12 15l2.5 6" /></>,
  balance: <><path d="M12 4v16M6 20h12M4 8h16" /><path d="m4 8-2 5h4l-2-5zM20 8l-2 5h4l-2-5z" /></>,
  diamond: <><path d="M6 4h12l4 6-10 11L2 10l4-6z" /><path d="M2 10h20" /></>,
  hook: <><path d="M12 3v11a4 4 0 0 1-8 0M12 3h-2M20 14a4 4 0 0 1-8 0" /></>,
  magnet: <><path d="M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3H5z" /><path d="M5 7h4M15 7h4" /></>,
  shield: <><path d="M12 3 4.5 6v6c0 4.5 3 7.5 7.5 9 4.5-1.5 7.5-4.5 7.5-9V6L12 3z" /></>,
  star: <><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" /></>,
  dumbbell: <><path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2z" /></>,
  leaf: <><path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15z" /><path d="M5 19c3-5 6-8 10-10" /></>,
  flask: <><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" /><path d="M7.5 15h9" /></>,
  repeat: <><path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" /></>,
  pencil: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="m13.5 6.5 4 4" /></>,
  alert: <><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 10v4.5M12 17.5v.1" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  hammer: <><path d="m14 6 4 4M4 20l9-9M12 4l4-1 5 5-1 4-4 1-4-4V4z" /></>,
}

export function Icon({
  name,
  size = 20,
  className = '',
  strokeWidth = 2,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

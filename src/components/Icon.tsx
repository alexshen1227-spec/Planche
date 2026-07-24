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

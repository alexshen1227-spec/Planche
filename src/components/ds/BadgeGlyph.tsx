import { Icon, type IconName } from '../Icon'

/** A badge's mark: a stroke icon on a quiet tile. Locked badges are muted, not hidden. */
export function BadgeGlyph({
  icon,
  size = 40,
  earned = true,
  className = '',
}: {
  icon: IconName
  size?: number
  earned?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-control ${
        earned ? 'bg-accent-soft text-accent-text' : 'bg-raised text-ink3'
      } ${className}`}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={Math.round(size * 0.52)} />
    </span>
  )
}

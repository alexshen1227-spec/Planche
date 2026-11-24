import type { SportLoadAreas } from '../../lib/gym/types'
import { ToggleChip } from '../ds'

export function SportAreas({ areas, onChange }: { areas: SportLoadAreas; onChange: (patch: Partial<SportLoadAreas>) => void }) {
  return (
    <fieldset>
      <legend className="text-footnote font-medium text-ink2">Areas worked</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        <ToggleChip active={areas.legs} onClick={() => onChange({ legs: !areas.legs })}>Legs</ToggleChip>
        <ToggleChip active={Boolean(areas.upperPush)} onClick={() => onChange({ upperPush: !areas.upperPush })}>Pressing</ToggleChip>
        <ToggleChip active={Boolean(areas.upperPull)} onClick={() => onChange({ upperPull: !areas.upperPull })}>Pulling and grip</ToggleChip>
      </div>
    </fieldset>
  )
}

import { useState } from 'react'
import { EQUIPMENT_OPTIONS } from '../../data/equipment'
import { GYM_EQUIPMENT, locationEquipmentLabel as labelOf, type GymEquipmentId, type Unit } from '../../data/gym/catalog'
import type { LocationEquipment } from '../../data/gym/exercises'
import { availableAt } from '../../lib/gym/availability'
import type { GymLocation } from '../../lib/gym/types'
import { displayLoad, toKg } from '../../lib/gym/units'
import { Button, SegmentedControl, ToggleChip } from '../ds'

const GROUPS: { title: string; ids: LocationEquipment[] }[] = [
  { title: 'Calisthenics kit', ids: EQUIPMENT_OPTIONS.map((o) => o.id) },
  { title: 'Free weights', ids: ['barbell', 'dumbbells', 'kettlebells', 'ez-bar', 'trap-bar', 'plates', 'dip-belt'] },
  { title: 'Benches and racks', ids: GYM_EQUIPMENT.filter((e) => e.kind === 'bench').map((e) => e.id) },
  { title: 'Cables', ids: ['cable', 'lat-pulldown', 'cable-row'] },
  {
    title: 'Machines',
    ids: GYM_EQUIPMENT.filter((e) => e.kind === 'machine' && !['lat-pulldown', 'cable-row'].includes(e.id)).map((e) => e.id),
  },
  { title: 'Other', ids: GYM_EQUIPMENT.filter((e) => (e.kind === 'accessory' || e.kind === 'space') && e.id !== 'plates' && e.id !== 'dip-belt').map((e) => e.id) },
]

/** Name, units, equipment and top weights for one location. */
export function LocationEditor({
  location,
  canDelete,
  onSave,
  onDelete,
}: {
  location: GymLocation
  canDelete: boolean
  onSave: (location: GymLocation) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState<GymLocation>(location)
  const has = new Set(draft.equipment)
  const toggle = (id: LocationEquipment) =>
    setDraft((d) => ({ ...d, equipment: has.has(id) ? d.equipment.filter((e) => e !== id) : [...d.equipment, id] }))
  const gear = (id: GymEquipmentId) => draft.gear?.[id] ?? {}
  const setGear = (id: GymEquipmentId, patch: { unit?: Unit; maxKg?: number }) =>
    setDraft((d) => ({ ...d, gear: { ...d.gear, [id]: { ...d.gear?.[id], ...patch } } }))
  const count = availableAt(draft).length

  return (
    <div className="space-y-5">
      <h2 className="font-display text-title2 font-semibold text-ink">{location.name || 'Place'}</h2>
      <div>
        <label htmlFor="location-name" className="text-footnote font-medium text-ink2">
          Name of this place
        </label>
        <input
          id="location-name"
          autoComplete="off"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 40) })}
          className="mt-1 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body"
        />
      </div>
      <div>
        <span className="text-footnote font-medium text-ink2">Weights here are in</span>
        <SegmentedControl
          className="mt-1"
          label="Unit"
          value={draft.unit}
          onChange={(u) => setDraft({ ...draft, unit: u })}
          options={[
            { value: 'kg' as Unit, label: 'kg' },
            { value: 'lb' as Unit, label: 'lb' },
          ]}
        />
        <p className="mt-1 text-caption text-ink3">Set a different unit for dumbbells or kettlebells below if this place mixes them.</p>
      </div>

      {GROUPS.map((group) => (
        <fieldset key={group.title}>
          <legend className="text-footnote font-semibold text-ink">{group.title}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {group.ids.map((id) => (
              <ToggleChip key={id} active={has.has(id)} onClick={() => toggle(id)}>
                {labelOf(id)}
              </ToggleChip>
            ))}
          </div>
        </fieldset>
      ))}

      {(['dumbbells', 'kettlebells'] as GymEquipmentId[])
        .filter((id) => has.has(id))
        .map((id) => {
          const unit = gear(id).unit ?? draft.unit
          const max = gear(id).maxKg
          return (
            <div key={id} className="rounded-card border border-line p-4">
              <p className="text-body font-semibold">{labelOf(id)}</p>
              <div className="mt-2 flex items-center gap-2">
                <label className="flex-1">
                  <span className="text-caption text-ink3">Heaviest pair ({unit})</span>
                  <input
                    inputMode="decimal"
                    value={max !== undefined ? String(displayLoad(max, unit)) : ''}
                    placeholder="Not set"
                    aria-label={`Heaviest ${labelOf(id).toLowerCase()} in ${unit}`}
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(',', '.'))
                      setGear(id, { maxKg: Number.isFinite(v) && v > 0 ? toKg(v, unit) : undefined })
                    }}
                    className="mt-1 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body"
                  />
                </label>
                <SegmentedControl
                  className="self-end"
                  label={`${labelOf(id)} unit`}
                  value={unit}
                  onChange={(u) => setGear(id, { unit: u })}
                  options={[
                    { value: 'kg' as Unit, label: 'kg' },
                    { value: 'lb' as Unit, label: 'lb' },
                  ]}
                />
              </div>
            </div>
          )
        })}

      <p className="text-footnote text-ink2">{count} exercises can be programmed here.</p>
      <div className="grid gap-2">
        <Button size="lg" full onClick={() => onSave({ ...draft, name: draft.name.trim() || 'Gym' })}>
          Save
        </Button>
        {canDelete ? (
          <Button variant="ghost" full onClick={onDelete} className="text-danger-text">
            Delete this location
          </Button>
        ) : null}
      </div>
    </div>
  )
}

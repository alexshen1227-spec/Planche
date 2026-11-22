import { useState } from 'react'
import { EQUIPMENT_OPTIONS } from '../../data/equipment'
import { GYM_EQUIPMENT, GYM_EQUIPMENT_BY_ID, type GymEquipmentId, type Unit } from '../../data/gym/catalog'
import type { LocationEquipment } from '../../data/gym/exercises'
import { availableAt } from '../../lib/gym/availability'
import type { GymLocation } from '../../lib/gym/types'
import { displayLoad, toKg } from '../../lib/gym/units'

const GROUPS: { title: string; ids: LocationEquipment[] }[] = [
  { title: 'Calisthenics kit', ids: EQUIPMENT_OPTIONS.map((o) => o.id) },
  { title: 'Free weights', ids: ['barbell', 'dumbbells', 'kettlebells', 'ez-bar', 'trap-bar', 'plates', 'dip-belt'] },
  { title: 'Benches and racks', ids: ['squat-rack', 'bench', 'incline-bench', 'preacher-bench', 'back-extension'] },
  { title: 'Cables', ids: ['cable', 'lat-pulldown', 'cable-row'] },
  {
    title: 'Machines',
    ids: GYM_EQUIPMENT.filter((e) => e.kind === 'machine' && !['lat-pulldown', 'cable-row'].includes(e.id)).map((e) => e.id),
  },
  { title: 'Other', ids: ['ab-wheel', 'medicine-ball', 'track'] },
]

function labelOf(id: LocationEquipment): string {
  return GYM_EQUIPMENT_BY_ID[id as GymEquipmentId]?.label ?? EQUIPMENT_OPTIONS.find((o) => o.id === id)?.label ?? id
}

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
      <label className="block">
        <span className="text-[13px] font-medium text-ink2">Name</span>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 40) })}
          className="mt-1 min-h-11 w-full rounded-xl border border-line bg-raised px-3 text-[15px]"
        />
      </label>
      <div>
        <span className="text-[13px] font-medium text-ink2">Weights here are in</span>
        <div className="mt-1 flex gap-2" role="group" aria-label="Unit">
          {(['kg', 'lb'] as Unit[]).map((u) => (
            <button
              key={u}
              onClick={() => setDraft({ ...draft, unit: u })}
              aria-pressed={draft.unit === u}
              className={`min-h-11 flex-1 rounded-xl border text-[15px] font-semibold ${draft.unit === u ? 'border-transparent bg-accent text-on-accent' : 'border-line'}`}
            >
              {u}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-ink3">Set a different unit for dumbbells or kettlebells below if this place mixes them.</p>
      </div>

      {GROUPS.map((group) => (
        <fieldset key={group.title}>
          <legend className="text-[13px] font-semibold text-ink">{group.title}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {group.ids.map((id) => (
              <button
                key={id}
                onClick={() => toggle(id)}
                aria-pressed={has.has(id)}
                className={`min-h-10 rounded-full border px-3.5 text-[13px] font-medium ${has.has(id) ? 'border-transparent bg-accent text-on-accent' : 'border-line text-ink2'}`}
              >
                {labelOf(id)}
              </button>
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
            <div key={id} className="rounded-2xl border border-line p-3">
              <p className="text-[14px] font-semibold">{labelOf(id)}</p>
              <div className="mt-2 flex items-center gap-2">
                <label className="flex-1">
                  <span className="text-[12px] text-ink3">Heaviest pair ({unit})</span>
                  <input
                    inputMode="decimal"
                    value={max !== undefined ? String(displayLoad(max, unit)) : ''}
                    placeholder="Not set"
                    aria-label={`Heaviest ${labelOf(id).toLowerCase()} in ${unit}`}
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(',', '.'))
                      setGear(id, { maxKg: Number.isFinite(v) && v > 0 ? toKg(v, unit) : undefined })
                    }}
                    className="mt-1 min-h-11 w-full rounded-xl border border-line bg-raised px-3 text-[15px]"
                  />
                </label>
                <div className="flex gap-1 self-end" role="group" aria-label={`${labelOf(id)} unit`}>
                  {(['kg', 'lb'] as Unit[]).map((u) => (
                    <button
                      key={u}
                      onClick={() => setGear(id, { unit: u })}
                      aria-pressed={unit === u}
                      className={`min-h-11 rounded-xl border px-3 text-[14px] font-semibold ${unit === u ? 'border-transparent bg-accent text-on-accent' : 'border-line'}`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        })}

      <p className="text-[13px] text-ink2">{count} exercises can be programmed here.</p>
      <div className="grid gap-2">
        <button
          onClick={() => onSave({ ...draft, name: draft.name.trim() || 'Gym' })}
          className="min-h-12 rounded-xl bg-accent text-[15px] font-semibold text-on-accent"
        >
          Save
        </button>
        {canDelete ? (
          <button onClick={onDelete} className="min-h-11 text-[14px] font-medium text-danger-text">
            Delete this location
          </button>
        ) : null}
      </div>
    </div>
  )
}

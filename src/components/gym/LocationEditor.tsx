import { useState } from 'react'
import { EQUIPMENT_OPTIONS } from '../../data/equipment'
import { GYM_EQUIPMENT, locationEquipmentLabel as labelOf, type GymEquipmentDef, type GymEquipmentId, type Unit } from '../../data/gym/catalog'
import type { LocationEquipment } from '../../data/gym/exercises'
import { availableAt } from '../../lib/gym/availability'
import type { GymLocation } from '../../lib/gym/types'
import { entryLoad, fromKg, toKg } from '../../lib/gym/units'
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

function LoadField({ label, name, unit, kg, minKg, maxKg, placeholder, onChange }: {
  label: string
  name: string
  unit: Unit
  kg?: number
  minKg?: number
  maxKg: number
  placeholder: string
  onChange: (value: number | undefined) => void
}) {
  return (
    <label className="block min-w-0">
      <span className="text-caption text-ink3">{label} ({unit})</span>
      <input key={unit} type="number" inputMode="decimal" step="any" min={minKg === undefined ? 0.001 : fromKg(minKg, unit)} max={fromKg(maxKg, unit)}
        defaultValue={kg === undefined ? '' : entryLoad(kg, unit)} aria-label={name} placeholder={placeholder}
        onChange={(event) => {
          const input = event.currentTarget
          if (!input.value && !input.validity.badInput) onChange(undefined)
          else if (input.validity.valid) onChange(toKg(input.valueAsNumber, unit))
        }}
        className="mt-1 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body"
      />
    </label>
  )
}

/** Name, units, equipment and top weights for one location. */
export function LocationEditor({
  location,
  canDelete,
  onDraftChange,
  onSave,
  onDelete,
}: {
  location: GymLocation
  canDelete: boolean
  onDraftChange?: (location: GymLocation) => void
  onSave: (location: GymLocation) => void
  onDelete: () => void
}) {
  const [local, setLocal] = useState(location)
  const draft = onDraftChange ? location : local
  const setDraft = onDraftChange ?? setLocal
  const [selectedGear, setSelectedGear] = useState<GymEquipmentId | null>(null)
  const has = new Set(draft.equipment)
  const toggle = (id: LocationEquipment) =>
    setDraft({ ...draft, equipment: has.has(id) ? draft.equipment.filter((e) => e !== id) : [...draft.equipment, id] })
  const gear = (id: GymEquipmentId) => draft.gear?.[id] ?? {}
  const setGear = (id: GymEquipmentId, patch: { unit?: Unit; minKg?: number; maxKg?: number; stepKg?: number }) =>
    setDraft({ ...draft, gear: { ...draft.gear, [id]: { ...draft.gear?.[id], ...patch } } })
  const count = availableAt(draft).length
  const loadable = GYM_EQUIPMENT.filter((item) => has.has(item.id) && item.step)
  const otherGear = loadable.filter((item) => !item.hasMax)
  const selected = otherGear.find((item) => item.id === selectedGear) ?? otherGear[0]
  const controls = (item: GymEquipmentDef) => {
    const { id, label } = item
    const config = gear(id)
    const unit = config.unit ?? draft.unit
    return (
      <div key={id} className="space-y-3">
        <SegmentedControl label={label + ' unit'} value={unit} onChange={(unit) => setGear(id, { unit })}
          options={[{ value: 'kg' as Unit, label: 'kg' }, { value: 'lb' as Unit, label: 'lb' }]} />
        <div className="grid gap-3 sm:grid-cols-2">
          {(item.hasMax || ['barbell', 'ez-bar', 'trap-bar'].includes(id)) && (
            <LoadField label={item.hasMax ? (id === 'dumbbells' ? 'Lightest single dumbbell' : 'Lightest single kettlebell') : 'Empty bar weight'}
              name={`Lightest ${label.toLowerCase()} in ${unit}`} unit={unit} kg={config.minKg} maxKg={config.maxKg ?? 999.99}
              placeholder="Not set" onChange={(minKg) => setGear(id, { minKg })} />
          )}
          {item.hasMax ? (
            <LoadField label={id === 'dumbbells' ? 'Heaviest single dumbbell' : 'Heaviest single kettlebell'}
              name={`Heaviest ${label.toLowerCase()} in ${unit}`} unit={unit} kg={config.maxKg} minKg={config.minKg} maxKg={999.99}
              placeholder="Not set" onChange={(maxKg) => setGear(id, { maxKg })} />
          ) : null}
          <LoadField label="Smallest weight increase" name={`${label} weight increment in ${unit}`}
            unit={unit} kg={config.stepKg} maxKg={50} placeholder={`Usual ${item.step?.[unit]} ${unit}`}
            onChange={(stepKg) => setGear(id, { stepKg })} />
        </div>
      </div>
    )
  }

  return (
    <form className="space-y-5" onSubmit={(event) => {
      event.preventDefault()
      onSave({ ...draft, name: draft.name.trim() || 'Gym' })
    }}>
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
        <p className="mt-1 text-caption text-ink3">Equipment can use a different unit or weight increment below.</p>
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

      {loadable.filter((item) => item.hasMax).map((item) => (
        <fieldset key={item.id} className="rounded-card border border-line p-4">
          <legend className="px-1 text-body font-semibold">{item.label}</legend>
          {controls(item)}
        </fieldset>
      ))}
      {selected ? (
        <details className="rounded-card border border-line p-4">
          <summary className="min-h-11 cursor-pointer content-center text-body font-semibold">Other equipment weights</summary>
          <label className="mb-3 mt-2 block text-footnote text-ink2">
            Equipment
            <select value={selected.id} onChange={(e) => setSelectedGear(e.target.value as GymEquipmentId)}
              className="mt-1 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body text-ink">
              {otherGear.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {controls(selected)}
        </details>
      ) : null}

      <p className="text-footnote text-ink2">{count} exercises can be programmed here.</p>
      <div className="grid gap-2">
        <Button type="submit" size="lg" full>
          Save
        </Button>
        {canDelete ? (
          <Button variant="ghost" full onClick={onDelete} className="text-danger-text">
            Delete this location
          </Button>
        ) : null}
      </div>
    </form>
  )
}

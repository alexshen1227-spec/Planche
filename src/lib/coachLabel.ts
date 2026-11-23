/**
 * The coach's label for a session, said the same way on every screen. Home's
 * coach card and Progress → Coach insights both print `buildPlan`'s strategy,
 * but each for the skill it is showing and as of when it last re-planned —
 * "High volume" on one beside "Today: Technique" on the other, with nothing to
 * say they described different skills or moments. The label names the skill
 * whenever there is more than one, and both screens re-plan on the same clock.
 */
export function coachTodayLabel(strategyName: string, skillName: string | null): string {
  return skillName ? `${skillName} today: ${strategyName}` : `Today: ${strategyName}`
}

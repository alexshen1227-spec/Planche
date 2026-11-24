const aliases: Record<string, string> = {
  db: 'dumbbell', dumbbells: 'dumbbell', kb: 'kettlebell', kettlebells: 'kettlebell', bb: 'barbell', barbells: 'barbell',
  rdl: 'romanian deadlift', rdls: 'romanian deadlift', ohp: 'overhead press',
  hspu: 'handstand push up', hspus: 'handstand push up', pppu: 'pseudo planche push up',
  pushup: 'push up', pushups: 'push up', pullup: 'pull up', pullups: 'pull up', chinup: 'chin up', chinups: 'chin up', ups: 'up',
  rows: 'row', curls: 'curl', presses: 'press', squats: 'squat', raises: 'raise', lunges: 'lunge', deadlifts: 'deadlift', holds: 'hold',
}

export function exerciseWords(text: string): string[] {
  const plain = text.toLowerCase().replace(/\b(?:ninety|90)[\s-]*(?:degrees?\b|°)?/g, '90 ')
  return (plain.match(/[a-z0-9]+/g) ?? []).flatMap((word) => Object.hasOwn(aliases, word) ? aliases[word].split(' ') : [word])
}

export function matchesExercise(words: readonly string[], terms: readonly string[]): boolean {
  return terms.every((term) => words.some((word) => word.startsWith(term)))
}

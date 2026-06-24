export const GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-green-600',
  'from-red-500 to-orange-500',
  'from-sky-500 to-indigo-500',
  'from-yellow-500 to-orange-500',
  'from-teal-500 to-emerald-600',
] as const;

export function getGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

const TAILWIND_COLORS: Record<string, string> = {
  'violet-500': '#8B5CF6',
  'purple-600': '#7C3AED',
  'blue-500': '#3B82F6',
  'cyan-500': '#06B6D4',
  'emerald-500': '#10B981',
  'teal-600': '#0D9488',
  'orange-500': '#F97316',
  'amber-600': '#D97706',
  'pink-500': '#EC4899',
  'rose-600': '#E11D48',
  'indigo-500': '#6366F1',
  'blue-600': '#2563EB',
  'fuchsia-500': '#D946EF',
  'pink-600': '#DB2777',
  'lime-500': '#84CC16',
  'green-600': '#16A34A',
  'red-500': '#EF4444',
  'sky-500': '#0EA5E9',
  'yellow-500': '#EAB308',
  'teal-500': '#14B8A6',
  'emerald-600': '#059669',
  'purple-500': '#A855F7',
  'green-500': '#22C55E',
};

export function getGradientHex(id: string): { from: string; to: string } {
  const gradient = getGradient(id);
  const [fromClass, toClass] = gradient.split(' ');
  return {
    from: TAILWIND_COLORS[fromClass.replace('from-', '')] ?? '#8B5CF6',
    to: TAILWIND_COLORS[toClass.replace('to-', '')] ?? '#7C3AED',
  };
}

export const TOPIC_COLORS = [
  'bg-red-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-cyan-500',
] as const;

export function getTopicColor(name: string) {
  return TOPIC_COLORS[name.length % TOPIC_COLORS.length];
}

export function getTopicColorHex(name: string): string {
  const className = getTopicColor(name);
  const colorKey = className.replace('bg-', '');
  return TAILWIND_COLORS[colorKey] ?? '#EF4444';
}

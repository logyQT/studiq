const HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple',
  'fuchsia', 'pink', 'rose',
] as const;

const SHADES = [400, 500, 600, 700] as const;

function generateGradients(): string[] {
  const gradients: string[] = [];
  for (const hue of HUES) {
    for (let i = 0; i < SHADES.length; i++) {
      for (let j = i + 1; j < SHADES.length; j++) {
        gradients.push(`from-${hue}-${SHADES[i]} to-${hue}-${SHADES[j]}`);
      }
    }
  }
  for (let i = 0; i < HUES.length; i++) {
    const next = (i + 1) % HUES.length;
    for (const shade of SHADES) {
      for (const nextShade of SHADES) {
        gradients.push(`from-${HUES[i]}-${shade} to-${HUES[next]}-${nextShade}`);
      }
    }
  }
  return gradients;
}

export const GRADIENTS = generateGradients();

export const PANEL_GRADIENTS: Record<string, string> = {
  decks: 'from-emerald-400 to-teal-600',
  topics: 'from-violet-400 to-purple-600',
  study: 'from-blue-400 to-indigo-600',
  stats: 'from-amber-400 to-orange-600',
};

export const DIALOG_GRADIENT = 'from-sky-400 to-indigo-500';
export const DIALOG_GRADIENT_HEX = { from: '#38BDF8', to: '#6366F1' };

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function getGradient(id: string) {
  const hash = fnv1a(id);
  return GRADIENTS[hash % GRADIENTS.length];
}

const TAILWIND_COLORS: Record<string, string> = {
  'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626', 'red-700': '#b91c1c',
  'orange-400': '#fb923c', 'orange-500': '#f97316', 'orange-600': '#ea580c', 'orange-700': '#c2410c',
  'amber-400': '#fbbf24', 'amber-500': '#f59e0b', 'amber-600': '#d97706', 'amber-700': '#b45309',
  'yellow-400': '#facc15', 'yellow-500': '#eab308', 'yellow-600': '#ca8a04', 'yellow-700': '#a16207',
  'lime-400': '#a3e635', 'lime-500': '#84cc16', 'lime-600': '#65a30d', 'lime-700': '#4d7c0f',
  'green-400': '#4ade80', 'green-500': '#22c55e', 'green-600': '#16a34a', 'green-700': '#15803d',
  'emerald-400': '#34d399', 'emerald-500': '#10b981', 'emerald-600': '#059669', 'emerald-700': '#047857',
  'teal-400': '#2dd4bf', 'teal-500': '#14b8a6', 'teal-600': '#0d9488', 'teal-700': '#0f766e',
  'cyan-400': '#22d3ee', 'cyan-500': '#06b6d4', 'cyan-600': '#0891b2', 'cyan-700': '#0e7490',
  'sky-400': '#38bdf8', 'sky-500': '#0ea5e9', 'sky-600': '#0284c7', 'sky-700': '#0369a1',
  'blue-400': '#60a5fa', 'blue-500': '#3b82f6', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8',
  'indigo-400': '#818cf8', 'indigo-500': '#6366f1', 'indigo-600': '#4f46e5', 'indigo-700': '#4338ca',
  'violet-400': '#a78bfa', 'violet-500': '#8b5cf6', 'violet-600': '#7c3aed', 'violet-700': '#6d28d9',
  'purple-400': '#c084fc', 'purple-500': '#a855f7', 'purple-600': '#9333ea', 'purple-700': '#7e22ce',
  'fuchsia-400': '#e879f9', 'fuchsia-500': '#d946ef', 'fuchsia-600': '#c026d3', 'fuchsia-700': '#a21caf',
  'pink-400': '#f472b6', 'pink-500': '#ec4899', 'pink-600': '#db2777', 'pink-700': '#be185d',
  'rose-400': '#fb7185', 'rose-500': '#f43f5e', 'rose-600': '#e11d48', 'rose-700': '#be123c',
};

export function getGradientHex(id: string): { from: string; to: string } {
  const gradient = getGradient(id);
  const [fromClass, toClass] = gradient.split(' ');
  return {
    from: TAILWIND_COLORS[fromClass.replace('from-', '')] ?? '#8B5CF6',
    to: TAILWIND_COLORS[toClass.replace('to-', '')] ?? '#7C3AED',
  };
}

export function getTopicColor(name: string) {
  const gradient = getGradient(name);
  const fromClass = gradient.split(' ')[0];
  return fromClass.replace('from-', 'bg-');
}

export function getTopicColorHex(name: string): string {
  const colorClass = getTopicColor(name);
  const colorKey = colorClass.replace('bg-', '');
  return TAILWIND_COLORS[colorKey] ?? '#EF4444';
}

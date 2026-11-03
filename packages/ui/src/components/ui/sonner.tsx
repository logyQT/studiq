'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { cssVars } from '../../utils';

type ToasterTheme = NonNullable<ToasterProps['theme']>;

function isToasterTheme(value: unknown): value is ToasterTheme {
  return value === 'light' || value === 'dark' || value === 'system';
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={isToasterTheme(theme) ? theme : 'system'}
      className="toaster group"
      style={cssVars({
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
      })}
      {...props}
    />
  );
};

export { Toaster };

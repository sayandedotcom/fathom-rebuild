'use client';

import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// A tooltip around a single control. Disabled buttons get no pointer events, so
// pass `wrap` for any control that can be disabled: the tooltip then hangs off a
// wrapping span (which also takes `className`, e.g. layout like ml-auto).
export function Hint({
  label,
  children,
  wrap = false,
  className,
}: {
  label: ReactNode;
  children: ReactElement;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      {wrap ? (
        <TooltipTrigger render={<span className={className ?? 'inline-flex'} />}>{children}</TooltipTrigger>
      ) : (
        <TooltipTrigger render={children} />
      )}
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

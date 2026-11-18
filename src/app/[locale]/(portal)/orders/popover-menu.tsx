'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const GAP_PX = 8;
const EDGE_PX = 8;
const MIN_HEIGHT_PX = 160;
// A search box first, then the chosen option, then anything that can take focus.
const FOCUS_ORDER = ['input[type=search]', '.fp-opt.on', '.fp-opt', '.menu-item', 'button, a'];

type Position = { top: number; left: number; maxHeight: number };

// A menu under (or above, when there is no room) its anchor button, like the mockup's menuAt.
// It is placed on <body> so scrolling rows of pills and the bulk bar never clip it.
export function PopoverMenu({
  anchor,
  onClose,
  align = 'start',
  label,
  children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  align?: 'start' | 'end';
  label: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  // Follows the anchor when the page or a row of pills scrolls, or the phone keyboard resizes the view.
  const place = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = anchor.getBoundingClientRect();
    const isRtl = document.documentElement.dir === 'rtl';
    const alignRightEdge = (align === 'end') !== isRtl;
    const wantedLeft = alignRightEdge ? rect.right - menu.offsetWidth : rect.left;
    const left = Math.max(EDGE_PX, Math.min(wantedLeft, window.innerWidth - menu.offsetWidth - EDGE_PX));
    const fitsBelow = rect.bottom + menu.offsetHeight + GAP_PX * 2 <= window.innerHeight;
    const top = fitsBelow || rect.top < menu.offsetHeight ? rect.bottom + GAP_PX : rect.top - menu.offsetHeight - GAP_PX;
    // On a short phone screen the menu scrolls inside itself rather than running off the screen.
    const maxHeight = Math.max(MIN_HEIGHT_PX, window.innerHeight - Math.max(top, EDGE_PX) - EDGE_PX);
    setPosition({ top: Math.max(top, EDGE_PX), left, maxHeight });
  }, [anchor, align]);

  useLayoutEffect(place, [place]);

  const isPlaced = position !== null;
  // Focus moves into the menu once it is in place, so keyboard users land on the current choice.
  useEffect(() => {
    if (!isPlaced) return;
    const menu = menuRef.current;
    if (!menu) return;
    const target = FOCUS_ORDER.map((selector) => menu.querySelector<HTMLElement>(selector)).find(Boolean);
    target?.focus();
  }, [isPlaced]);

  useEffect(() => {
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && (menuRef.current?.contains(target) || anchor.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      anchor.focus();
    };
    const onScroll = (event: Event) => {
      if (!isInside(event.target)) place();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, onClose, place]);

  return createPortal(
    <div
      ref={menuRef}
      className="menu"
      role="dialog"
      aria-label={label}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        maxHeight: position?.maxHeight,
        overflowY: 'auto',
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

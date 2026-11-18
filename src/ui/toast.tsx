'use client';

import { useEffect, useState } from 'react';
import { Icon } from './icon';

const TOAST_VISIBLE_MS = 3500;

// A short confirmation at the bottom of the screen, e.g. "Saved".
export function Toast({ message }: { message: string | null }) {
  const [visible, setVisible] = useState(Boolean(message));

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), TOAST_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message || !visible) return null;
  return (
    <div className="toast" role="status">
      <span className="tick">
        <Icon name="check" size={14} strokeWidth={2.6} />
      </span>
      {message}
    </div>
  );
}

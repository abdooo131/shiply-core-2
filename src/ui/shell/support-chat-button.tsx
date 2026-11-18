'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useState } from 'react';
import { NewTicketDialog } from '@/app/[locale]/(portal)/support/new-ticket-dialog';
import { usePathname, useRouter } from '@/i18n/navigation';

// Other buttons (Support's "New ticket") open this one dialog, so it outlives page changes
// and its "Ticket sent" toast stays visible after moving to the new ticket.
export const OPEN_NEW_TICKET_EVENT = 'shiply:open-new-ticket';
const CHAT_ICON_PATH = 'M4 5h16v11H9l-5 4z';

export function openNewTicketDialog(): void {
  window.dispatchEvent(new Event(OPEN_NEW_TICKET_EVENT));
}

function ChatButtonWithDialog() {
  const t = useTranslations('support');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [openSignal, setOpenSignal] = useState(0);
  const asksForNewTicket = searchParams.get('new') === '1';

  useEffect(() => {
    const openDialog = () => setOpenSignal((signal) => signal + 1);
    window.addEventListener(OPEN_NEW_TICKET_EVENT, openDialog);
    return () => window.removeEventListener(OPEN_NEW_TICKET_EVENT, openDialog);
  }, []);

  // The help card's "Chat with us" goes to /support?new=1; open once, then drop the flag
  // so a refresh does not open it again.
  useEffect(() => {
    if (!asksForNewTicket) return;
    setOpenSignal((signal) => signal + 1);
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete('new');
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [asksForNewTicket, pathname, router, searchParams]);

  return (
    <NewTicketDialog
      openSignal={openSignal}
      renderTrigger={(open) => (
        <button type="button" className="chat-fab" onClick={open} aria-label={t('chatButton')} title={t('chatButton')} data-testid="support-chat-button">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={CHAT_ICON_PATH} />
          </svg>
        </button>
      )}
    />
  );
}

// The round chat button in the corner of every portal page; it opens "New support ticket".
export function SupportChatButton() {
  return (
    <Suspense fallback={null}>
      <ChatButtonWithDialog />
    </Suspense>
  );
}

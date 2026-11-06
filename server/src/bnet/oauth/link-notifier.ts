import type { LinkOutcome, TransferNotice } from './link-outcome';

/**
 * Discord side of the callback, implemented in the discord module so bnet never talks to Discord
 * itself (docs/02 « Flux » step 6, « Erreurs » interaction expirée, step 5 admin notice).
 */
export interface BnetLinkNotifier {
  /** Edits the /lier battlenet ephemeral reply; a DM to the member when the interaction expired. */
  deliver(to: LinkRecipient, outcome: LinkOutcome): Promise<DeliveryResult>;
  /** Tells the admins about a transfer, in each of these logs channels. Never throws. */
  notifyTransfer(logsChannelIds: readonly string[], notice: TransferNotice): Promise<void>;
}

export interface LinkRecipient {
  userId: string;
  interactionToken: string;
  /** False once the 15 minutes of the interaction token are known to be over. */
  interactionValid: boolean;
}

export type DeliveryResult = 'edited' | 'direct_message' | 'undelivered';

export const BNET_LINK_NOTIFIER = Symbol('BNET_LINK_NOTIFIER');

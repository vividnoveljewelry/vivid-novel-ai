/** Explicit integration boundaries. No implementation may claim delivery or verified
 * business events until provider authentication, signatures and idempotency exist. */
export interface OutboundChannel {
 deliver(input: {conversationId:string; approvedMessageId:string}): Promise<{externalMessageId:string; deliveredAt:string}>;
}
export interface VerifiedCommerceEvent {
 provider:'shopify'; eventId:string; orderId:string; verifiedAt:string;
 kind:'deposit_received'; amount:number; currency:string;
}
export const integrationStatus = {
 instagram: 'not_integrated', shopify: 'not_integrated', workshop:'not_integrated', courier:'not_integrated',
 outbound: 'approved records remain unsent; interactive Emily responses are sent_simulated',
} as const;
// Intentionally no public event-to-stage adapter: a claimed source/evidence ID alone
// is not proof. Future adapters must verify signatures and persist provider evidence.

export { defaultCommentDeps } from "./commentHandlerDependencies";
export { normalizeTicketText, reconcileTicketCandidate, type CompensationIdentityVerificationResult, verifyCompensationIdentity } from "./ticketRemoteIdentity";
export type { OperationHandlerContext, OperationHandlerDeps, OperationHandler, EffectResolution } from "./operationHandlerTypes";
export { TicketCreateHandler } from "./ticketCreateHandler";
export { TicketUpdateHandler } from "./ticketUpdateHandler";
export type { PreparedTicketCreate, PreparedTicketUpdate } from "./ticketHandlerTypes";
export type { PreparedCommentData } from "./commentHandlerTypes";
export { CommentCreateHandler } from "./commentCreateHandler";
export { CommentUpdateHandler } from "./commentUpdateHandler";

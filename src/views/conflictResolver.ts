export {
    applyRemoteContent,
    forceSaveLocal,
    handleConflict,
    mergeTicketContent,
    type ConflictResolverDeps,
} from "./ticketConflictResolution";
export {
    applyRemoteCommentContent,
    forceCommentSaveLocal,
    handleCommentConflict,
    mergeCommentContent,
} from "./commentConflictResolution";
export {
    openCommentDiffEditor,
    openDiffEditor,
    showCommentConflictDialog,
    showConflictDialog,
    type ConflictResolution,
} from "./conflictResolutionUi";

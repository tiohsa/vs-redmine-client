export interface TicketPresentationPort {
  refresh(): void;
  notifyChange(): void;
  updateTicketSubject(ticketId: number, subject: string): void;
  setSelectedProjectId(projectId: number): Promise<void>;
}

export interface CommentPresentationPort {
  refresh(): void;
  refreshForTicket(ticketId: number): void;
}

export interface UnsyncedPresentationPort {
  refresh(): void;
}

export interface SettingsPresentationPort {
  refresh(): void;
}

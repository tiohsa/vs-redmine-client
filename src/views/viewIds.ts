export const VIEW_ID_EXPLORER_PROJECTS = "redmine-clientProjects";
export const VIEW_ID_EXPLORER_TICKETS = "redmine-clientTickets";
export const VIEW_ID_EXPLORER_COMMENTS = "redmine-clientComments";

export const VIEW_ID_ACTIVITY_CONTAINER = "redmine-clientActivity";
export const VIEW_ID_ACTIVITY_TICKET_SETTINGS = "redmine-clientActivityTicketSettings";
export const VIEW_ID_ACTIVITY_PROJECTS = "redmine-clientActivityProjects";
export const VIEW_ID_ACTIVITY_TICKETS = "redmine-clientActivityTickets";
export const VIEW_ID_ACTIVITY_COMMENTS = "redmine-clientActivityComments";

export const ACTIVITY_VIEW_PAIRS = [
  {
    explorerId: VIEW_ID_EXPLORER_PROJECTS,
    activityId: VIEW_ID_ACTIVITY_PROJECTS,
  },
  {
    explorerId: VIEW_ID_EXPLORER_TICKETS,
    activityId: VIEW_ID_ACTIVITY_TICKETS,
  },
  {
    explorerId: VIEW_ID_EXPLORER_COMMENTS,
    activityId: VIEW_ID_ACTIVITY_COMMENTS,
  },
];

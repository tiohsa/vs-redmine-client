import { Project, Ticket } from "../../redmine/types";

export const buildProjectFixture = (overrides: Partial<Project> = {}): Project => ({
  id: 1,
  name: "Alpha",
  identifier: "alpha",
  ...overrides,
});

export const buildTicketFixture = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: 100,
  subject: "Sample ticket",
  projectId: 1,
  ...overrides,
});

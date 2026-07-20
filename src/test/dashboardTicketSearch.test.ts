import * as assert from "assert";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DashboardTicketService } from "../dashboard/services/DashboardTicketService";
import type { IssuesListInput, IssuesListResult } from "../redmine/issues";
import type { Ticket } from "../redmine/types";
import type { DashboardServiceContext } from "../dashboard/services/DashboardServiceContext";
import { DEFAULT_TICKET_LIST_SETTINGS } from "../views/projectListSettings";

const makeTicket = (id: number, subject: string): Ticket => ({
  id,
  subject,
  projectId: 1,
  projectName: "Project",
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeContext = (store: DashboardStateStore): DashboardServiceContext => ({
  store,
  notifyOperationStarted: () => undefined,
  notifySuccess: () => undefined,
  notifyError: () => undefined,
  notifyToast: () => undefined,
  onTicketsRefreshed: () => undefined,
});

suite("DashboardTicketService all-project search", () => {
  test("未選択時の全プロジェクト検索で件名検索とID検索をマージする", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;
    const inputs: IssuesListInput[] = [];
    const subjectTicket = makeTicket(20, "login 123 bug");
    const idTicket = makeTicket(123, "Direct ID match");

    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => undefined,
      getTickets: () => tickets,
      setTickets: (next) => {
        tickets = next;
      },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => {
        totalCount = next;
      },
      getSettings: () => DEFAULT_TICKET_LIST_SETTINGS,
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: async (input): Promise<IssuesListResult> => {
        inputs.push(input);
        return { tickets: [subjectTicket], totalCount: 1, limit: input.limit, offset: input.offset };
      },
      getIssueDetail: async () => ({ ticket: idTicket, comments: [] }),
    });

    await service.searchAllProjects("123");

    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(inputs[0].projectId, undefined);
    assert.strictEqual(inputs[0].subjectQuery, "123");
    assert.deepStrictEqual(tickets.map((ticket) => ticket.id), [123, 20]);
    assert.strictEqual(totalCount, 2);
    assert.strictEqual(store.getState().loading.tickets, false);
  });

  test("空検索は未選択状態のまま結果をクリアする", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [makeTicket(1, "old")];
    let totalCount = 1;
    let called = false;

    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => undefined,
      getTickets: () => tickets,
      setTickets: (next) => {
        tickets = next;
      },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => {
        totalCount = next;
      },
      getSettings: () => DEFAULT_TICKET_LIST_SETTINGS,
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: async (input): Promise<IssuesListResult> => {
        called = true;
        return { tickets: [], totalCount: 0, limit: input.limit, offset: input.offset };
      },
    });

    await service.searchAllProjects("  ");

    assert.strictEqual(called, false);
    assert.deepStrictEqual(tickets, []);
    assert.strictEqual(totalCount, 0);
    assert.strictEqual(store.getState().selectedProject, undefined);
  });

  test("古いプロジェクトのレスポンスが最新プロジェクトを上書きしない", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;
    let projectId = 1;
    const projectA = deferred<IssuesListResult>();
    const projectB = deferred<IssuesListResult>();
    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => ({ id: projectId, name: `Project ${projectId}` }),
      getTickets: () => tickets,
      setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => { totalCount = next; },
      getSettings: () => DEFAULT_TICKET_LIST_SETTINGS,
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: (input) => input.projectId === 1 ? projectA.promise : projectB.promise,
    });

    const loadA = service.loadTickets();
    projectId = 2;
    const loadB = service.loadTickets();
    projectB.resolve({ tickets: [makeTicket(2, "B")], totalCount: 1, limit: 50, offset: 0 });
    await loadB;
    projectA.resolve({ tickets: [makeTicket(1, "A")], totalCount: 1, limit: 50, offset: 0 });
    await loadA;

    assert.deepStrictEqual(tickets.map((ticket) => ticket.id), [2]);
    assert.deepStrictEqual(store.getState().tickets.map((ticket) => ticket.id), [2]);
    assert.strictEqual(store.getState().loading.tickets, false);
    assert.strictEqual(store.getState().errors.tickets, undefined);
  });

  test("古い全プロジェクト検索のレスポンスが最新検索を上書きしない", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;
    const oldSearch = deferred<IssuesListResult>();
    const newSearch = deferred<IssuesListResult>();
    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => undefined,
      getTickets: () => tickets,
      setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => { totalCount = next; },
      getSettings: () => DEFAULT_TICKET_LIST_SETTINGS,
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: (input) => input.subjectQuery === "old" ? oldSearch.promise : newSearch.promise,
    });

    const first = service.searchAllProjects("old");
    const second = service.searchAllProjects("new");
    newSearch.resolve({ tickets: [makeTicket(2, "new")], totalCount: 1, limit: 50, offset: 0 });
    await second;
    oldSearch.resolve({ tickets: [makeTicket(1, "old")], totalCount: 1, limit: 50, offset: 0 });
    await first;

    assert.deepStrictEqual(tickets.map((ticket) => ticket.id), [2]);
    assert.deepStrictEqual(store.getState().tickets.map((ticket) => ticket.id), [2]);
    assert.strictEqual(store.getState().loading.tickets, false);
  });
});

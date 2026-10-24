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
        return { tickets: input.issueIds ? [idTicket] : [subjectTicket], totalCount: 1, limit: input.limit, offset: input.offset };
      },
    });

    await service.searchAllProjects("123");

    assert.strictEqual(inputs.length, 3);
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

  test("後続の件名検索ページに直接IDが現れたら件数が収束し、再試行成功でエラーを消す", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;
    const inputs: IssuesListInput[] = [];
    const idTicket = makeTicket(123, "123 match");
    const nextPage = deferred<IssuesListResult>();
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
      listIssues: async (input) => {
        if (input.issueIds) { return { tickets: [idTicket], totalCount: 1, limit: 50, offset: 0 }; }
        if (input.descriptionQuery) { return { tickets: [], totalCount: 0, limit: 50, offset: 0 }; }
        inputs.push(input);
        if (inputs.length === 1) {
          return { tickets: [makeTicket(20, "123 subject")], totalCount: 3, limit: 50, offset: 0 };
        }
        if (inputs.length === 2) { throw new Error("temporary"); }
        return nextPage.promise;
      },
    });

    await service.searchAllProjects("123");
    assert.strictEqual(totalCount, 2);
    await service.loadMoreTickets();
    assert.match(store.getState().errors.moreTickets ?? "", /temporary/);
    const retry = service.loadMoreTickets();
    assert.strictEqual(service.loadMoreTickets(), retry);
    nextPage.resolve({ tickets: [idTicket, makeTicket(30, "123 last")], totalCount: 3, limit: 50, offset: 1 });
    await retry;

    assert.deepStrictEqual(inputs.map((input) => input.offset), [0, 1, 1]);
    assert.deepStrictEqual(tickets.map((ticket) => ticket.id), [123, 20, 30]);
    assert.strictEqual(tickets.length, totalCount);
    assert.strictEqual(store.getState().loadedTicketCount, store.getState().totalTicketCount);
    assert.strictEqual(store.getState().errors.tickets, undefined);
    await service.loadMoreTickets();
    assert.strictEqual(inputs.length, 3, "全件取得後は追加のHTTP要求を行わない");
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
      listIssues: (input) => (input.subjectQuery ?? input.descriptionQuery) === "old" ? oldSearch.promise : newSearch.promise,
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

  test("追加読み込みの連打は同一ページを1回だけ取得して1回だけ追加する", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [makeTicket(1, "first")];
    let totalCount = 2;
    const nextPage = deferred<IssuesListResult>();
    const inputs: IssuesListInput[] = [];
    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => ({ id: 1, name: "Project" }),
      getTickets: () => tickets,
      setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => { totalCount = next; },
      getSettings: () => DEFAULT_TICKET_LIST_SETTINGS,
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: (input) => {
        inputs.push(input);
        return nextPage.promise;
      },
    });

    const first = service.loadMoreTickets();
    const second = service.loadMoreTickets();
    assert.strictEqual(first, second);
    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(inputs[0].offset, 1);

    nextPage.resolve({ tickets: [makeTicket(2, "second")], totalCount: 2, limit: 50, offset: 1 });
    await Promise.all([first, second]);

    assert.deepStrictEqual(tickets.map((ticket) => ticket.id), [1, 2]);
  });

  test("追加読み込み失敗後は同じページを再試行できる", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [makeTicket(1, "first")];
    let totalCount = 2;
    let calls = 0;
    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => ({ id: 1, name: "Project" }),
      getTickets: () => tickets,
      setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => { totalCount = next; },
      getSettings: () => DEFAULT_TICKET_LIST_SETTINGS,
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: async (input) => {
        calls++;
        if (calls === 1) {
          throw new Error("temporary");
        }
        return { tickets: [makeTicket(2, "second")], totalCount: 2, limit: 50, offset: input.offset };
      },
    });

    await service.loadMoreTickets();
    assert.match(store.getState().errors.moreTickets ?? "", /temporary/);
    await service.loadMoreTickets();

    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(tickets.map((ticket) => ticket.id), [1, 2]);
    assert.strictEqual(store.getState().errors.tickets, undefined);
  });

  test("接続世代の変更後に返った旧ページは反映しない", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [makeTicket(1, "old")];
    let totalCount = 2;
    const oldPage = deferred<IssuesListResult>();
    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => ({ id: 1, name: "Project" }),
      getTickets: () => tickets,
      setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => { totalCount = next; },
      getSettings: () => DEFAULT_TICKET_LIST_SETTINGS,
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: () => oldPage.promise,
    });

    const load = service.loadMoreTickets();
    service.invalidate();
    tickets = [];
    totalCount = 0;
    oldPage.resolve({ tickets: [makeTicket(2, "stale")], totalCount: 2, limit: 50, offset: 1 });
    await load;

    assert.deepStrictEqual(tickets, []);
    assert.strictEqual(totalCount, 0);
  });
  test("プロジェクト一覧は重複排除後もAPI取得位置を進める", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;
    const offsets: number[] = [];
    const service = new DashboardTicketService({
      context: makeContext(store), getResolvedProject: () => ({ id: 1, name: "Project" }),
      getTickets: () => tickets, setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount, setTotalCount: (next) => { totalCount = next; },
      getSettings: () => DEFAULT_TICKET_LIST_SETTINGS, loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: async (input) => {
        offsets.push(input.offset);
        const ids = input.offset === 0 ? [1, 2] : input.offset === 2 ? [2, 3] : [4];
        return { tickets: ids.map((id) => makeTicket(id, String(id))), totalCount: 5, offset: input.offset, limit: 2 };
      },
    });
    await service.loadTickets();
    assert.strictEqual(store.getState().hasMoreTickets, true);
    await service.loadMoreTickets();
    await service.loadMoreTickets();
    await service.loadMoreTickets();
    assert.strictEqual(store.getState().hasMoreTickets, false);
    assert.strictEqual(store.getState().loadedTicketCount, 4);
    assert.strictEqual(store.getState().totalTicketCount, 5);
    assert.deepStrictEqual(offsets, [0, 2, 4]);
    assert.deepStrictEqual(tickets.map((ticket) => ticket.id), [1, 2, 3, 4]);
  });

  test("プロジェクト一覧の件数変化を検出したら先頭から再取得する", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;
    const offsets: number[] = [];
    const service = new DashboardTicketService({
      context: makeContext(store), getResolvedProject: () => ({ id: 1, name: "Project" }),
      getTickets: () => tickets, setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount, setTotalCount: (next) => { totalCount = next; },
      getSettings: () => DEFAULT_TICKET_LIST_SETTINGS, loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: async (input) => {
        offsets.push(input.offset);
        return { tickets: [makeTicket(offsets.length === 1 ? 1 : 2, "Ticket")], totalCount: offsets.length === 1 ? 3 : 2, offset: input.offset, limit: 1 };
      },
    });
    await service.loadTickets();
    await service.loadMoreTickets();
    assert.deepStrictEqual(offsets, [0, 1, 0]);
    assert.deepStrictEqual(tickets.map((ticket) => ticket.id), [2]);
  });

});

const searchFixture = (listIssues: (input: IssuesListInput) => Promise<IssuesListResult>) => {
  const store = new DashboardStateStore();
  let tickets: Ticket[] = [];
  let total = 0;
  let project: { id: number; name: string } | undefined;
  const service = new DashboardTicketService({
    context: makeContext(store), getResolvedProject: () => project,
    getTickets: () => tickets, setTickets: value => { tickets = value; },
    getTotalCount: () => total, setTotalCount: value => { total = value; },
    getSettings: () => DEFAULT_TICKET_LIST_SETTINGS,
    loadComments: async () => undefined, refreshUnsynced: () => undefined, listIssues,
  });
  return { service, store, setProject: (id?: number) => { project = id === undefined ? undefined : { id, name: `Project ${id}` }; } };
};
const page = (tickets: Ticket[], totalCount = tickets.length, offset = 0): IssuesListResult => ({ tickets, totalCount, offset, limit: 50 });

suite("Dashboard 共通検索", () => {
  test("本文だけの一致を含め、件名・本文・親子の結果を各1回表示する", async () => {
    const fixture = searchFixture(async input => input.subjectQuery
      ? page([makeTicket(1, "検索"), makeTicket(2, "検索")])
      : page([{ ...makeTicket(3, "本文だけ"), description: "検索", parentId: 1 }, makeTicket(2, "検索")]));
    await fixture.service.searchTickets("検索");
    const state = fixture.store.getState();
    assert.deepStrictEqual(state.tickets.map(ticket => ticket.id), [1, 2, 3]);
    assert.ok(state.tickets.every(ticket => ticket.level === 0 && ticket.children.length === 0));
    assert.strictEqual(state.loadedTicketCount, 3);
    assert.strictEqual(state.hasMoreTickets, false);
  });

  test("件名と本文は独立したoffsetで読み込み、ページ間でも重複しない", async () => {
    const inputs: IssuesListInput[] = [];
    const fixture = searchFixture(async input => {
      inputs.push(input);
      if (input.subjectQuery) { return input.offset === 0 ? page([makeTicket(1, "A")], 2) : page([makeTicket(2, "B")], 2, 1); }
      return input.offset === 0 ? page([makeTicket(1, "A"), makeTicket(3, "C")], 3) : page([makeTicket(2, "B")], 3, 2);
    });
    await fixture.service.searchTickets("a");
    assert.strictEqual(fixture.store.getState().hasMoreTickets, true);
    await fixture.service.loadMoreTickets();
    assert.deepStrictEqual(inputs.map(input => input.offset), [0, 0, 1, 2]);
    assert.deepStrictEqual(fixture.store.getState().tickets.map(ticket => ticket.id), [1, 2, 3]);
    assert.strictEqual(fixture.store.getState().hasMoreTickets, false);
  });

  test("#付き番号は範囲付きの番号検索だけを行い、通常番号は文章検索も統合する", async () => {
    const inputs: IssuesListInput[] = [];
    const fixture = searchFixture(async input => {
      inputs.push(input);
      return input.issueIds ? page([makeTicket(123, "直接一致")]) : page([makeTicket(1, "123")]);
    });
    fixture.setProject(1);
    await fixture.service.searchTickets(" #123 ", { kind: "project", projectId: 1 });
    assert.strictEqual(inputs.length, 1);
    assert.deepStrictEqual(inputs[0].issueIds, [123]);
    assert.strictEqual(inputs[0].projectId, 1);
    assert.deepStrictEqual(fixture.store.getState().tickets.map(ticket => ticket.id), [123]);
    await fixture.service.searchTickets("123");
    assert.strictEqual(inputs.length, 4);
    assert.deepStrictEqual(fixture.store.getState().tickets.map(ticket => ticket.id), [123, 1]);
  });

  test("検索範囲外の番号・閲覧できない番号は0件として扱う", async () => {
    const fixture = searchFixture(async input => {
      assert.strictEqual(input.projectId, 2);
      assert.deepStrictEqual(input.issueIds, [123]);
      return page([]);
    });
    fixture.setProject(2);
    await fixture.service.searchTickets("#123");
    assert.deepStrictEqual(fixture.store.getState().tickets, []);
    assert.strictEqual(fixture.store.getState().errors.tickets, undefined);
  });

  test("更新・プロジェクト切替でも検索文字列を保持し、空検索は通常一覧へ戻る", async () => {
    const inputs: IssuesListInput[] = [];
    const fixture = searchFixture(async input => { inputs.push(input); return page([makeTicket(1, "result")]); });
    await fixture.service.searchTickets("文章");
    fixture.setProject(2);
    fixture.service.invalidate(false);
    await fixture.service.loadTickets();
    await fixture.service.loadTickets();
    assert.ok(inputs.slice(2).every(input => input.projectId === 2 && (input.subjectQuery ?? input.descriptionQuery) === "文章"));
    await fixture.service.searchTickets("");
    assert.strictEqual(inputs.at(-1)?.projectId, 2);
    assert.strictEqual(inputs.at(-1)?.subjectQuery, undefined);
    assert.strictEqual(fixture.store.getState().ticketSearch?.query, "");
    fixture.setProject();
    await fixture.service.searchTickets(" ");
    assert.deepStrictEqual(fixture.store.getState().tickets, []);
  });

  test("一方の検索の失敗を0件扱いせず、両方のoffsetを維持して再試行する", async () => {
    let fail = true;
    const inputs: IssuesListInput[] = [];
    const fixture = searchFixture(async input => {
      inputs.push(input);
      if (input.offset === 0) { return page([makeTicket(1, "A")], 2); }
      if (input.descriptionQuery && fail) { throw new Error("本文検索失敗"); }
      return page([makeTicket(2, "B")], 2, 1);
    });
    await fixture.service.searchTickets("a");
    await fixture.service.loadMoreTickets();
    assert.match(fixture.store.getState().errors.moreTickets ?? "", /本文検索失敗/);
    assert.strictEqual(fixture.store.getState().loadedTicketCount, 1);
    fail = false;
    await fixture.service.loadMoreTickets();
    assert.deepStrictEqual(inputs.map(input => input.offset), [0, 0, 1, 1, 1, 1]);
    assert.strictEqual(fixture.store.getState().loadedTicketCount, 2);
    assert.strictEqual(fixture.store.getState().errors.tickets, undefined);
  });

  test("古い範囲の要求と接続切替前の検索応答を反映しない", async () => {
    const response = deferred<IssuesListResult>();
    let calls = 0;
    const fixture = searchFixture(async () => { calls++; return response.promise; });
    fixture.setProject(2);
    await fixture.service.searchTickets("stale", { kind: "project", projectId: 1 });
    assert.strictEqual(calls, 0);
    const pending = fixture.service.searchTickets("old");
    fixture.service.invalidate();
    fixture.setProject();
    await fixture.service.loadTickets();
    response.resolve(page([makeTicket(1, "old")]));
    await pending;
    assert.deepStrictEqual(fixture.store.getState().tickets, []);
    assert.strictEqual(fixture.store.getState().ticketSearch?.query, "");
  });
});

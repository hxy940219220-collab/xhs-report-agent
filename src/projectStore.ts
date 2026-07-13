import type { ProjectGroup, ProjectRecord, ProjectSummary } from "./types";

const DB_NAME = "report-note-agent";
const STORE_NAME = "projects";
const SUMMARY_STORE_NAME = "project-summaries";
const GROUP_STORE_NAME = "project-groups";
const DB_VERSION = 4;
export const DEFAULT_GROUP_ID = "default";

function summaryFromProject(project: ProjectRecord): ProjectSummary {
  return {
    id: project.id,
    name: project.name || project.report.name,
    kind: project.report.kind,
    size: project.report.size,
    pageCount: project.report.pageCount,
    groupId: project.groupId ?? DEFAULT_GROUP_ID,
    step: project.step,
    status: project.status,
    updatedAt: project.updatedAt,
  };
}

function compactProject(project: ProjectRecord): ProjectRecord {
  const report = project.report;
  if (report.kind !== "pdf") return project;
  return {
    ...project,
    report: {
      ...report,
      pages: report.pages.map((page) => ({ ...page, imageUrl: "" })),
      assets: report.assets.filter(
        (asset) => asset.source !== "page" || asset.selected,
      ),
      assetStatus: report.sourceData ? "pending" : report.assetStatus,
      assetProgress: report.sourceData ? 0 : report.assetProgress,
    },
  };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction!;
      const projectStore = database.objectStoreNames.contains(STORE_NAME)
        ? transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "id" });
      const summaryStore = database.objectStoreNames.contains(SUMMARY_STORE_NAME)
        ? transaction.objectStore(SUMMARY_STORE_NAME)
        : database.createObjectStore(SUMMARY_STORE_NAME, { keyPath: "id" });
      const groupStore = database.objectStoreNames.contains(GROUP_STORE_NAME)
        ? transaction.objectStore(GROUP_STORE_NAME)
        : database.createObjectStore(GROUP_STORE_NAME, { keyPath: "id" });
      const defaultGroupRequest = groupStore.get(DEFAULT_GROUP_ID);
      defaultGroupRequest.onsuccess = () => {
        if (!defaultGroupRequest.result) {
          groupStore.put({
            id: DEFAULT_GROUP_ID,
            name: "默认项目组",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } satisfies ProjectGroup);
        }
      };
      projectStore.delete("sample-project");
      summaryStore.delete("sample-project");
      if ((event as IDBVersionChangeEvent).oldVersion < 2) {
        const cursorRequest = projectStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          summaryStore.put(summaryFromProject(cursor.value as ProjectRecord));
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveProject(project: ProjectRecord) {
  const database = await openDatabase();
  const storedProject = compactProject(project);
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [STORE_NAME, SUMMARY_STORE_NAME],
      "readwrite",
    );
    transaction.objectStore(STORE_NAME).put(storedProject);
    transaction
      .objectStore(SUMMARY_STORE_NAME)
      .put(summaryFromProject(storedProject));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function getProject(id: string) {
  const database = await openDatabase();
  const project = await new Promise<ProjectRecord | undefined>((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .get(id);
    request.onsuccess = () => resolve(request.result as ProjectRecord | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return project;
}

export async function renameProject(id: string, name: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, SUMMARY_STORE_NAME], "readwrite");
    const projectStore = transaction.objectStore(STORE_NAME);
    const request = projectStore.get(id);
    request.onsuccess = () => {
      const project = request.result as ProjectRecord | undefined;
      if (!project) return;
      const renamed = { ...project, name, updatedAt: Date.now() };
      projectStore.put(renamed);
      transaction.objectStore(SUMMARY_STORE_NAME).put(summaryFromProject(renamed));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function listProjects() {
  const database = await openDatabase();
  const projects = await new Promise<ProjectSummary[]>((resolve, reject) => {
    const request = database
      .transaction(SUMMARY_STORE_NAME, "readonly")
      .objectStore(SUMMARY_STORE_NAME)
      .getAll();
    request.onsuccess = () => resolve(request.result as ProjectSummary[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listProjectGroups() {
  const database = await openDatabase();
  const groups = await new Promise<ProjectGroup[]>((resolve, reject) => {
    const request = database.transaction(GROUP_STORE_NAME, "readonly").objectStore(GROUP_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as ProjectGroup[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return groups.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveProjectGroup(group: ProjectGroup) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(GROUP_STORE_NAME, "readwrite");
    transaction.objectStore(GROUP_STORE_NAME).put(group);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function deleteProject(id: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, SUMMARY_STORE_NAME], "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.objectStore(SUMMARY_STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function deleteProjectGroup(id: string) {
  if (id === DEFAULT_GROUP_ID) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, SUMMARY_STORE_NAME, GROUP_STORE_NAME], "readwrite");
    const projectStore = transaction.objectStore(STORE_NAME);
    const summaryStore = transaction.objectStore(SUMMARY_STORE_NAME);
    const cursorRequest = summaryStore.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const summary = cursor.value as ProjectSummary;
      if ((summary.groupId ?? DEFAULT_GROUP_ID) === id) {
        projectStore.delete(summary.id);
        cursor.delete();
      }
      cursor.continue();
    };
    transaction.objectStore(GROUP_STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

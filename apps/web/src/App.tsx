/**
 * Copyright 2026 Casual Office
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { IWorkbookData, ICommandInfo, IExecutionOptions } from '@univerjs/core';
import { ICommandService } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { xlsxToWorkbookData } from './xlsx';
import { odsToWorkbookData, csvToWorkbookData, tsvToWorkbookData, psvToWorkbookData } from './ods';
import { isDesktop } from './desk-bridge-bootstrap';
import { TitleBar } from './shell/TitleBar';
import { Toolbar } from './shell/Toolbar';
import { FormulaBar } from './shell/FormulaBar';
import { SheetTabs } from './shell/SheetTabs';
import { StatusBar } from './shell/StatusBar';
import { TablesPanel } from './shell/TablesPanel';
import { UniverSheet } from './UniverSheet';
import { emptyWorkbook } from './snapshot';
import { UniverRoot } from './UniverRoot';
import { useWorkbookGrowth } from './hooks/useWorkbookGrowth';
import { useFileDrop } from './hooks/useFileDrop';
import {
  WorkbookContext,
  type PreviewState,
  type WorkbookCtxValue,
  type WorkbookFormat,
  type WorkbookMeta,
} from './workbook-context';
import { UIContext, type UICtxValue } from './ui-context';
import { OutlineProvider } from './outline/outline-context';
import { OutlinePanel } from './shell/OutlinePanel';
import { CollabDriver } from './collab/CollabDriver';
import { CreateRoomDialog } from './shell/CreateRoomDialog';
import { DocumentTabBar, type DocumentTabInfo } from './shell/DocumentTabBar';
import { DeskAuthDialog } from './desk-auth';
import { openSpreadsheetFile } from './shell/file-actions';
import type { Template } from './home/registry';
import { LoadingOverlay } from './shell/LoadingOverlay';
import { LoadingContext, type LoadingCtxValue, type LoadingState } from './loading-context';
import { BusyProvider } from './busy-context';
import { ToastProvider } from './shell/toast/toast-context';
import { SaveStatusProvider, useSaveStatus } from './shell/save-status-context';
import { ActivityProvider } from './shell/activity-context';
import { ToastContainer } from './shell/toast/ToastContainer';
import { ChartsProvider } from './charts/charts-context';
import { ChartLayer } from './charts/ChartLayer';
import { ChartsPanel } from './shell/ChartsPanel';
import { PivotFieldsPanel } from './pivots/PivotFieldsPanel';
import { WatchPanel } from './shell/WatchPanel';
import { WatchProvider } from './shell/watch-context';
import { CommentsPanel } from './shell/CommentsPanel';
import { VersionHistoryPanel } from './shell/VersionHistoryPanel';
import { AiPanel } from './shell/AiPanel';
import { PanelRail } from './shell/PanelRail';
import { PanelMutex } from './shell/PanelMutex';
import { PreviewBanner } from './shell/PreviewBanner';
import { PreviewDriver } from './shell/PreviewDriver';
import { ThemeBridge } from './shell/ThemeBridge';
import { HomeScreen } from './home/HomeScreen';
import { ShowFormulasLayer } from './shell/ShowFormulasLayer';
import { PivotsProvider } from './pivots/pivots-context';
import { SparklinesProvider } from './sparklines/sparklines-context';
import { SparklineLayer } from './sparklines/SparklineLayer';
import { TracePrecedentsLayer } from './shell/TracePrecedentsLayer';
import { useAutosave } from './autosave/useAutosave';
import { AutosaveRestoreBanner } from './autosave/AutosaveRestoreBanner';
import { useDesktopRecoveryWriter } from './recovery/desktop-recovery';
import { DesktopRecoveryBanner } from './recovery/DesktopRecoveryBanner';
import { FileSourceProvider, useFileSource } from './file-source';
import { AuthProvider, PersonalAuthGate } from './auth';
import { DeskAuthProvider, DeskAuthGate } from './desk-auth';
import { useAuth } from './auth/auth-context';
import { useVersionHistoryCapture } from './version-history/useVersionHistoryCapture';
import { useTouchPan } from './touch/useTouchPan';
import { MobileActionBar } from './shell/MobileActionBar';
import { navigate, useRoute } from './router';
import { useUniverAPI } from './use-univer';

export interface SheetTab {
  id: string;
  name: string;
  filePath: string | null;
  format: WorkbookFormat | null;
  snapshot: IWorkbookData;
  isDirty: boolean;
  revision: number;
  serverFileId?: string | null;
  serverEtag?: string | null;
}

function inferFormat(filename: string): WorkbookFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.ods')) return 'ods';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.tsv') || lower.endsWith('.tab')) return 'tsv';
  if (lower.endsWith('.psv')) return 'psv';
  return 'xlsx';
}

function UniverApiSync({ onApi }: { onApi: (api: FUniver | null) => void }): ReactNode {
  const api = useUniverAPI();
  useEffect(() => {
    onApi(api);
  }, [api, onApi]);
  return null;
}

export function App() {
  const route = useRoute();
  const showHomeList = route.kind === 'home' || route.kind === 'templates';

  const initial = useMemo(() => emptyWorkbook(), []);
  const initialFilePath = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return (
      (window as unknown as { __INITIAL_FILE_PATH__?: string }).__INITIAL_FILE_PATH__ ??
      new URLSearchParams(window.location.search).get('file') ??
      (isDesktop() ? window.__deskApp__?.filePath : null) ??
      null
    );
  }, []);

  const [view, setView] = useState<'home' | 'editor'>(() => {
    if (typeof window === 'undefined') return 'home';
    if (initialFilePath) return 'editor';
    if (isDesktop()) return 'home';
    if (route.kind === 'home' || route.kind === 'templates') return 'home';
    return 'editor';
  });

  const snapshotRef = useRef<IWorkbookData | null>(initial);
  const [meta, setMeta] = useState<WorkbookMeta>(() => ({
    id: initial.id ?? `wb-${Date.now()}`,
    name: initial.name ?? 'Untitled',
    sourceFormat: null,
    revision: 0,
    serverFileId: null,
    serverEtag: null,
  }));

  const [tabs, setTabs] = useState<SheetTab[]>(() => {
    if (initialFilePath) {
      const fileName = initialFilePath.split(/[\\/]/).pop() || 'Workbook.xlsx';
      const name = fileName.replace(/\.(xlsx|xlsm|ods|csv|tsv|tab|psv)$/i, '');
      const snap = emptyWorkbook();
      snap.name = name;
      return [
        {
          id: 'tab-1',
          name,
          filePath: initialFilePath,
          format: inferFormat(fileName),
          snapshot: snap,
          isDirty: false,
          revision: 0,
          serverFileId: null,
          serverEtag: null,
        },
      ];
    }
    return [
      {
        id: 'tab-1',
        name: initial.name ?? 'Untitled',
        filePath: null,
        format: null,
        snapshot: initial,
        isDirty: false,
        revision: 0,
        serverFileId: null,
        serverEtag: null,
      },
    ];
  });
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const univerApiRef = useRef<FUniver | null>(null);

  // Sync window/document title with active tab / Home
  useEffect(() => {
    const isHome = view === 'home' || showHomeList;
    const APP_NAME = 'Casual Sheets';
    const title = isHome
      ? APP_NAME
      : `${meta.name || 'Untitled'} — ${APP_NAME}`;
    document.title = title;
    const bridge = typeof window !== 'undefined' ? window.__deskApp__ : undefined;
    bridge?.setWindowTitle?.(title);
  }, [view, showHomeList, meta.name]);
  const [formulaBarVisible, setFormulaBarVisible] = useState(true);
  const [ribbonCompact, setRibbonCompact] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cs-ribbon') === 'compact';
    } catch {
      return false;
    }
  });
  const [tablesPanelVisible, setTablesPanelVisible] = useState(false);
  const [outlinePanelVisible, setOutlinePanelVisible] = useState(false);
  const [chartsPanelVisible, setChartsPanelVisible] = useState(false);
  const [pivotPanelVisible, setPivotPanelVisible] = useState(false);
  const [watchPanelVisible, setWatchPanelVisible] = useState(false);
  const [commentsPanelVisible, setCommentsPanelVisible] = useState(false);
  const [historyPanelVisible, setHistoryPanelVisible] = useState(false);
  const [aiPanelVisible, setAiPanelVisible] = useState(false);
  const [shareRoomOpen, setShareRoomOpen] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);
  const [loading, setLoading] = useState<LoadingState | null>(null);

  // Version-history preview state. `preview` is the visible shape;
  // `previewSavedRef` keeps the pre-preview workbook off React state
  // so a multi-MB snapshot isn't duplicated when we already have one
  // copy in Univer.
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const previewSavedRef = useRef<{
    data: IWorkbookData;
    sourceFormat: WorkbookFormat | null;
  } | null>(null);

  const enterPreview = useCallback(
    (
      versionId: number,
      versionName: string,
      versionSavedAt: number,
      snapshotData: IWorkbookData,
      snapshotSourceFormat: WorkbookFormat | null,
      currentLiveData: IWorkbookData,
      currentLiveFormat: WorkbookFormat | null,
    ) => {
      previewSavedRef.current = { data: currentLiveData, sourceFormat: currentLiveFormat };
      setPreview({ versionId, versionName, versionSavedAt });
      // Stash both refs before the swap kicks off the React revision
      // bump — the snapshot ref-clear timer must see the new data, not
      // the saved one. `replaceWorkbook` itself sets snapshotRef.
      snapshotRef.current = snapshotData;
      setMeta((prev) => ({
        id: snapshotData.id ?? prev.id,
        name: snapshotData.name ?? prev.name,
        sourceFormat: snapshotSourceFormat,
        revision: prev.revision + 1,
      }));
      // Drop the stash after consumers handle the revision bump.
      setTimeout(() => {
        setTimeout(() => {
          if (snapshotRef.current === snapshotData) snapshotRef.current = null;
        }, 0);
      }, 0);
    },
    [],
  );

  const exitPreview = useCallback(() => {
    const saved = previewSavedRef.current;
    previewSavedRef.current = null;
    setPreview(null);
    if (!saved) return;
    snapshotRef.current = saved.data;
    setMeta((prev) => ({
      id: saved.data.id ?? prev.id,
      name: saved.data.name ?? prev.name,
      sourceFormat: saved.sourceFormat,
      revision: prev.revision + 1,
    }));
    setTimeout(() => {
      setTimeout(() => {
        if (snapshotRef.current === saved.data) snapshotRef.current = null;
      }, 0);
    }, 0);
  }, []);

  const commitPreview = useCallback(() => {
    // The snapshot is already the live workbook (loaded in
    // enterPreview). All we do is drop the saved-state ref and clear
    // the preview flag so editing re-enables and the banner hides.
    previewSavedRef.current = null;
    setPreview(null);
  }, []);

  const replaceWorkbook = useCallback(
    (
      next: IWorkbookData,
      format?: WorkbookFormat | null,
      server?: { fileId: string | null; etag: string | null } | null,
    ) => {
      snapshotRef.current = next;
      setMeta((prev) => ({
        id: next.id ?? prev.id,
        name: next.name ?? prev.name,
        sourceFormat: format !== undefined ? format : prev.sourceFormat,
        revision: prev.revision + 1,
        // Default to null when the caller didn't supply server info
        // — the new workbook is a fresh load (template / drop / FSA
        // open) without a tracked server identity. Subsequent Save
        // falls into the "new" path.
        serverFileId: server?.fileId ?? null,
        serverEtag: server?.etag ?? null,
        // Reset the user-edit gate. The new workbook starts from a
        // clean slate; first content mutation flips this back true via
        // the EditTracker driver. UX_AUDIT.md §5.
        hasUserEdited: false,
      }));
      // Inside Casual Office (desktop, single-user, no memory pressure),
      // skip the auto-clear. React 18 concurrent rendering can defer
      // UniverSheet's swap effect past the 2-macrotask setTimeout chain,
      // leaving the swap to find an empty ref — visible as a permanently
      // blank canvas with "swap aborted: snapshotRef is empty" in console.
      // The web build keeps the original aggressive GC behavior.
      if (isDesktop()) {
        return;
      }
      // Free the ref after consumers have processed the revision
      // bump. We wait two macrotasks: the first lets React flush its
      // render + useEffect pass (UniverSheet's swap, OutlineProvider's
      // rehydrate); the second is paranoia for any deferred work
      // scheduled inside those effects.
      setTimeout(() => {
        setTimeout(() => {
          if (snapshotRef.current === next) snapshotRef.current = null;
        }, 0);
      }, 0);
    },
    [],
  );

  const getLiveSnapshot = useCallback((): IWorkbookData | null => {
    const api = univerApiRef.current;
    if (!api) return null;
    try {
      const wb = api.getActiveWorkbook();
      if (!wb) return null;
      return (wb.save() as unknown) as IWorkbookData;
    } catch (err) {
      console.warn('[tabs] failed to capture live snapshot', err);
      return null;
    }
  }, []);

  const handleSelectTab = useCallback(
    (nextTabId: string) => {
      if (nextTabId === activeTabId && view === 'editor') return;

      if (view === 'editor' && activeTabId) {
        const live = getLiveSnapshot();
        if (live) {
          setTabs((prev) =>
            prev.map((t) => (t.id === activeTabId ? { ...t, snapshot: live } : t)),
          );
        }
      }

      const target = tabs.find((t) => t.id === nextTabId);
      if (!target) return;

      setActiveTabId(nextTabId);
      setView('editor');
      replaceWorkbook(target.snapshot, target.format, {
        fileId: target.serverFileId ?? null,
        etag: target.serverEtag ?? null,
      });
    },
    [activeTabId, view, tabs, getLiveSnapshot, replaceWorkbook],
  );

  const handleHomeTab = useCallback(() => {
    if (view === 'editor' && activeTabId) {
      const live = getLiveSnapshot();
      if (live) {
        setTabs((prev) =>
          prev.map((t) => (t.id === activeTabId ? { ...t, snapshot: live } : t)),
        );
      }
    }
    setView('home');
  }, [view, activeTabId, getLiveSnapshot]);

  const handleNewTab = useCallback(() => {
    if (view === 'editor' && activeTabIdRef.current) {
      const live = getLiveSnapshot();
      if (live) {
        setTabs((prev) =>
          prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, snapshot: live } : t)),
        );
      }
    }
    const newId = 'tab-' + Date.now();
    const newSnap = emptyWorkbook();
    const name = `Workbook ${tabs.length + 1}`;
    newSnap.name = name;
    const newTab: SheetTab = {
      id: newId,
      name,
      filePath: null,
      format: null,
      snapshot: newSnap,
      isDirty: false,
      revision: 0,
      serverFileId: null,
      serverEtag: null,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
    setView('editor');
    replaceWorkbook(newSnap, null);
  }, [view, getLiveSnapshot, tabs.length, replaceWorkbook]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tabToClose = tabs.find((t) => t.id === tabId);
      if (tabToClose?.isDirty) {
        const confirmClose = window.confirm(
          `Bảng tính "${tabToClose.name}" có thay đổi chưa lưu. Bạn có chắc muốn đóng không?`,
        );
        if (!confirmClose) return;
      }

      const nextTabs = tabs.filter((t) => t.id !== tabId);
      setTabs(nextTabs);

      if (nextTabs.length === 0) {
        setActiveTabId('');
        setView('home');
        return;
      }

      if (activeTabId === tabId) {
        const closedIndex = tabs.findIndex((t) => t.id === tabId);
        const newActive = nextTabs[Math.max(0, closedIndex - 1)] || nextTabs[0];
        setActiveTabId(newActive.id);
        replaceWorkbook(newActive.snapshot, newActive.format, {
          fileId: newActive.serverFileId ?? null,
          etag: newActive.serverEtag ?? null,
        });
      }
    },
    [tabs, activeTabId, replaceWorkbook],
  );

  const openFilePath = useCallback(
    async (filePath: string) => {
      const existing = tabs.find(
        (t) => t.filePath && t.filePath.toLowerCase() === filePath.toLowerCase(),
      );
      if (existing) {
        handleSelectTab(existing.id);
        return;
      }

      const bridge = typeof window !== 'undefined' ? window.__deskApp__ : undefined;
      if (!bridge?.isDesktop || !bridge.loadDocument) return;

      const fileName = filePath.split(/[\\/]/).pop() || 'Workbook.xlsx';
      const format = inferFormat(fileName);
      const startedAt = Date.now();
      try {
        setLoading({ fileName, phase: 'reading', startedAt });
        const buffer = await bridge.loadDocument(filePath);
        setLoading({ fileName, phase: 'parsing', startedAt });
        let data: IWorkbookData;
        if (format === 'ods') data = await odsToWorkbookData(buffer);
        else if (format === 'csv') data = await csvToWorkbookData(buffer);
        else if (format === 'tsv') data = await tsvToWorkbookData(buffer);
        else if (format === 'psv') data = await psvToWorkbookData(buffer);
        else data = await xlsxToWorkbookData(buffer);
        data.name = fileName.replace(/\.(xlsx|xlsm|ods|csv|tsv|tab|psv)$/i, '');

        if (view === 'editor' && activeTabIdRef.current) {
          const live = getLiveSnapshot();
          if (live) {
            setTabs((prev) =>
              prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, snapshot: live } : t)),
            );
          }
        }

        const isSinglePristine =
          tabs.length === 1 &&
          tabs[0].filePath === null &&
          !tabs[0].isDirty &&
          (tabs[0].name === 'Untitled' || tabs[0].name.startsWith('Workbook')) &&
          tabs[0].revision <= 1;

        const targetId = isSinglePristine ? tabs[0].id : 'tab-' + Date.now();
        const newTab: SheetTab = {
          id: targetId,
          name: data.name,
          filePath,
          format,
          snapshot: data,
          isDirty: false,
          revision: 1,
          serverFileId: null,
          serverEtag: null,
        };

        setTabs((prev) => {
          if (isSinglePristine) return [newTab];
          return [...prev, newTab];
        });
        setActiveTabId(targetId);
        setView('editor');
        replaceWorkbook(data, format);
        setLoading(null);
      } catch (err) {
        console.error('[openFilePath] failed', err);
        setLoading({ fileName, phase: 'reading', startedAt, error: String(err) });
      }
    },
    [tabs, view, getLiveSnapshot, handleSelectTab, replaceWorkbook, setLoading],
  );

  const handleOpenFileObject = useCallback(
    async (file: File) => {
      if (view === 'editor' && activeTabIdRef.current) {
        const live = getLiveSnapshot();
        if (live) {
          setTabs((prev) =>
            prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, snapshot: live } : t)),
          );
        }
      }

      setLoading({ fileName: file.name, sizeBytes: file.size, phase: 'reading' });
      try {
        const data = await openSpreadsheetFile(file, (phase) => setLoading({ phase }));
        const format = inferFormat(file.name);
        const isSinglePristine =
          tabs.length === 1 &&
          tabs[0].filePath === null &&
          !tabs[0].isDirty &&
          (tabs[0].name === 'Untitled' || tabs[0].name.startsWith('Workbook')) &&
          tabs[0].revision <= 1;

        const targetId = isSinglePristine ? tabs[0].id : 'tab-' + Date.now();
        const newTab: SheetTab = {
          id: targetId,
          name: data.name || file.name.replace(/\.(xlsx|xlsm|ods|csv|tsv|tab|psv)$/i, ''),
          filePath: null,
          format,
          snapshot: data,
          isDirty: false,
          revision: 1,
          serverFileId: null,
          serverEtag: null,
        };

        setTabs((prev) => {
          if (isSinglePristine) return [newTab];
          return [...prev, newTab];
        });
        setActiveTabId(targetId);
        setView('editor');
        replaceWorkbook(data, format);
        setLoading(null);
      } catch (err) {
        console.error('[handleOpenFileObject] failed', err);
        setLoading({
          fileName: file.name,
          phase: 'reading',
          error: err instanceof Error ? err.message : 'Could not open this file.',
        });
      }
    },
    [view, getLiveSnapshot, tabs, replaceWorkbook, setLoading],
  );

  const handleSelectTemplate = useCallback(
    async (t: Template) => {
      if (t.id === 'blank') {
        handleNewTab();
        return;
      }
      if (view === 'editor' && activeTabIdRef.current) {
        const live = getLiveSnapshot();
        if (live) {
          setTabs((prev) =>
            prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, snapshot: live } : t)),
          );
        }
      }

      const url = `${import.meta.env.BASE_URL ?? '/'}templates/${t.id}.xlsx`;
      setLoading({ fileName: `${t.name}.xlsx`, phase: 'reading' });
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Template fetch failed: ${res.status}`);
        const sizeBytes = Number(res.headers.get('content-length') ?? '0') || undefined;
        setLoading({ phase: 'parsing', sizeBytes });
        const buf = await res.arrayBuffer();
        const data = (await xlsxToWorkbookData(buf)) as IWorkbookData;
        data.name = t.name;
        setLoading({ phase: 'mounting' });

        const isSinglePristine =
          tabs.length === 1 &&
          tabs[0].filePath === null &&
          !tabs[0].isDirty &&
          (tabs[0].name === 'Untitled' || tabs[0].name.startsWith('Workbook')) &&
          tabs[0].revision <= 1;

        const targetId = isSinglePristine ? tabs[0].id : 'tab-' + Date.now();
        const newTab: SheetTab = {
          id: targetId,
          name: t.name,
          filePath: null,
          format: 'xlsx',
          snapshot: data,
          isDirty: false,
          revision: 1,
          serverFileId: null,
          serverEtag: null,
        };

        setTabs((prev) => {
          if (isSinglePristine) return [newTab];
          return [...prev, newTab];
        });
        setActiveTabId(targetId);
        setView('editor');
        replaceWorkbook(data, 'xlsx');
        setLoading(null);
      } catch (err) {
        console.error('[home] template open failed', err);
        setLoading({
          fileName: `${t.name}.xlsx`,
          phase: 'reading',
          error: err instanceof Error ? err.message : 'Failed to open template.',
          onRetry: () => void handleSelectTemplate(t),
        });
      }
    },
    [view, getLiveSnapshot, tabs, handleNewTab, replaceWorkbook, setLoading],
  );

  // Desktop shell initial boot load
  useEffect(() => {
    if (!isDesktop()) return;
    const bridge = typeof window !== 'undefined' ? window.__deskApp__ : undefined;
    if (!bridge?.isDesktop || !bridge.filePath) {
      bridge?.dismissBoot?.();
      return;
    }
    let cancelled = false;
    void (async () => {
      const path = bridge.filePath!;
      const fileName = path.split(/[\\/]/).pop() || 'Workbook.xlsx';
      const format = inferFormat(fileName);
      const startedAt = Date.now();
      try {
        setLoading({ fileName, phase: 'reading', startedAt });
        const buffer = await bridge.loadDocument();
        if (cancelled) return;
        setLoading({ fileName, phase: 'parsing', startedAt });
        let data: IWorkbookData;
        if (format === 'ods') data = await odsToWorkbookData(buffer);
        else if (format === 'csv') data = await csvToWorkbookData(buffer);
        else if (format === 'tsv') data = await tsvToWorkbookData(buffer);
        else if (format === 'psv') data = await psvToWorkbookData(buffer);
        else data = await xlsxToWorkbookData(buffer);
        if (cancelled) return;
        data.name = fileName.replace(/\.(xlsx|xlsm|ods|csv|tsv|tab|psv)$/i, '');
        setLoading({ fileName, phase: 'mounting', startedAt });
        setTabs((prev) =>
          prev.map((t) =>
            t.id === 'tab-1' ? { ...t, name: data.name, snapshot: data, format, filePath: path } : t,
          ),
        );
        setView('editor');
        replaceWorkbook(data, format);
        setLoading(null);
        try {
          window.__deskApp__?.dismissBoot?.();
        } catch {
          /* best-effort */
        }
      } catch (err) {
        console.error('deskApp load failed', err);
        if (!cancelled) {
          setLoading({ fileName, phase: 'reading', startedAt, error: String(err) });
        }
        try {
          window.__deskApp__?.dismissBoot?.();
        } catch {
          /* best-effort */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts: Ctrl+W (close tab), Ctrl+N / Ctrl+T (new tab)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const metaKey = e.ctrlKey || e.metaKey;
      if (!metaKey || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'w') {
        e.preventDefault();
        if (activeTabIdRef.current) {
          handleCloseTab(activeTabIdRef.current);
        }
      } else if (k === 'n' || k === 't') {
        e.preventDefault();
        handleNewTab();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCloseTab, handleNewTab]);

  // Open file events from desktop Tauri / bridge
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string; filePath?: string }>).detail;
      const path = detail?.path || detail?.filePath;
      if (path) {
        void openFilePath(path);
      }
    };
    window.addEventListener('csheet:open-file', onOpen);
    window.addEventListener('deskapp:open-file', onOpen);
    return () => {
      window.removeEventListener('csheet:open-file', onOpen);
      window.removeEventListener('deskapp:open-file', onOpen);
    };
  }, [openFilePath]);

  // Sync dirty status with desktop window close-guard
  useEffect(() => {
    const hasDirtyTab = tabs.some((t) => t.isDirty);
    const bridge = typeof window !== 'undefined' ? window.__deskApp__ : undefined;
    bridge?.setDirty?.(hasDirtyTab);
  }, [tabs]);

  // Sync bridge filePath and window layout resize
  const activeTab = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId) || tabs[0];
  }, [tabs, activeTabId]);

  useEffect(() => {
    if (!activeTab) return;
    const bridge = typeof window !== 'undefined' ? window.__deskApp__ : undefined;
    if (bridge?.isDesktop) {
      bridge.filePath = activeTab.filePath;
    }
  }, [activeTab]);

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, [activeTabId, view]);

  // Reload when the open file is modified by another process
  useEffect(() => {
    if (!isDesktop()) return;
    const onFileChanged = (e: Event) => {
      const { kind, path } = (e as CustomEvent<{ kind: string; path: string }>).detail ?? {};
      if (kind !== 'modified') return;
      const bridge = typeof window !== 'undefined' ? window.__deskApp__ : undefined;
      if (!bridge?.isDesktop) return;
      const targetTab = tabs.find((t) => t.filePath && t.filePath === path);
      if (!targetTab) return;
      void (async () => {
        const loadAndReplace = async () => {
          const buffer = await bridge.loadDocument(path);
          const lower = path.toLowerCase();
          let data: IWorkbookData;
          if (lower.endsWith('.ods')) data = await odsToWorkbookData(buffer);
          else if (lower.endsWith('.csv')) data = await csvToWorkbookData(buffer);
          else if (lower.endsWith('.tsv') || lower.endsWith('.tab'))
            data = await tsvToWorkbookData(buffer);
          else if (lower.endsWith('.psv')) data = await psvToWorkbookData(buffer);
          else data = await xlsxToWorkbookData(buffer);
          const fileName = path.split(/[\\/]/).pop() || 'Workbook.xlsx';
          data.name = fileName.replace(/\.(xlsx|xlsm|ods|csv|tsv|tab)$/i, '');
          setTabs((prev) =>
            prev.map((t) => (t.id === targetTab.id ? { ...t, snapshot: data, isDirty: false } : t)),
          );
          if (targetTab.id === activeTabIdRef.current) {
            replaceWorkbook(data);
          }
        };
        try {
          await loadAndReplace();
        } catch (err) {
          console.warn('[deskApp] file-changed reload failed, retrying once', err);
          await new Promise((r) => setTimeout(r, 350));
          try {
            await loadAndReplace();
          } catch (err2) {
            console.error('[deskApp] file-changed reload failed after retry', err2);
          }
        }
      })();
    };
    window.addEventListener('deskapp:file-changed', onFileChanged);
    return () => window.removeEventListener('deskapp:file-changed', onFileChanged);
  }, [tabs, replaceWorkbook]);

  const updateServerEtag = useCallback((etag: string | null) => {
    setMeta((prev) => (prev.serverEtag === etag ? prev : { ...prev, serverEtag: etag }));
  }, []);

  const markUserEdited = useCallback(() => {
    setMeta((prev) => (prev.hasUserEdited ? prev : { ...prev, hasUserEdited: true }));
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, isDirty: true } : t)),
    );
  }, []);

  const markSaved = useCallback(() => {
    setMeta((prev) => (prev.hasUserEdited ? { ...prev, hasUserEdited: false } : prev));
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, isDirty: false } : t)),
    );
  }, []);

  const updateServerFileId = useCallback((fileId: string | null) => {
    setMeta((prev) => (prev.serverFileId === fileId ? prev : { ...prev, serverFileId: fileId }));
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, serverFileId: fileId } : t)),
    );
    if (fileId && typeof window !== 'undefined' && window.location.pathname === '/sheet/new') {
      window.history.replaceState(window.history.state, '', `/sheet/${encodeURIComponent(fileId)}`);
      window.dispatchEvent(new CustomEvent('cd:navigate'));
    }
  }, []);

  const renameWorkbook = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let prevName: string | undefined;
    setMeta((prev) => {
      prevName = prev.name;
      return prev.name === trimmed ? prev : { ...prev, name: trimmed };
    });
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, name: trimmed } : t)),
    );
    const bridge = typeof window !== 'undefined' ? window.__deskApp__ : undefined;
    if (bridge?.isDesktop && bridge.filePath && bridge.rename) {
      void bridge.rename(trimmed).catch((err) => {
        console.error('[deskApp] rename failed', err);
        if (prevName !== undefined) {
          setMeta((prev) => ({ ...prev, name: prevName as string }));
          setTabs((p) =>
            p.map((t) => (t.id === activeTabIdRef.current ? { ...t, name: prevName as string } : t)),
          );
        }
      });
    }
  }, []);

  const tabInfos = useMemo<DocumentTabInfo[]>(
    () =>
      tabs.map((t) => ({
        id: t.id,
        fileName: t.name,
        filePath: t.filePath,
        isDirty: t.isDirty,
        format: t.format,
      })),
    [tabs],
  );

  const wbValue: WorkbookCtxValue = useMemo(
    () => ({
      meta,
      snapshotRef,
      replaceWorkbook,
      renameWorkbook,
      updateServerEtag,
      updateServerFileId,
      markUserEdited,
      markSaved,
      preview,
      enterPreview,
      exitPreview,
      commitPreview,
    }),
    [
      meta,
      replaceWorkbook,
      renameWorkbook,
      updateServerEtag,
      updateServerFileId,
      markUserEdited,
      markSaved,
      preview,
      enterPreview,
      exitPreview,
      commitPreview,
    ],
  );

  const loadingValue: LoadingCtxValue = useMemo(
    () => ({
      state: loading,
      set: (next) => {
        if (next === null) {
          setLoading(null);
          return;
        }
        setLoading((prev) => {
          if (!prev) {
            if (!next.fileName || !next.phase) return prev;
            return {
              fileName: next.fileName,
              phase: next.phase,
              sizeBytes: next.sizeBytes,
              startedAt: Date.now(),
              error: next.error,
              onRetry: next.onRetry,
            };
          }
          return { ...prev, ...next, startedAt: prev.startedAt };
        });
      },
    }),
    [loading],
  );

  const uiValue: UICtxValue = useMemo(
    () => ({
      formulaBarVisible,
      toggleFormulaBar: () => setFormulaBarVisible((v) => !v),
      ribbonCompact,
      toggleRibbonCompact: () =>
        setRibbonCompact((v) => {
          const next = !v;
          try {
            localStorage.setItem('cs-ribbon', next ? 'compact' : 'full');
          } catch {
            /* storage blocked — toggle still applies for the session */
          }
          return next;
        }),
      // Side panels are mutually exclusive — opening one auto-closes
      // the others. Three of them open at once would squeeze the grid
      // into a strip and competing context (which one am I editing?).
      tablesPanelVisible,
      toggleTablesPanel: () =>
        setTablesPanelVisible((v) => {
          const next = !v;
          if (next) {
            setOutlinePanelVisible(false);
            setChartsPanelVisible(false);
            setPivotPanelVisible(false);
            setCommentsPanelVisible(false);
            setHistoryPanelVisible(false);
            setWatchPanelVisible(false);
            setAiPanelVisible(false);
          }
          return next;
        }),
      outlinePanelVisible,
      toggleOutlinePanel: () =>
        setOutlinePanelVisible((v) => {
          const next = !v;
          if (next) {
            setTablesPanelVisible(false);
            setChartsPanelVisible(false);
            setPivotPanelVisible(false);
            setCommentsPanelVisible(false);
            setHistoryPanelVisible(false);
            setWatchPanelVisible(false);
            setAiPanelVisible(false);
          }
          return next;
        }),
      chartsPanelVisible,
      toggleChartsPanel: () =>
        setChartsPanelVisible((v) => {
          const next = !v;
          if (next) {
            setTablesPanelVisible(false);
            setOutlinePanelVisible(false);
            setPivotPanelVisible(false);
            setCommentsPanelVisible(false);
            setHistoryPanelVisible(false);
            setWatchPanelVisible(false);
            setAiPanelVisible(false);
          }
          return next;
        }),
      pivotPanelVisible,
      togglePivotPanel: () =>
        setPivotPanelVisible((v) => {
          const next = !v;
          if (next) {
            setTablesPanelVisible(false);
            setOutlinePanelVisible(false);
            setChartsPanelVisible(false);
            setCommentsPanelVisible(false);
            setHistoryPanelVisible(false);
            setWatchPanelVisible(false);
            setAiPanelVisible(false);
          }
          return next;
        }),
      watchPanelVisible,
      toggleWatchPanel: () =>
        setWatchPanelVisible((v) => {
          const next = !v;
          if (next) {
            setTablesPanelVisible(false);
            setOutlinePanelVisible(false);
            setChartsPanelVisible(false);
            setPivotPanelVisible(false);
            setCommentsPanelVisible(false);
            setHistoryPanelVisible(false);
            setAiPanelVisible(false);
          }
          return next;
        }),
      commentsPanelVisible,
      toggleCommentsPanel: () =>
        setCommentsPanelVisible((v) => {
          const next = !v;
          if (next) {
            setTablesPanelVisible(false);
            setOutlinePanelVisible(false);
            setChartsPanelVisible(false);
            setPivotPanelVisible(false);
            setHistoryPanelVisible(false);
            setWatchPanelVisible(false);
            setAiPanelVisible(false);
          }
          return next;
        }),
      historyPanelVisible,
      toggleHistoryPanel: () =>
        setHistoryPanelVisible((v) => {
          const next = !v;
          if (next) {
            setTablesPanelVisible(false);
            setOutlinePanelVisible(false);
            setChartsPanelVisible(false);
            setPivotPanelVisible(false);
            setCommentsPanelVisible(false);
            setWatchPanelVisible(false);
            setAiPanelVisible(false);
          }
          return next;
        }),
      aiPanelVisible,
      toggleAiPanel: () =>
        setAiPanelVisible((v) => {
          const next = !v;
          if (next) {
            setTablesPanelVisible(false);
            setOutlinePanelVisible(false);
            setChartsPanelVisible(false);
            setPivotPanelVisible(false);
            setCommentsPanelVisible(false);
            setHistoryPanelVisible(false);
            setWatchPanelVisible(false);
          }
          return next;
        }),
      closeAllReactPanels: () => {
        setTablesPanelVisible(false);
        setOutlinePanelVisible(false);
        setChartsPanelVisible(false);
        setPivotPanelVisible(false);
        setWatchPanelVisible(false);
        setCommentsPanelVisible(false);
        setHistoryPanelVisible(false);
        setAiPanelVisible(false);
      },
      showFormulas,
      toggleShowFormulas: () => setShowFormulas((v) => !v),
      openShareRoom: () => setShareRoomOpen(true),
    }),
    [
      formulaBarVisible,
      ribbonCompact,
      tablesPanelVisible,
      outlinePanelVisible,
      chartsPanelVisible,
      pivotPanelVisible,
      watchPanelVisible,
      commentsPanelVisible,
      historyPanelVisible,
      aiPanelVisible,
      showFormulas,
    ],
  );

  return (
    <UniverRoot>
      <UIContext.Provider value={uiValue}>
        <WorkbookContext.Provider value={wbValue}>
          <LoadingContext.Provider value={loadingValue}>
            <DeskAuthProvider>
              <AuthProvider>
              <FileSourceProvider>
                <ToastProvider>
                  <ActivityProvider>
                    <SaveStatusProvider>
                      <BusyProvider>
                        <ChartsProvider>
                          <PivotsProvider>
                            <WatchProvider>
                              <SparklinesProvider>
                                <OutlineProvider>
                                  <GrowthDriver />
                                  <BootDismissDriver />
                                  <FileDropDriver />
                                  <AutosaveDriver />
                                  <DesktopRecoveryDriver />
                                  <TouchPanDriver />
                                  <VersionHistoryDriver />
                                  <PreviewDriver />
                                  <ThemeBridge />
                                  <RouteWorkbookSync replaceWorkbook={replaceWorkbook} />
                                  <EditTracker markUserEdited={markUserEdited} />
                                  <UniverApiSync onApi={(api) => { univerApiRef.current = api; }} />
                                  <DeskAuthGate>
                                    <PersonalAuthGate>
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          height: '100vh',
                                          width: '100vw',
                                          overflow: 'hidden',
                                          background: '#f8fafc',
                                        }}
                                      >
                                        <DocumentTabBar
                                          tabs={tabInfos}
                                          activeTabId={activeTabId}
                                          onSelectTab={handleSelectTab}
                                          onCloseTab={handleCloseTab}
                                          onNewTab={handleNewTab}
                                          showHomeTab={true}
                                          homeTabActive={view === 'home'}
                                          onHomeTab={handleHomeTab}
                                        />
                                        <div
                                          style={{
                                            flex: 1,
                                            display: 'flex',
                                            overflow: 'hidden',
                                            position: 'relative',
                                          }}
                                        >
                                          <div
                                            style={{
                                              flex: 1,
                                              display: view === 'home' || showHomeList ? 'flex' : 'none',
                                              height: '100%',
                                              width: '100%',
                                              overflowY: 'auto',
                                            }}
                                          >
                                            <HomeScreen
                                              forceVisible={true}
                                              onNewDocument={handleNewTab}
                                              onSelectTemplate={handleSelectTemplate}
                                              onOpenFile={handleOpenFileObject}
                                              onOpenAuth={() => setAuthModalOpen(true)}
                                            />
                                          </div>
                                          <div
                                            style={{
                                              flex: 1,
                                              display: view === 'home' || showHomeList ? 'none' : 'flex',
                                              flexDirection: 'column',
                                              height: '100%',
                                              width: '100%',
                                              overflow: 'hidden',
                                            }}
                                          >
                                            <CollabDriver>
                                              <div
                                                className={`app${formulaBarVisible ? '' : ' app--no-formula-bar'}`}
                                                data-ribbon={ribbonCompact ? 'compact' : 'full'}
                                                data-testid="app-shell"
                                              >
                                                <TitleBar />
                                                <Toolbar />
                                                <AutosaveRestoreBanner />
                                                <DesktopRecoveryBanner />
                                                <PreviewBanner />
                                                {formulaBarVisible && <FormulaBar />}
                                                <div className="grid-row">
                                                  <main className="grid-host" data-testid="grid-host">
                                                    <UniverSheet
                                                      revision={meta.revision}
                                                      initialSnapshot={initial}
                                                    />
                                                  </main>
                                                  {tablesPanelVisible && <TablesPanel />}
                                                  {outlinePanelVisible && <OutlinePanel />}
                                                  {chartsPanelVisible && <ChartsPanel />}
                                                  {pivotPanelVisible && <PivotFieldsPanel />}
                                                  {watchPanelVisible && <WatchPanel />}
                                                  {commentsPanelVisible && <CommentsPanel />}
                                                  {historyPanelVisible && <VersionHistoryPanel />}
                                                  {aiPanelVisible && <AiPanel />}
                                                  <PanelRail />
                                                </div>
                                                <MobileActionBar />
                                                <SheetTabs />
                                                <StatusBar />
                                                <PanelMutex />
                                                {shareRoomOpen && (
                                                  <CreateRoomDialog
                                                    onClose={() => setShareRoomOpen(false)}
                                                  />
                                                )}
                                              </div>
                                            </CollabDriver>
                                          </div>
                                        </div>
                                      </div>
                                      <DeskAuthDialog
                                        isOpen={authModalOpen}
                                        onClose={() => setAuthModalOpen(false)}
                                        canClose={true}
                                      />
                                      <LoadingOverlay />
                                      <ChartLayer />
                                      <SparklineLayer />
                                      <ShowFormulasLayer />
                                      <TracePrecedentsLayer />
                                    </PersonalAuthGate>
                                  </DeskAuthGate>
                                </OutlineProvider>
                              </SparklinesProvider>
                            </WatchProvider>
                          </PivotsProvider>
                        </ChartsProvider>
                      </BusyProvider>
                    </SaveStatusProvider>
                  </ActivityProvider>
                  <ToastContainer />
                </ToastProvider>
              </FileSourceProvider>
              </AuthProvider>
            </DeskAuthProvider>
          </LoadingContext.Provider>
        </WorkbookContext.Provider>
      </UIContext.Provider>
    </UniverRoot>
  );
}



/** Effect-only — listens for the first meaningful content mutation on
 *  the workbook and flips `meta.hasUserEdited`. UX_AUDIT.md §5: the
 *  Save handler uses this to skip create-saves of `/sheet/new` drafts
 *  the user opened but never typed in. Mirrors the noisy-mutation
 *  filter from useAutosave so navigation / focus / selection events
 *  don't accidentally promote a clean draft to a server row. */
function EditTracker({ markUserEdited }: { markUserEdited: () => void }): ReactNode {
  const api = useUniverAPI();
  const { markDirty } = useSaveStatus();
  useEffect(() => {
    if (!api) return;
    // Reach the command service via the facade's private `_injector` —
    // same path useAutosave uses (apps/web/src/autosave/useAutosave.ts).
    // The two hooks share this back door so they stay aligned on what
    // "an edit" means; if Univer renames it, both break together and
    // get fixed together.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const injector = (api as any)._injector as { get: (t: unknown) => unknown } | undefined;
    if (!injector) return;
    const cmdSvc = injector.get(ICommandService) as {
      onMutationExecutedForCollab: (
        l: (info: ICommandInfo, options?: IExecutionOptions) => void,
      ) => { dispose: () => void };
    };
    const sub = cmdSvc.onMutationExecutedForCollab((info, options) => {
      if (options?.fromCollab) return; // remote replays don't count
      const id = info?.id ?? '';
      // Same noisy-mutation filter as useAutosave so navigation /
      // selection / sheet-switch don't promote a clean draft.
      if (id.startsWith('sheet.mutation.set-selections')) return;
      if (id === 'sheet.mutation.set-worksheet-active-operation') return;
      markUserEdited();
      // Drop the SaveStatusPill back to idle so a "Saved 5 min ago"
      // pill doesn't keep lying while the user is mid-edit. No-op
      // unless the pill was actually in saved/error state.
      markDirty();
      // Desktop: feed the same edit signal to the native close-guard.
      // This is the sanctioned change hook (CLAUDE.md), so it catches the
      // toolbar / paste / fill / undo edits a DOM-keystroke heuristic
      // missed. Optional-chained + best-effort in the bridge — no-op on web.
      window.__deskApp__?.setDirty?.(true);
    });
    return () => sub.dispose();
  }, [api, markUserEdited, markDirty]);
  return null;
}

/** Effect-only — watches the route and calls `fileSource.openRecent` when
 *  the URL is `/sheet/<id>`. UX_AUDIT.md §5 Phase 1. The default
 *  emptyWorkbook stays in place for `/sheet/new` (the draft route) and
 *  for `/r/<roomId>` (legacy anonymous coedit) where the workbook is
 *  picked up via the collab driver, not the file source. */
function RouteWorkbookSync({
  replaceWorkbook,
}: {
  replaceWorkbook: WorkbookCtxValue['replaceWorkbook'];
}): ReactNode {
  const route = useRoute();
  const fileSource = useFileSource();
  const lastOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (route.kind !== 'sheet' || !route.id) return;
    if (lastOpenedRef.current === route.id) return; // already loaded
    let cancelled = false;
    void (async () => {
      try {
        const opened = await fileSource.openRecent(route.id);
        if (cancelled) return;
        replaceWorkbook(
          opened.data,
          opened.sourceFormat,
          opened.serverFileId
            ? { fileId: opened.serverFileId, etag: opened.serverEtag ?? null }
            : null,
        );
        lastOpenedRef.current = route.id;
      } catch (err) {
        if (cancelled) return;
        // Stale URL / file deleted / share token expired — bounce back
        // to the list. Toast goes here once the toast surface is
        // hookable from outside React's render tree.
        // eslint-disable-next-line no-console
        console.warn('[home] could not open sheet', route.id, err);
        navigate('/home');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.kind, route.id, fileSource, replaceWorkbook]);
  return null;
}

/** Effect-only component — auto-grows the active sheet near edges. */
function GrowthDriver(): ReactNode {
  useWorkbookGrowth();
  return null;
}

/** Effect-only — dismisses the desk-bridge cold-start boot overlay once
 *  Univer has mounted (its Facade API becomes available). Desktop-only;
 *  a no-op on web (no overlay, `dismissBoot` undefined). This is the
 *  reliable "Univer API available + workbook set" signal that covers
 *  BOTH the file-open path and the new-spreadsheet (no filePath) path —
 *  the desktop load effect's own dismiss only fires when a file is bound.
 *  The bootstrap's ~8s safety timer is the final backstop. */
function BootDismissDriver(): ReactNode {
  const api = useUniverAPI();
  useEffect(() => {
    if (!isDesktop() || !api) return;
    try {
      window.__deskApp__?.dismissBoot?.();
    } catch {
      /* best-effort — the bootstrap's safety timer still clears it */
    }
  }, [api]);
  return null;
}

/** Effect-only — drives the IDB autosave loop. No-op in collab rooms. */
function AutosaveDriver(): ReactNode {
  useAutosave();
  return null;
}

/** Effect-only — desktop crash-recovery sidecar writer (no-op on web). */
function DesktopRecoveryDriver(): ReactNode {
  useDesktopRecoveryWriter();
  return null;
}

/** Effect-only — translates touch-drag on the Univer canvas into wheel
 *  events so the grid scrolls on mobile. Univer 0.24 doesn't ship native
 *  touch-pan; drop this once it does. */
function TouchPanDriver(): ReactNode {
  useTouchPan();
  return null;
}

/** Effect-only — drives the version-history snapshot capture loop.
 *  Coarse cadence (~10 min while dirty) so it doesn't fight autosave. */
function VersionHistoryDriver(): ReactNode {
  useVersionHistoryCapture();
  return null;
}

/** Window-level file drag-and-drop. Renders an overlay while a file is over
 * the page; the hook itself handles the actual drop and routes through the
 * shared open flow. */
function FileDropDriver(): ReactNode {
  const dragging = useFileDrop();
  if (!dragging) return null;
  return (
    <div className="file-drop-overlay" data-testid="file-drop-overlay" aria-hidden="true">
      <div className="file-drop-overlay__card">
        <div className="file-drop-overlay__title">Drop to open</div>
        <div className="file-drop-overlay__hint">.xlsx · .ods · .csv · .tsv</div>
      </div>
    </div>
  );
}

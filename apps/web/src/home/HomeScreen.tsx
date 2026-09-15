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

import { useEffect, useMemo, useState } from 'react';
import type { IWorkbookData } from '@univerjs/core';
import { Button } from '@schnsrw/design-system';
import sheetsMark from '@schnsrw/design-system/assets/casual-sheets-mark.svg';
import { Icon } from '../shell/Icon';
import { useWorkbook } from '../use-workbook';
import { useLoading } from '../loading-context';
import { useFileSource, useRecentFiles, type RecentEntry } from '../file-source';
import { xlsxToWorkbookData } from '../xlsx';
import { emptyWorkbook } from '../snapshot';
import { loadSpreadsheetFile, pickXlsxFile } from '../shell/file-actions';
import { CATEGORIES, TEMPLATES, type Template, type TemplateCategory } from './registry';
import { TemplateCard } from './TemplateCard';
import { ReopenBanner } from './ReopenBanner';
import { IdbQuotaBanner } from './IdbQuotaBanner';
import { PinnedFolderSection } from './PinnedFolderSection';
import { usePinnedFolder } from '../file-system-access/usePinnedFolder';
import { useDeskAuth } from '../desk-auth';
import './home.css';

/**
 * Landing surface for a blank workbook — a Drive/Notion-style app shell:
 * a collapsible left sidebar (brand, New, nav, account) beside a content
 * pane that switches view (Home / Templates / Recent / Shared / Account).
 * Replaces the older single-column hero gallery. Same gate condition
 * (Untitled + early revision); the editor stays mounted behind so picking
 * a template dissolves straight into a ready workbook.
 *
 * Templates are real .xlsx files under `public/templates/` — picking a
 * card runs the standard xlsx parse worker and swaps the workbook in place.
 */
type HomeView = 'home' | 'templates' | 'recent' | 'shared' | 'account';

const VIEW_META: Record<HomeView, { title: string; sub: string; icon: string }> = {
  home: { title: 'Home', sub: 'Jump back in, or start something new.', icon: 'home' },
  templates: {
    title: 'Templates',
    sub: 'A starting point designed for real work.',
    icon: 'grid_view',
  },
  recent: { title: 'Recent', sub: 'Files from your last sessions.', icon: 'history' },
  shared: { title: 'Shared', sub: 'Work on a file with other people, live.', icon: 'group' },
  account: { title: 'Account', sub: 'Your profile and preferences.', icon: 'account_circle' },
};

export interface HomeScreenProps {
  dismissed?: boolean;
  forceVisible?: boolean;
  onDismiss?: () => void;
  onNewDocument?: () => void;
  onSelectTemplate?: (template: Template) => void;
  onOpenFile?: (file: File) => void;
  onOpenRecent?: (rec: RecentEntry) => void;
  onOpenAuth?: () => void;
}

export function HomeScreen({
  dismissed,
  forceVisible,
  onDismiss,
  onNewDocument,
  onSelectTemplate,
  onOpenFile,
  onOpenRecent: onOpenRecentProp,
  onOpenAuth,
}: HomeScreenProps) {
  const wb = useWorkbook();
  const loading = useLoading();
  const fileSource = useFileSource();
  const recents = useRecentFiles();
  const pinned = usePinnedFolder();
  const deskAuth = useDeskAuth();
  const authState = deskAuth?.state;
  const isAuth = authState?.kind === 'authenticated';
  const authUser = isAuth ? authState.user : null;

  const isBlank = wb.meta.name === 'Untitled' && wb.meta.revision <= 1;
  // Suppress the home in collab rooms — the URL is the authoritative signal
  // (collab context hydrates async; Hocuspocus shortly replaces the workbook).
  const inCollabRoom =
    typeof window !== 'undefined' &&
    (/^\/r\/[\w-]{4,}\/?$/.test(window.location.pathname) ||
      (new URLSearchParams(window.location.search).get('room') ?? '').length >= 4);

  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'All'>('All');
  const [view, setView] = useState<HomeView>('home');
  const [collapsed, setCollapsed] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATES.filter((t) => {
      if (activeCategory !== 'All' && t.category !== activeCategory && t.id !== 'blank')
        return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  }, [query, activeCategory]);

  const featured = useMemo(() => TEMPLATES.filter((t) => t.featured), []);
  const byCategory = useMemo(() => {
    const map = new Map<TemplateCategory, Template[]>();
    for (const cat of CATEGORIES) map.set(cat, []);
    for (const t of TEMPLATES) {
      if (t.id === 'blank') continue; // featured-only
      map.get(t.category)?.push(t);
    }
    return map;
  }, []);

  const visible = forceVisible || (!dismissed && isBlank && !inCollabRoom);

  // Esc closes the home, same as the X button.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onDismiss]);

  if (!visible) return null;

  const pick = async (t: Template) => {
    if (t.id === 'blank') {
      if (onNewDocument) {
        onNewDocument();
        return;
      }
      wb.replaceWorkbook(emptyWorkbook(), null);
      onDismiss?.();
      return;
    }
    if (onSelectTemplate) {
      onSelectTemplate(t);
      return;
    }
    const url = `${import.meta.env.BASE_URL ?? '/'}templates/${t.id}.xlsx`;
    loading.set({ fileName: `${t.name}.xlsx`, phase: 'reading' });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Template fetch failed: ${res.status}`);
      const sizeBytes = Number(res.headers.get('content-length') ?? '0') || undefined;
      loading.set({ phase: 'parsing', sizeBytes });
      const buf = await res.arrayBuffer();
      const data = (await xlsxToWorkbookData(buf)) as IWorkbookData;
      data.name = t.name;
      loading.set({ phase: 'mounting' });
      wb.replaceWorkbook(data, 'xlsx');
      onDismiss?.();
      loading.set(null);
    } catch (err) {
      console.error('[home] template open failed', err);
      loading.set({
        fileName: `${t.name}.xlsx`,
        phase: 'reading',
        error: err instanceof Error ? err.message : 'Failed to open template.',
        onRetry: () => void pick(t),
      });
    }
  };

  const onOpenRecent = async (rec: RecentEntry) => {
    if (onOpenRecentProp) {
      onOpenRecentProp(rec);
      return;
    }
    try {
      const opened = await fileSource.openRecent(rec.id);
      wb.replaceWorkbook(
        opened.data,
        opened.sourceFormat,
        opened.serverFileId
          ? { fileId: opened.serverFileId, etag: opened.serverEtag ?? null }
          : null,
      );
      onDismiss?.();
    } catch (err) {
      console.warn('[home] reopen failed', rec.id, err);
      loading.set({
        fileName: rec.name,
        phase: 'reading',
        error: err instanceof Error ? err.message : 'Could not reopen this file.',
      });
    }
  };

  const openFileFromDisk = async () => {
    const file = await pickXlsxFile();
    if (!file) return;
    if (onOpenFile) {
      onOpenFile(file);
      return;
    }
    loading.set({ fileName: file.name, sizeBytes: file.size, phase: 'reading' });
    try {
      await loadSpreadsheetFile(file, null, wb.replaceWorkbook, (phase) => loading.set({ phase }));
      onDismiss?.();
      loading.set(null);
    } catch (err) {
      console.error('[home] open file failed', err);
      loading.set({
        fileName: file.name,
        phase: 'reading',
        error: err instanceof Error ? err.message : 'Could not open this file.',
      });
    }
  };
  const onDeleteRecent = (rec: RecentEntry) => {
    void fileSource.forgetRecent(rec.id);
  };

  const goTemplates = () => {
    setQuery('');
    setActiveCategory('All');
    setView('templates');
  };

  const navItems: { id: HomeView; label: string; icon: string }[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'recent', label: 'Recent', icon: 'history' },
    { id: 'templates', label: 'Templates', icon: 'grid_view' },
    { id: 'shared', label: 'Shared', icon: 'group' },
  ];

  const navButton = (it: { id: HomeView; label: string; icon: string }) => (
    <button
      key={it.id}
      type="button"
      className={`home__nav-item${view === it.id ? ' home__nav-item--on' : ''}`}
      onClick={() => setView(it.id)}
      title={it.label}
      aria-current={view === it.id ? 'page' : undefined}
      data-testid={`home-nav-${it.id}`}
    >
      <Icon name={it.icon} />
      <span className="home__nav-label">{it.label}</span>
    </button>
  );

  return (
    <div
      className={`home${collapsed ? ' home--collapsed' : ''}`}
      data-testid="home-screen"
      aria-label="Start a new spreadsheet"
    >
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="home__sidebar">
        <div className="home__sidebar-top">
          <span className="home__brand">
            <img src={sheetsMark} alt="" className="home__brand-mark" width={26} height={33} />
            <span className="home__brand-name">CSheets</span>
          </span>
          <button
            type="button"
            className="home__collapse"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            data-testid="home-collapse"
          >
            <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} />
          </button>
        </div>

        <div className="home__new">
          {collapsed ? (
            // Collapsed rail: a centered round primary FAB (matches the round
            // account avatar), not a stretched full-width button with an
            // off-centre plus.
            <button
              type="button"
              className="btn-primary home__new-fab"
              onClick={() => void pick(TEMPLATES.find((t) => t.id === 'blank') ?? TEMPLATES[0])}
              data-testid="home-new"
              aria-label="New spreadsheet"
              title="New spreadsheet"
            >
              <Icon name="add" />
            </button>
          ) : (
            <Button
              variant="primary"
              icon="add"
              full
              onClick={() => void pick(TEMPLATES.find((t) => t.id === 'blank') ?? TEMPLATES[0])}
              data-testid="home-new"
            >
              <span className="home__new-label">New spreadsheet</span>
            </Button>
          )}
        </div>

        <nav className="home__nav" aria-label="Home navigation">
          {navItems.map(navButton)}
        </nav>

        <div className="home__sidebar-foot">
          <button
            type="button"
            className={`home__account${view === 'account' ? ' home__account--on' : ''}`}
            onClick={() => setView('account')}
            title="Account"
            aria-current={view === 'account' ? 'page' : undefined}
            data-testid="home-nav-account"
          >
            <span className="home__account-avatar" aria-hidden>
              <Icon name="person" />
            </span>
            <span className="home__account-text">
              <span className="home__account-name">Account</span>
              <span className="home__account-sub">Preferences &amp; sign-in</span>
            </span>
            <Icon name="chevron_right" />
          </button>
        </div>
      </aside>

      {/* ── Content ─────────────────────────────────────────────── */}
      <main className="home__main">
        <button
          type="button"
          className="home__close"
          aria-label="Close home"
          title="Close (Esc)"
          onClick={() => onDismiss?.()}
          data-testid="home-close"
        >
          <Icon name="close" />
        </button>

        <div className="home__scroll">
          <IdbQuotaBanner />
          <ReopenBanner recents={recents} onOpen={onOpenRecent} />

          <header className="home__page-head">
            <div className="home__page-headings">
              <h1 className="home__page-title">{VIEW_META[view].title}</h1>
              <p className="home__page-sub">{VIEW_META[view].sub}</p>
            </div>
            <div className="home__page-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* CookApps Auth Button */}
              {isAuth ? (
                <div
                  onClick={() => setView('account')}
                  title={`CookApps Account: ${authUser?.name || authUser?.email || ''}`}
                  data-testid="home-cookapps-chip"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--home-border, #e2e8f0)',
                    background: 'var(--home-surface-raised, #ffffff)',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    userSelect: 'none',
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: '#16a34a',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {(authUser?.name || authUser?.email || 'C')[0].toUpperCase()}
                  </span>
                  <span>{authUser?.name || authUser?.email?.split('@')[0]}</span>
                  <span
                    style={{
                      fontSize: 11,
                      color: '#16a34a',
                      background: 'rgba(22, 163, 74, 0.1)',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    Active
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenAuth) onOpenAuth();
                    else void deskAuth?.startLogin();
                  }}
                  data-testid="home-cookapps-login"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#16a34a',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    transition: 'background 0.15s',
                  }}
                  title="Đăng nhập tài khoản CookApps"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect width="16" height="16" rx="3.5" fill="#15803d" />
                    <path
                      d="M8 1.5L1.5 7V14.5H6V10H10V14.5H14.5V7L8 1.5Z"
                      fill="white"
                    />
                  </svg>
                  <span>Sign in with CookApps</span>
                </button>
              )}

              <Button
                variant="secondary"
                icon="folder_open"
                onClick={() => void openFileFromDisk()}
                data-testid="home-open-file"
              >
                Open file
              </Button>
              <PinFolderControl
                state={pinned.state}
                onPin={() => void pinned.pin()}
                onReconnect={() => void pinned.reconnect()}
                onUnpin={() => void pinned.unpin()}
              />
            </div>
          </header>

          {/* Templates search + categories — only on the Templates view. */}
          {view === 'templates' && (
            <div className="home__filters">
              <div className="home__search">
                <Icon name="search" />
                <input
                  type="search"
                  placeholder="Search templates"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  data-testid="home-search"
                />
              </div>
              <div className="home__cats">
                <button
                  type="button"
                  className={`home__cat${activeCategory === 'All' ? ' home__cat--on' : ''}`}
                  onClick={() => setActiveCategory('All')}
                >
                  All
                </button>
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`home__cat${activeCategory === c ? ' home__cat--on' : ''}`}
                    onClick={() => setActiveCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── HOME view ── */}
          {view === 'home' && (
            <>
              <section className="home__section">
                <div className="home__section-head">
                  <h2>Featured</h2>
                  <button type="button" className="home__section-link" onClick={goTemplates}>
                    Browse all templates
                  </button>
                </div>
                <div className="home__featured-row">
                  {featured.map((t) => (
                    <TemplateCard key={t.id} template={t} size="lg" onPick={pick} />
                  ))}
                </div>
              </section>

              {recents.length > 0 && (
                <RecentsSection
                  recents={recents.slice(0, 6)}
                  onOpenRecent={onOpenRecent}
                  onDeleteRecent={onDeleteRecent}
                  hint="Pick up where you left off."
                />
              )}
            </>
          )}

          {/* ── TEMPLATES view ── */}
          {view === 'templates' &&
            (query.trim() !== '' || activeCategory !== 'All' ? (
              <section className="home__section">
                <div className="home__section-head">
                  <h2>{query.trim() ? `Results for "${query.trim()}"` : activeCategory}</h2>
                  <span className="home__section-hint">
                    {filtered.length} template{filtered.length === 1 ? '' : 's'}
                  </span>
                </div>
                {filtered.length === 0 ? (
                  <div className="home__empty">No templates match. Try a different keyword.</div>
                ) : (
                  <div className="home__grid">
                    {filtered.map((t) => (
                      <TemplateCard key={t.id} template={t} onPick={pick} />
                    ))}
                  </div>
                )}
              </section>
            ) : (
              CATEGORIES.map((cat) => {
                const items = byCategory.get(cat) ?? [];
                if (items.length === 0) return null;
                return (
                  <section key={cat} className="home__section">
                    <div className="home__section-head">
                      <h2>{cat}</h2>
                      <span className="home__section-hint">{items.length} templates</span>
                    </div>
                    <div className="home__grid">
                      {items.map((t) => (
                        <TemplateCard key={t.id} template={t} onPick={pick} />
                      ))}
                    </div>
                  </section>
                );
              })
            ))}

          {/* ── RECENT view ── */}
          {view === 'recent' && (
            <>
              {(pinned.state.kind === 'granted' || pinned.state.kind === 'prompt') && (
                <PinnedFolderSection
                  state={pinned.state}
                  onReconnect={() => void pinned.reconnect()}
                  onOpenFile={async (file) => {
                    loading.set({ fileName: file.name, sizeBytes: file.size, phase: 'reading' });
                    try {
                      await loadSpreadsheetFile(file, null, wb.replaceWorkbook, (phase) =>
                        loading.set({ phase }),
                      );
                      onDismiss();
                      loading.set(null);
                    } catch (err) {
                      console.error('[home] pinned-folder open failed', err);
                      loading.set({
                        fileName: file.name,
                        phase: 'reading',
                        error: err instanceof Error ? err.message : 'Could not open this file.',
                      });
                    }
                  }}
                />
              )}
              {recents.length > 0 ? (
                <RecentsSection
                  recents={recents}
                  onOpenRecent={onOpenRecent}
                  onDeleteRecent={onDeleteRecent}
                />
              ) : (
                <EmptyState
                  icon="history"
                  title="No recent files yet"
                  body="Files you open or create will show up here."
                  cta="Browse templates"
                  onCta={goTemplates}
                />
              )}
            </>
          )}

          {/* ── SHARED view ── */}
          {view === 'shared' && (
            <EmptyState
              icon="group"
              title="Collaborate in real time"
              body="Open a spreadsheet, then use Share to start a room — anyone with the link can co-edit live, cursors and all."
              cta="Start a blank spreadsheet"
              onCta={() => void pick(TEMPLATES.find((t) => t.id === 'blank') ?? TEMPLATES[0])}
            />
          )}

          {/* ── ACCOUNT view ── */}
          {view === 'account' && (
            <AccountPanel
              deskAuth={deskAuth}
              onOpenAuth={onOpenAuth}
            />
          )}

          <footer className="home__foot">
            <span>
              Drop an Excel / ODS / CSV file anywhere, or use <strong>File → Open</strong>.
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function RecentsSection({
  recents,
  onOpenRecent,
  onDeleteRecent,
  hint = 'From your last sessions.',
}: {
  recents: RecentEntry[];
  onOpenRecent: (rec: RecentEntry) => void;
  onDeleteRecent: (rec: RecentEntry) => void;
  hint?: string;
}) {
  return (
    <section className="home__section home__section--recents">
      <div className="home__section-head">
        <h2>
          <Icon name="history" /> Recent files
        </h2>
        <span className="home__section-hint">{hint}</span>
      </div>
      <ul className="home__recents">
        {recents.map((rec) => (
          <li key={rec.id} className="home__recent">
            <button
              type="button"
              className="home__recent-open"
              onClick={() => onOpenRecent(rec)}
              data-testid="home-recent-open"
            >
              <span className="home__recent-icon">
                <Icon name="description" />
              </span>
              <span className="home__recent-text">
                <span className="home__recent-name">{rec.name}</span>
                <span className="home__recent-meta">
                  {formatSize(rec.size)} · {formatTime(rec.modifiedAt)}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="home__recent-delete"
              title="Remove from recent"
              onClick={() => onDeleteRecent(rec)}
            >
              <Icon name="close" size="sm" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState({
  icon,
  title,
  body,
  cta,
  onCta,
}: {
  icon: string;
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <div className="home__emptystate" data-testid="home-emptystate">
      <span className="home__emptystate-icon">
        <Icon name={icon} />
      </span>
      <h2 className="home__emptystate-title">{title}</h2>
      <p className="home__emptystate-body">{body}</p>
      <Button variant="primary" onClick={onCta}>
        {cta}
      </Button>
    </div>
  );
}

function PinFolderControl({
  state,
  onPin,
  onReconnect,
  onUnpin,
}: {
  state: ReturnType<typeof usePinnedFolder>['state'];
  onPin: () => void;
  onReconnect: () => void;
  onUnpin: () => void;
}) {
  if (state.kind === 'unsupported') return null;
  if (state.kind === 'none' || state.kind === 'denied') {
    return (
      <button
        type="button"
        className="home__pin"
        onClick={onPin}
        data-testid="home-pin-folder"
        title={
          state.kind === 'denied'
            ? `Pick a folder again (last pick "${state.record.name}" was denied)`
            : 'Pick a folder — saves write directly to it, no download'
        }
      >
        <Icon name="folder_special" />
        <span>{state.kind === 'denied' ? `Re-pin ${state.record.name}` : 'Pin a folder'}</span>
      </button>
    );
  }
  if (state.kind === 'prompt') {
    return (
      <button
        type="button"
        className="home__pin home__pin--reconnect"
        onClick={onReconnect}
        data-testid="home-reconnect-folder"
        title="Permission lapsed — click to re-grant access"
      >
        <Icon name="link_off" />
        <span>Reconnect {state.record.name}</span>
      </button>
    );
  }
  return (
    <div className="home__pin home__pin--granted" data-testid="home-pinned-folder">
      <Icon name="folder_special" />
      <span className="home__pin-name">Saving to {state.record.name}</span>
      <button
        type="button"
        className="home__pin-unpin"
        onClick={onUnpin}
        aria-label="Unpin folder"
        title="Unpin folder"
        data-testid="home-unpin-folder"
      >
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60_000) return 'just now';
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  const days = Math.floor(ms / 86_400_000);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function AccountPanel({
  deskAuth,
  onOpenAuth,
}: {
  deskAuth: ReturnType<typeof useDeskAuth>;
  onOpenAuth?: () => void;
}) {
  const state = deskAuth?.state;
  const isAuth = state?.kind === 'authenticated';
  const user = isAuth ? state.user : null;
  const entitlement = isAuth ? state.entitlement : null;
  const [rechecking, setRechecking] = useState(false);

  const handleRecheck = async () => {
    if (!deskAuth) return;
    setRechecking(true);
    try {
      await deskAuth.recheck();
    } finally {
      setRechecking(false);
    }
  };

  return (
    <div className="home__account-view" style={{ maxWidth: 640, margin: '24px auto', padding: '0 16px' }}>
      <div
        style={{
          background: 'var(--home-surface-raised, #ffffff)',
          border: '1px solid var(--home-border, #e2e8f0)',
          borderRadius: 14,
          padding: 28,
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#16a34a',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            {isAuth ? (user?.name || user?.email || 'C')[0].toUpperCase() : <Icon name="person" size="lg" />}
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {isAuth ? user?.name || user?.email : 'CookApps Account'}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--home-ink-muted, #64748b)' }}>
              {isAuth ? user?.email : 'Chưa kết nối tài khoản CookApps'}
            </p>
          </div>
          {isAuth && (
            <span
              style={{
                marginLeft: 'auto',
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: 'rgba(22, 163, 74, 0.1)',
                color: '#16a34a',
                border: '1px solid rgba(22, 163, 74, 0.2)',
              }}
            >
              {entitlement?.plan || 'CookApps Pro'}
            </span>
          )}
        </div>

        {isAuth ? (
          <div>
            <div style={{ borderTop: '1px solid var(--home-border, #e2e8f0)', paddingTop: 16, marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                <div>
                  <span style={{ color: 'var(--home-ink-muted, #64748b)' }}>Gói bản quyền:</span>{' '}
                  <strong>{entitlement?.plan || 'Active'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--home-ink-muted, #64748b)' }}>Trạng thái:</span>{' '}
                  <strong style={{ color: '#16a34a' }}>Đã kích hoạt</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--home-ink-muted, #64748b)' }}>Hạn dịch vụ:</span>{' '}
                  <span>{entitlement?.expiresAt ? new Date(entitlement.expiresAt * 1000).toLocaleDateString() : 'Vĩnh viễn'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--home-ink-muted, #64748b)' }}>Thiết bị:</span>{' '}
                  <span>{entitlement?.deviceLimit ? `Tối đa ${entitlement.deviceLimit} máy` : 'Đang hoạt động'}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="secondary" onClick={handleRecheck} disabled={rechecking}>
                {rechecking ? 'Đang kiểm tra…' : 'Kiểm tra lại bản quyền'}
              </Button>
              <Button variant="danger" onClick={() => void deskAuth?.logout()}>
                Đăng xuất
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 13.5, color: 'var(--home-ink-muted, #64748b)', lineHeight: 1.5, marginBottom: 20 }}>
              Đăng nhập bằng tài khoản CookApps để kích hoạt toàn bộ tính năng của CSheets Desktop, đồng bộ cấu hình và quản lý giấy phép bản quyền trên các thiết bị.
            </p>
            <Button
              variant="primary"
              onClick={() => {
                if (onOpenAuth) onOpenAuth();
                else void deskAuth?.startLogin();
              }}
            >
              Đăng nhập với CookApps
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

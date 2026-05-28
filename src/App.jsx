import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, clearStoredAuth, getStoredToken, getTcgHitList, getTradeHitListItems, loginDashboardUser, syncTradeHitListItem, updateHitListImageUrl } from './api.js';

const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_LIMIT = 120;
const DEFAULT_PAGE_SIZE = 9;
const PAGE_ROTATION_MS = 15_000;
const FULL_SYNC_MS = 15 * 60_000;

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    game: params.get('game') || '',
    search: params.get('search') || '',
    compact: params.get('compact') === '1' || params.get('mode') === 'compact',
    refreshMs: Math.max(15_000, Number(params.get('refreshMs')) || DEFAULT_REFRESH_MS),
    limit: Math.max(1, Math.min(250, Number(params.get('limit')) || DEFAULT_LIMIT)),
    pageSize: Math.max(1, Math.min(60, Number(params.get('pageSize')) || DEFAULT_PAGE_SIZE)),
  };
}

function fmtMoney(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toFixed(2)}`;
}

function sellPriceFromMarket(value) {
  const market = Number(value);
  if (!Number.isFinite(market) || market <= 0) return null;
  return Math.max(0.99, Math.floor(market) + 0.99);
}

function timeAgo(value) {
  if (!value) return 'not synced';
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return 'not synced';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function normalizeCondition(condition) {
  const value = (condition || '').toUpperCase();
  return value || '—';
}

function PlaceholderCard({ name }) {
  const initials = (name || 'TCG')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'TCG';
  return <div className="card-image card-image--placeholder">{initials}</div>;
}

function HitListCard({ item, compact, paused, onEditImage }) {
  const details = [item.tcgSetName, item.tcgRarity].filter(Boolean).join(' · ');
  const variant = [item.tcgPrinting || 'Standard', normalizeCondition(item.tcgCondition)].filter(Boolean).join(' · ');
  const sellPrice = sellPriceFromMarket(item.marketValue);

  return (
    <article className={compact ? 'hit-card hit-card--compact' : 'hit-card'}>
      <button
        className={paused ? 'image-wrap image-wrap--editable' : 'image-wrap'}
        type="button"
        disabled={!paused}
        onClick={() => onEditImage(item)}
        title={paused ? 'Click to set image URL' : undefined}
      >
        {item.imageUrl ? (
          <img className="card-image" src={item.imageUrl} alt={`${item.productName} card art`} loading="lazy" />
        ) : (
          <PlaceholderCard name={item.productName} />
        )}
        {paused && <span className="image-edit-badge">Edit image</span>}
      </button>
      <div className="card-body">
        <div className="card-kicker">{item.tcgGame || 'TCG'}</div>
        <h2>{item.productName}</h2>
        <p className="card-details">{details || 'Set details unavailable'}</p>
        <p className="card-variant">{variant}</p>
        <div className="sell-price" aria-label="Store sell price">
          <span>Our sell price</span>
          <strong>{fmtMoney(sellPrice)}</strong>
        </div>
        <div className="sync-line">Synced {timeAgo(item.lastSyncedAt || item.updatedAt)}</div>
      </div>
    </article>
  );
}

function LoginPanel({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await loginDashboardUser(username, password);
      if (result?.mustChangePassword) {
        setError('Password change is required. Please sign in on the dashboard first.');
        return;
      }
      onLogin(result?.token || getStoredToken());
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="login-overlay" aria-label="TCG display login">
      <form className="login-card" onSubmit={submit}>
        <p className="login-kicker">TCG Buylist</p>
        <h2>Dashboard Login</h2>
        <p>Sign in with a dashboard username to access the TCG buylist display.</p>
        {error && <div className="login-error">{error}</div>}
        <label>
          <span>Username</span>
          <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required disabled={loading} />
        </label>
        <label>
          <span>Password</span>
          <input value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete="current-password" required disabled={loading} />
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</button>
      </form>
    </section>
  );
}

function App() {
  const params = useMemo(getQueryParams, []);
  const [items, setItems] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [savingImageId, setSavingImageId] = useState(null);
  const [manualSync, setManualSync] = useState({ active: false, completed: 0, total: 0, message: '' });
  const [authToken, setAuthToken] = useState(() => getStoredToken());
  const [showLogin, setShowLogin] = useState(() => !getStoredToken());

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await getTcgHitList({
        game: params.game,
        search: params.search,
        limit: params.limit,
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setGeneratedAt(data?.generatedAt || null);
      setLastLoadedAt(new Date());
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Unable to load TCG hit list.');
    } finally {
      setLoading(false);
    }
  }, [params.game, params.limit, params.search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (paused) return undefined;
    const interval = window.setInterval(load, params.refreshMs);
    return () => window.clearInterval(interval);
  }, [load, params.refreshMs, paused]);

  const games = useMemo(() => Array.from(new Set(items.map(item => item.tcgGame).filter(Boolean))).sort(), [items]);
  const pageCount = Math.max(1, Math.ceil(items.length / params.pageSize));
  const pageItems = useMemo(() => {
    const start = currentPage * params.pageSize;
    return items.slice(start, start + params.pageSize);
  }, [currentPage, items, params.pageSize]);

  useEffect(() => {
    setCurrentPage(0);
  }, [items.length, params.pageSize]);

  useEffect(() => {
    if (paused || pageCount <= 1) return undefined;
    const interval = window.setInterval(() => {
      setCurrentPage(page => (page + 1) % pageCount);
    }, PAGE_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [pageCount, paused]);

  const goToPage = useCallback((direction) => {
    if (pageCount <= 1) return;
    setCurrentPage(page => (page + direction + pageCount) % pageCount);
  }, [pageCount]);

  const runHitListSync = useCallback(async (trigger = 'manual') => {
    if (!authToken || manualSync.active) {
      if (!authToken) setShowLogin(true);
      return;
    }

    const isAuto = trigger === 'auto';
    setManualSync({ active: true, completed: 0, total: 0, message: `${isAuto ? 'Auto sync' : 'Manual sync'}: finding hit list items…` });
    try {
      const hitList = await getTradeHitListItems({ source: 'tcg', search: params.search, game: params.game });
      const ids = Array.isArray(hitList) ? hitList.map(item => item.id).filter(Boolean) : [];
      setManualSync({ active: true, completed: 0, total: ids.length, message: ids.length ? `${isAuto ? 'Auto syncing' : 'Syncing'} hit list…` : 'No TCG hit list items to sync.' });

      for (let index = 0; index < ids.length; index += 1) {
        await syncTradeHitListItem(ids[index]);
        setManualSync({ active: true, completed: index + 1, total: ids.length, message: `${isAuto ? 'Auto synced' : 'Synced'} ${index + 1} of ${ids.length}` });
      }

      await load();
      setManualSync({ active: false, completed: ids.length, total: ids.length, message: ids.length ? `${isAuto ? 'Auto sync' : 'Manual sync'} complete.` : 'No TCG hit list items to sync.' });
      window.setTimeout(() => {
        setManualSync(current => current.active ? current : { active: false, completed: 0, total: 0, message: '' });
      }, 4000);
    } catch (err) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        clearStoredAuth();
        setAuthToken(null);
        setShowLogin(true);
      }
      setManualSync({ active: false, completed: 0, total: 0, message: err?.response?.data?.message || err?.message || 'Manual sync failed.' });
    }
  }, [authToken, load, manualSync.active, params.game, params.search]);

  useEffect(() => {
    if (!authToken) return undefined;
    const interval = window.setInterval(() => {
      runHitListSync('auto');
    }, FULL_SYNC_MS);
    return () => window.clearInterval(interval);
  }, [authToken, runHitListSync]);

  const editImage = useCallback(async (item) => {
    if (!paused || !item?.id) return;
    if (!authToken) {
      setShowLogin(true);
      return;
    }

    const nextUrl = window.prompt(`Image URL for ${item.productName}`, item.imageUrl || '');
    if (nextUrl == null) return;

    try {
      setSavingImageId(item.id);
      const updated = await updateHitListImageUrl(item.id, nextUrl.trim());
      setItems(current => current.map(existing => existing.id === item.id
        ? { ...existing, imageUrl: updated?.imageUrl || nextUrl.trim() || null, updatedAt: updated?.updatedAt || existing.updatedAt }
        : existing));
    } catch (err) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        clearStoredAuth();
        setAuthToken(null);
        setShowLogin(true);
      }
      window.alert(err?.response?.data?.message || err?.message || 'Unable to save image URL.');
    } finally {
      setSavingImageId(null);
    }
  }, [authToken, paused]);

  const togglePaused = () => {
    if (!authToken) {
      setShowLogin(true);
      return;
    }
    setPaused(value => !value);
  };

  const signOut = () => {
    clearStoredAuth();
    setAuthToken(null);
    setPaused(false);
    setShowLogin(true);
  };

  if (!authToken) {
    return <LoginPanel onLogin={(token) => { setAuthToken(token); setShowLogin(false); }} />;
  }

  return (
    <main className={params.compact ? 'app app--compact' : 'app'}>
      <header className="hero">
        <div>
          <p className="eyebrow">HOTTEST TCG ITEMS</p>
          <p className="subtitle">Our top selling items, and current store values.</p>
        </div>
        <div className="status-panel" title={generatedAt ? new Date(generatedAt).toLocaleString() : ''}>
          <span>Last update</span>
          <strong>{lastLoadedAt ? lastLoadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</strong>
        </div>
        <div className="action-dock">
          <button className="action-dock__trigger" type="button" aria-label="Show display actions" title="Display actions">⋯</button>
          <div className="action-dock__panel">
            <button
              className={paused ? 'pause-toggle pause-toggle--active' : 'pause-toggle'}
              type="button"
              onClick={togglePaused}
              title={paused ? 'Resume syncing and pagination' : 'Pause syncing and pagination to edit image URLs'}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              className="sync-toggle"
              type="button"
              onClick={() => runHitListSync('manual')}
              disabled={manualSync.active}
              title="Manually sync every TCG hit list item"
            >
              {manualSync.active ? 'Syncing' : 'Sync'}
            </button>
            {authToken && (
              <button className="auth-toggle" type="button" onClick={signOut} title="Sign out">
                ×
              </button>
            )}
          </div>
        </div>
      </header>

      {error && <div className="banner banner--error">{error}<span>API: {API_BASE}</span></div>}
      {loading && <div className="banner">Loading TCG hit list…</div>}
      {paused && <div className="banner banner--paused">Paused: syncing and pagination are stopped. {authToken ? 'Click a card image slot to set its image URL.' : 'Sign in to edit image URLs.'}{savingImageId ? <span>Saving…</span> : null}</div>}
      {(manualSync.active || manualSync.message) && (
        <div className={manualSync.active ? 'sync-progress sync-progress--active' : 'sync-progress'}>
          <div className="sync-progress__meta">
            <span>{manualSync.message}</span>
            <strong>{manualSync.total ? `${manualSync.completed} / ${manualSync.total}` : manualSync.active ? 'Starting…' : ''}</strong>
          </div>
          <div className="sync-progress__track" aria-label="Hit list sync progress">
            <div
              className="sync-progress__bar"
              style={{ width: `${manualSync.total ? Math.round((manualSync.completed / manualSync.total) * 100) : manualSync.active ? 8 : 100}%` }}
            />
          </div>
        </div>
      )}
      {showLogin && !authToken && <LoginPanel onLogin={(token) => { setAuthToken(token); setShowLogin(false); }} />}

      {!loading && items.length === 0 ? (
        <section className="empty-state">
          <div className="empty-icon">🃏</div>
          <h2>No TCG hit list items yet</h2>
          <p>Pin JustTCG cards from the scanner with “+ Hit List” and they will appear here automatically.</p>
        </section>
      ) : (
        <section className="grid" aria-live="polite">
          {pageItems.map(item => (
            <HitListCard
              key={item.id}
              item={item}
              compact={params.compact}
              paused={paused}
              onEditImage={editImage}
            />
          ))}
          {pageCount > 1 && (
            <div className="page-indicator" aria-label={`Page ${currentPage + 1} of ${pageCount}`}>
              {paused && (
                <button type="button" onClick={() => goToPage(-1)} aria-label="Previous page">‹</button>
              )}
              <span>Page {currentPage + 1} / {pageCount}</span>
              {paused && (
                <button type="button" onClick={() => goToPage(1)} aria-label="Next page">›</button>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default App;

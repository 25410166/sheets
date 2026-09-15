// Copyright (c) 2026 Casual Office
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

export interface SheetTabInfo {
  id: string;
  name: string;
  filePath: string | null;
  isDirty: boolean;
}

export interface DocumentTabBarProps {
  tabs: SheetTabInfo[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  /** Show permanent Home tab */
  showHomeTab?: boolean;
  /** Called when Home tab is clicked */
  onHomeTab?: () => void;
  /** True when Home tab is active */
  homeTabActive?: boolean;
  themeMode?: 'light' | 'dark' | 'system';
}

export const DocumentTabBar: React.FC<DocumentTabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  showHomeTab = true,
  onHomeTab,
  homeTabActive = false,
  themeMode = 'light',
}) => {
  const isDark =
    themeMode === 'dark' ||
    (typeof document !== 'undefined' &&
      (document.documentElement.classList.contains('univer-dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark'));

  const barBg = isDark ? '#14171d' : '#f1f5f9';
  const barBorder = isDark ? '#262b36' : '#e2e8f0';
  const activeBg = isDark ? '#1e2430' : '#ffffff';
  const activeFg = isDark ? '#f8fafc' : '#0f172a';
  const inactiveFg = isDark ? '#94a3b8' : '#64748b';
  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const brandGreen = '#16a34a';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        height: 38,
        background: barBg,
        borderBottom: `1px solid ${barBorder}`,
        padding: '0 8px',
        userSelect: 'none',
        flexShrink: 0,
        gap: 2,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        zIndex: 50,
      }}
      data-testid="csheet-tabbar"
    >
      {/* App Branding Badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          marginRight: 6,
          marginBottom: 4,
          cursor: 'pointer',
        }}
        onClick={onHomeTab}
        title="CSheets Home"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
          <rect width="16" height="16" rx="3.5" fill={brandGreen} />
          <path
            d="M3 4H13V12H3V4ZM4 7H8V5H4V7ZM9 7H12V5H9V7ZM4 9H8V8H4V9ZM9 9H12V8H9V9ZM4 11H8V10H4V11ZM9 11H12V10H9V11Z"
            fill="white"
          />
        </svg>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: isDark ? '#f1f5f9' : '#0f172a',
            letterSpacing: '-0.01em',
          }}
        >
          CSheets
        </span>
      </div>

      {/* Tabs list container */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 3,
          overflowX: 'auto',
          maxWidth: 'calc(100vw - 160px)',
          scrollbarWidth: 'none',
        }}
      >
        {/* Permanent Home tab */}
        {showHomeTab && (
          <div
            onClick={onHomeTab}
            title="Trang chủ — Mẫu & Tệp gần đây"
            data-testid="tab-home"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 33,
              minWidth: 80,
              padding: '0 12px',
              borderRadius: '7px 7px 0 0',
              background: homeTabActive ? activeBg : 'transparent',
              color: homeTabActive ? activeFg : inactiveFg,
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: homeTabActive ? 600 : 500,
              borderTop: homeTabActive ? `2px solid ${brandGreen}` : '2px solid transparent',
              borderLeft: homeTabActive ? `1px solid ${barBorder}` : '1px solid transparent',
              borderRight: homeTabActive ? `1px solid ${barBorder}` : '1px solid transparent',
              borderBottom: homeTabActive ? `1px solid ${activeBg}` : 'none',
              marginBottom: homeTabActive ? -1 : 0,
              transition: 'background 0.12s ease',
            }}
            onMouseEnter={(e) => {
              if (!homeTabActive) e.currentTarget.style.background = hoverBg;
            }}
            onMouseLeave={(e) => {
              if (!homeTabActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            {/* House Icon */}
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <path
                d="M8 1.5L1.5 7V14.5H6V10H10V14.5H14.5V7L8 1.5Z"
                fill={homeTabActive ? brandGreen : 'currentColor'}
                opacity={homeTabActive ? 1 : 0.75}
              />
            </svg>
            <span>Home</span>
          </div>
        )}

        {/* Document Tabs */}
        {tabs.map((tab) => {
          const isActive = !homeTabActive && tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              title={tab.filePath || tab.name}
              data-testid={`tab-${tab.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                height: 33,
                minWidth: 120,
                maxWidth: 220,
                padding: '0 10px',
                borderRadius: '7px 7px 0 0',
                background: isActive ? activeBg : 'transparent',
                color: isActive ? activeFg : inactiveFg,
                cursor: 'pointer',
                fontSize: 12.5,
                fontWeight: isActive ? 600 : 500,
                borderTop: isActive ? `2px solid ${brandGreen}` : '2px solid transparent',
                borderLeft: isActive ? `1px solid ${barBorder}` : '1px solid transparent',
                borderRight: isActive ? `1px solid ${barBorder}` : '1px solid transparent',
                borderBottom: isActive ? `1px solid ${activeBg}` : 'none',
                position: 'relative',
                marginBottom: isActive ? -1 : 0,
                transition: 'background 0.12s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = hoverBg;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {/* Spreadsheet icon */}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <rect width="16" height="16" rx="3" fill={brandGreen} />
                <path
                  d="M3 4H13V12H3V4ZM4 7H8V5H4V7ZM9 7H12V5H9V7ZM4 9H8V8H4V9ZM9 9H12V8H9V9ZM4 11H8V10H4V11ZM9 11H12V10H9V11Z"
                  fill="white"
                />
              </svg>

              {/* Tab Title */}
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {tab.name}
              </span>

              {/* Dirty indicator */}
              {tab.isDirty && (
                <span
                  title="Có thay đổi chưa lưu"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#22c55e',
                    flexShrink: 0,
                  }}
                />
              )}

              {/* Close Tab Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                title="Đóng tab (Ctrl+W)"
                data-testid={`tab-close-${tab.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: 'none',
                  background: 'transparent',
                  color: inactiveFg,
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                  marginLeft: 2,
                  flexShrink: 0,
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isDark
                    ? 'rgba(255,255,255,0.15)'
                    : 'rgba(0,0,0,0.08)';
                  e.currentTarget.style.color = isDark ? '#fff' : '#0f172a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = inactiveFg;
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* New Tab (+) Button */}
      <button
        type="button"
        onClick={onNewTab}
        title="Tạo bảng tính mới tại tab mới (Ctrl+N)"
        data-testid="tab-new"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: inactiveFg,
          cursor: 'pointer',
          marginBottom: 3,
          marginLeft: 2,
          fontSize: 18,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
          transition: 'background 0.12s, color 0.12s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)';
          e.currentTarget.style.color = isDark ? '#fff' : '#0f172a';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = inactiveFg;
        }}
      >
        +
      </button>
    </div>
  );
};

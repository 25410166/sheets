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

import { Dialog } from './Dialog';

type Props = { onClose: () => void };

// `__APP_VERSION__` is replaced at build time by vite.config.ts (`define`).
// Falls back to `dev` when running outside the bundler (e.g. tests).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const APP_VERSION: string = (globalThis as any).__APP_VERSION__ ?? 'dev';
// `__COLLAB_BUILD__` is `true` when built with VITE_COLLAB_ENABLED=1
// (the Docker image). The Pages bundle ships with it `false`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COLLAB_BUILD: boolean = Boolean((globalThis as any).__COLLAB_BUILD__);

export function AboutDialog({ onClose }: Props) {
  return (
    <Dialog
      title="About CSheets"
      onClose={onClose}
      data-testid="about-dialog"
      footer={
        <button
          type="button"
          className="btn-primary"
          data-testid="about-close"
          onClick={onClose}
        >
          Close
        </button>
      }
    >
      <div className="about">
        <img
          src={`${import.meta.env.BASE_URL}brand.svg`}
          alt=""
          width={56}
          height={56}
          className="about__icon"
        />
        <h3 className="about__title">CSheets</h3>
        <p className="about__tagline">
          Fast, powerful spreadsheet powered by CookApps.
        </p>
        <dl className="about__facts">
          <dt>Version</dt>
          <dd data-testid="about-version">{APP_VERSION}</dd>
          <dt>Platform</dt>
          <dd>CookApps Office Suite</dd>
          <dt>Website</dt>
          <dd>
            <a
              href="https://cookapps.net"
              target="_blank"
              rel="noreferrer"
            >
              cookapps.net
            </a>
          </dd>
          <dt>Engine</dt>
          <dd>Univer 0.25.0 — formula functions, ExcelJS for xlsx I/O</dd>
        </dl>
      </div>
    </Dialog>
  );
}

/**
 * @license
 * Copyright 2026 Google LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {NextRequest, NextResponse} from 'next/server';

/** Methods that never change state or trigger billable work. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** `Sec-Fetch-Site` values sent by browsers for requests the app itself makes. */
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

/**
 * Rejects cross-site requests to the API routes.
 *
 * Identity-Aware Proxy authenticates users with a cookie, so without this check any website a
 * signed-in user visits could trigger billable or sensitive API calls on their behalf. Browsers
 * send `Sec-Fetch-Site`; older clients fall back to comparing `Origin` with the request host.
 * Requests without either header (for example `curl` in test.sh) are not browser initiated and
 * still have to pass IAP.
 *
 * @param request - The incoming request.
 * @return A 403 response for cross-site requests, otherwise passes the request through.
 */
export function proxy(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return NextResponse.next();

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) {
    return ALLOWED_FETCH_SITES.has(fetchSite) ? NextResponse.next() : forbidden();
  }

  const origin = request.headers.get('origin');
  if (origin) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      return forbidden();
    }
    if (originHost !== host) return forbidden();
  }

  return NextResponse.next();
}

function forbidden() {
  return NextResponse.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
}

/** Only the API routes need the check; Server Actions are origin-checked by Next.js. */
export const config = {
  matcher: '/api/:path*',
};

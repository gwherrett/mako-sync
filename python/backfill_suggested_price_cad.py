#!/usr/bin/env python3
"""
Backfill suggested_price_cad on physical_media rows using the Discogs
/marketplace/price_suggestions/{release_id} endpoint (requires authentication).

Matches the returned price to each record's `condition` field.
Falls back to VG when condition is not set or not recognised.

Usage:
  # Dry run (default) — prints what would be updated
  python backfill_suggested_price_cad.py

  # Apply changes
  python backfill_suggested_price_cad.py --apply

  # Limit to first N records (useful for testing)
  python backfill_suggested_price_cad.py --apply --limit 10

  # Overwrite existing values (re-run with updated default)
  python backfill_suggested_price_cad.py --apply --force

Required env vars:
  SUPABASE_URL              e.g. https://xyzxyz.supabase.co
  SUPABASE_SERVICE_KEY      service_role key (Settings → API)
  DISCOGS_PERSONAL_TOKEN    personal access token from discogs.com/settings/developers

Dependencies:
  pip install requests
"""

import sys
import os
import time
import argparse
import requests

if os.name == 'nt':
    sys.stdout.reconfigure(encoding='utf-8')

DISCOGS_RATE_DELAY = 1.1  # seconds between API calls (~54/min, under 60/min cap)
DEFAULT_CONDITION = 'Very Good (VG)'

# Map common shorthand / full-name variants stored in DB → Discogs API condition key
_CONDITION_MAP: dict[str, str] = {
    'mint (m)':                   'Mint (M)',
    'mint':                       'Mint (M)',
    'm':                          'Mint (M)',
    'near mint (nm or m-)':       'Near Mint (NM or M-)',
    'near mint':                  'Near Mint (NM or M-)',
    'nm':                         'Near Mint (NM or M-)',
    'm-':                         'Near Mint (NM or M-)',
    'very good plus (vg+)':       'Very Good Plus (VG+)',
    'very good plus':             'Very Good Plus (VG+)',
    'vg+':                        'Very Good Plus (VG+)',
    'very good (vg)':             'Very Good (VG)',
    'very good':                  'Very Good (VG)',
    'vg':                         'Very Good (VG)',
    'good plus (g+)':             'Good Plus (G+)',
    'good plus':                  'Good Plus (G+)',
    'g+':                         'Good Plus (G+)',
    'good (g)':                   'Good (G)',
    'good':                       'Good (G)',
    'g':                          'Good (G)',
    'fair (f)':                   'Fair (F)',
    'fair':                       'Fair (F)',
    'f':                          'Fair (F)',
    'poor (p)':                   'Poor (P)',
    'poor':                       'Poor (P)',
    'p':                          'Poor (P)',
}

_fx_cache: dict[str, float] = {}


def resolve_condition_key(raw: str | None) -> str:
    """Return the Discogs API condition key for a raw DB value, defaulting to VG+."""
    if raw:
        mapped = _CONDITION_MAP.get(raw.strip().lower())
        if mapped:
            return mapped
    return DEFAULT_CONDITION


def to_cad(value: float, currency: str) -> float:
    """Convert value from currency to CAD using frankfurter.app (free, no key needed)."""
    if currency == 'CAD':
        return value
    if currency not in _fx_cache:
        resp = requests.get(
            'https://api.frankfurter.app/latest',
            params={'from': currency, 'to': 'CAD'},
            timeout=10,
        )
        resp.raise_for_status()
        _fx_cache[currency] = resp.json()['rates']['CAD']
    return round(value * _fx_cache[currency], 2)


def get_env(name: str, *fallbacks: str) -> str:
    for key in (name, *fallbacks):
        val = os.environ.get(key)
        if val:
            return val
    print(f'ERROR: env var {name} is not set', file=sys.stderr)
    sys.exit(1)


def fetch_pending_records(supabase_url: str, service_key: str, limit: int | None, force: bool = False) -> list[dict]:
    """Fetch physical_media rows that need a suggested_price_cad backfill."""
    headers = {
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
    }
    params = [
        ('select', 'id,discogs_release_id,artist,title'),
        ('discogs_release_id', 'not.is.null'),
        ('order', 'created_at.asc'),
    ]
    if not force:
        params.append(('suggested_price_cad', 'is.null'))
    if limit:
        params.append(('limit', str(limit)))

    resp = requests.get(
        f'{supabase_url}/rest/v1/physical_media',
        headers=headers,
        params=params,
        timeout=30,
    )
    if not resp.ok:
        print(f'  Supabase error {resp.status_code}: {resp.text}', file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def fetch_price_suggestion(
    release_id: int,
    condition_key: str,
    personal_token: str,
) -> float | None:
    """Call Discogs price_suggestions and return the matched condition price in CAD, or None."""
    url = f'https://api.discogs.com/marketplace/price_suggestions/{release_id}'
    headers = {
        'Authorization': f'Discogs token={personal_token}',
        'User-Agent': 'MakoSync/1.0',
        'Accept': 'application/json',
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 404:
            return None
        if resp.status_code == 429:
            print('  RATE LIMITED — sleeping 60s', flush=True)
            time.sleep(60)
            resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if os.environ.get('DEBUG_DISCOGS'):
            print(f'\n  raw: {data}', flush=True)
        entry = data.get(condition_key)
        if entry and entry.get('value') is not None:
            return to_cad(float(entry['value']), entry.get('currency', 'USD'))
        return None
    except requests.RequestException as e:
        print(f'  Discogs API error: {e}', flush=True)
        return None


def update_record(supabase_url: str, service_key: str, record_id: str, value: float) -> bool:
    """PATCH suggested_price_cad on a single physical_media row."""
    headers = {
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    }
    resp = requests.patch(
        f'{supabase_url}/rest/v1/physical_media',
        headers=headers,
        params={'id': f'eq.{record_id}'},
        json={'suggested_price_cad': value},
        timeout=15,
    )
    return resp.ok


def main():
    parser = argparse.ArgumentParser(
        description='Backfill suggested_price_cad from Discogs price suggestions (OAuth)'
    )
    parser.add_argument('--apply', action='store_true', help='Write values to database (default: dry run)')
    parser.add_argument('--limit', type=int, default=None, help='Max records to process')
    parser.add_argument('--force', action='store_true', help='Overwrite records that already have a value')
    args = parser.parse_args()

    supabase_url    = get_env('SUPABASE_URL', 'VITE_SUPABASE_URL').rstrip('/')
    service_key     = get_env('SUPABASE_SERVICE_KEY')
    personal_token  = get_env('DISCOGS_PERSONAL_TOKEN')

    print(f'Mode: {"APPLY" if args.apply else "DRY RUN"}{"  (force overwrite)" if args.force else ""}')
    print('Fetching records with missing suggested_price_cad…')
    records = fetch_pending_records(supabase_url, service_key, args.limit, args.force)
    print(f'Found {len(records)} record(s) to process\n')

    if not records:
        print('Nothing to do.')
        return

    updated = skipped = errors = 0

    for i, record in enumerate(records):
        release_id    = record['discogs_release_id']
        condition_key = DEFAULT_CONDITION
        label = (
            f"[{i+1}/{len(records)}] {record['artist']} – {record['title']} "
            f"(release {release_id}, condition: {condition_key})"
        )
        print(label, end=' … ', flush=True)

        value = fetch_price_suggestion(release_id, condition_key, personal_token)

        if value is None:
            print('no suggestion data — skipped')
            skipped += 1
        else:
            print(f'CA${value:.2f}', end='')
            if args.apply:
                ok = update_record(supabase_url, service_key, record['id'], value)
                if ok:
                    print(' ✓')
                    updated += 1
                else:
                    print(' ERROR writing to DB')
                    errors += 1
            else:
                print(' (dry run)')
                updated += 1

        if i < len(records) - 1:
            time.sleep(DISCOGS_RATE_DELAY)

    print(f'\nDone. updated={updated}  skipped={skipped}  errors={errors}')
    if not args.apply and updated > 0:
        print('Re-run with --apply to write values to the database.')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Backfill median_value_cad on physical_media rows.

Reads records where discogs_release_id IS NOT NULL and median_value_cad IS NULL,
calls the Discogs marketplace/stats API for each, and updates the row via the
Supabase REST API.

Usage:
  # Dry run (default) — prints what would be updated
  python backfill_median_value_cad.py

  # Apply changes
  python backfill_median_value_cad.py --apply

  # Limit to first N records (useful for testing)
  python backfill_median_value_cad.py --apply --limit 10

Required env vars:
  SUPABASE_URL            e.g. https://xyzxyz.supabase.co
  SUPABASE_SERVICE_KEY    service_role key (Settings → API)
  DISCOGS_CONSUMER_KEY    from discogs.com/settings/developers
  DISCOGS_CONSUMER_SECRET
"""

import sys
import os
import time
import argparse
import requests

if os.name == 'nt':
    sys.stdout.reconfigure(encoding='utf-8')

DISCOGS_RATE_DELAY = 1.1  # seconds between API calls (~54/min, under 60/min cap)


def get_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: env var {name} is not set", file=sys.stderr)
        sys.exit(1)
    return val


def fetch_pending_records(supabase_url: str, service_key: str, limit: int | None) -> list[dict]:
    """Fetch physical_media rows that need a value backfill."""
    headers = {
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
    }
    url = f'{supabase_url}/rest/v1/physical_media'
    params = [
        ('select', 'id,discogs_release_id,artist,title'),
        ('discogs_release_id', 'not.is.null'),
        ('median_value_cad', 'is.null'),
        ('order', 'created_at.asc'),
    ]
    if limit:
        params.append(('limit', str(limit)))

    resp = requests.get(url, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_marketplace_value(release_id: int, consumer_key: str, consumer_secret: str) -> float | None:
    """Call Discogs marketplace/stats and return lowest_price in CAD, or None."""
    url = f'https://api.discogs.com/marketplace/stats/{release_id}'
    headers = {
        'Authorization': f'Discogs key={consumer_key}, secret={consumer_secret}',
        'User-Agent': 'MakoSync/1.0',
        'Accept': 'application/json',
    }
    params = {'curr_abbr': 'CAD'}

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code == 404:
            return None
        if resp.status_code == 429:
            print('  RATE LIMITED — sleeping 60s', flush=True)
            time.sleep(60)
            # retry once
            resp = requests.get(url, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        lowest = data.get('lowest_price')
        if lowest and lowest.get('value') is not None:
            return float(lowest['value'])
        return None
    except requests.RequestException as e:
        print(f'  Discogs API error: {e}', flush=True)
        return None


def update_record(supabase_url: str, service_key: str, record_id: str, value: float) -> bool:
    """PATCH median_value_cad on a single physical_media row."""
    headers = {
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    }
    url = f'{supabase_url}/rest/v1/physical_media'
    params = {'id': f'eq.{record_id}'}
    resp = requests.patch(url, headers=headers, params=params, json={'median_value_cad': value}, timeout=15)
    return resp.ok


def main():
    parser = argparse.ArgumentParser(description='Backfill median_value_cad from Discogs marketplace stats')
    parser.add_argument('--apply', action='store_true', help='Write values to database (default: dry run)')
    parser.add_argument('--limit', type=int, default=None, help='Max records to process')
    args = parser.parse_args()

    supabase_url = get_env('SUPABASE_URL').rstrip('/')
    service_key  = get_env('SUPABASE_SERVICE_KEY')
    consumer_key    = get_env('DISCOGS_CONSUMER_KEY')
    consumer_secret = get_env('DISCOGS_CONSUMER_SECRET')

    print(f'Mode: {"APPLY" if args.apply else "DRY RUN"}')
    print('Fetching records with missing median_value_cad…')
    records = fetch_pending_records(supabase_url, service_key, args.limit)
    print(f'Found {len(records)} record(s) to process\n')

    if not records:
        print('Nothing to do.')
        return

    updated = skipped = errors = 0

    for i, record in enumerate(records):
        release_id = record['discogs_release_id']
        label = f"[{i+1}/{len(records)}] {record['artist']} – {record['title']} (release {release_id})"
        print(label, end=' … ', flush=True)

        value = fetch_marketplace_value(release_id, consumer_key, consumer_secret)

        if value is None:
            print('no listing data — skipped')
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

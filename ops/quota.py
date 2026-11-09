"""Shared eBay auth and rate-limit gate for tracker, doctor, and publish.

One refresh per run. A 429 stops every consumer until Retry-After elapses.
No second account, no endpoint swap, no tight retry loop.
"""
import json
import os
import time
from email.utils import parsedate_to_datetime


def parse_retry_after(value, now):
    if value is None or value == '':
        return None
    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        pass
    try:
        when = parsedate_to_datetime(str(value)).timestamp()
        return max(0, int(when - now))
    except (TypeError, ValueError, OverflowError):
        return None


class Guard:
    def __init__(self, path):
        self.path = path
        self.lock = path + '.refresh.lock'

    def read(self):
        try:
            with open(self.path) as handle:
                data = json.load(handle)
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def write(self, state):
        parent = os.path.dirname(self.path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp = self.path + '.tmp'
        with open(tmp, 'w') as handle:
            json.dump(state, handle, sort_keys=True)
        os.replace(tmp, self.path)

    def blocked(self, now):
        until = self.read().get('cooldown_until') or 0
        return until > now

    def note_rate_limit(self, retry_after, now):
        seconds = parse_retry_after(retry_after, now)
        if seconds is None:
            seconds = 120
        seconds = max(1, min(int(seconds), 3600))
        state = self.read()
        state['cooldown_until'] = now + seconds
        state['retry_after'] = seconds
        state['reason'] = '429'
        self.write(state)
        return seconds

    def refresh_once(self, refresh, now, run_id):
        state = self.read()
        if state.get('auth_run') == run_id:
            if state.get('auth_blocked'):
                return 'denied'
            return 'followed' if state.get('auth_ok') else 'denied'
        try:
            fd = os.open(self.lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            for _ in range(40):
                time.sleep(0.05)
                state = self.read()
                if state.get('auth_run') == run_id:
                    if state.get('auth_blocked'):
                        return 'denied'
                    return 'followed' if state.get('auth_ok') else 'denied'
            return 'busy'
        try:
            ok = bool(refresh())
            state = self.read()
            state['auth_run'] = run_id
            state['auth_ok'] = ok
            state['auth_at'] = now
            self.write(state)
            return 'refreshed' if ok else 'refresh_failed'
        finally:
            os.close(fd)
            try:
                os.remove(self.lock)
            except OSError:
                pass

    def block_auth(self, run_id):
        state = self.read()
        state['auth_run'] = run_id
        state['auth_blocked'] = True
        self.write(state)

    def handle(self, call, refresh, now, run_id):
        """call() -> (status, headers, body). At most one token refresh, then one retry."""
        if self.read().get('auth_blocked') and self.read().get('auth_run') == run_id:
            return {'action': 'stop', 'reason': '401', 'retain': True, 'refresh': 'blocked', 'called': False}
        if self.blocked(now):
            return {'action': 'stop', 'reason': 'cooldown', 'retain': True, 'called': False}
        status, headers, body = call()
        headers = headers or {}
        if status == 429:
            self.note_rate_limit(headers.get('Retry-After'), now)
            return {'action': 'stop', 'reason': '429', 'retain': True, 'called': True}
        if status == 401:
            how = self.refresh_once(refresh, now, run_id)
            if how not in ('refreshed', 'followed') or not self.read().get('auth_ok'):
                return {'action': 'stop', 'reason': '401', 'retain': True, 'refresh': how, 'called': True}
            status, headers, body = call()
            headers = headers or {}
            if status == 401:
                self.block_auth(run_id)
                return {'action': 'stop', 'reason': '401', 'retain': True, 'refresh': 'retry_failed', 'called': True}
            if status == 429:
                self.note_rate_limit(headers.get('Retry-After'), now)
                return {'action': 'stop', 'reason': '429', 'retain': True, 'called': True}
        if status in (404, 410):
            return {'action': 'ended', 'status': status, 'called': True}
        if status != 200:
            return {'action': 'stop', 'reason': 'transport', 'retain': True, 'status': status, 'called': True}
        return {'action': 'ok', 'body': body, 'called': True}

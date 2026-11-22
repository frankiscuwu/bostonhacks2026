#!/bin/sh
# Use backend/.env for local provider keys, rather than stale shell exports.
# Other environment variables and normal deployment precedence are unchanged.
set -eu
cd "$(dirname "$0")"
if [ "$#" -eq 0 ]; then
    set -- 127.0.0.1:8000
fi
exec env -u MBTA_API_KEY -u GEOAPIFY_API_KEY .venv/bin/python manage.py runserver "$@"

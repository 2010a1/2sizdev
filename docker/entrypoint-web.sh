#!/bin/sh
set -eu

API_UPSTREAM="${API_UPSTREAM:-http://api:3000}"
# Escape values for sed replacement. API_UPSTREAM is expected to be a URL.
ESCAPED_API_UPSTREAM=$(printf '%s' "$API_UPSTREAM" | sed 's/[\\&|]/\\&/g')
sed "s|\${API_UPSTREAM}|${ESCAPED_API_UPSTREAM}|g" /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'

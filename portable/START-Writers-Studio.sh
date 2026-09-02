#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export NODE_ENV=production
node dist/server.cjs

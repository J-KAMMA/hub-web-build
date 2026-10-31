@echo off
cd /d C:\jkamma-platform\apps\hub
set NEXT_DIST_DIR=.next-dev-3000
npm run dev -- --hostname 127.0.0.1 --port 3000 > hubpedia-task-3000.out.log 2> hubpedia-task-3000.err.log

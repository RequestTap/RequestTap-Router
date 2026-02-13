---
name: logs
description: Show recent gateway and dashboard logs from background processes
allowed-tools: Bash, Read, Glob
---

Show recent logs from running RequestTap services.

## 1. Find background task output files

Look for recent output files in the temp directory for background bash tasks:

```bash
ls -lt /tmp/claude/*/tasks/*.output 2>/dev/null || dir C:\Users\*\AppData\Local\Temp\claude\*\tasks\*.output /O:-D 2>nul
```

## 2. Read the most recent outputs

Read the last 50 lines from each active output file. Look for gateway logs (JSON lines with `level`, `msg`, `ts` fields) and dashboard logs.

## 3. Format and display

Show the logs with timestamps, highlighting any errors or warnings. If no logs are found, explain that services may not be running as background tasks in this session and suggest using `/start` to launch them.

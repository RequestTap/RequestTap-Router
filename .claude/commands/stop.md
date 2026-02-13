---
name: stop
description: Stop all running RequestTap services (gateway and dashboard)
allowed-tools: Bash
---

Stop the RequestTap Router services.

## 1. Find and kill the gateway process on port 4402

```bash
netstat -ano | findstr :4402
```

If a process is listening, kill it:

```bash
powershell -Command "Stop-Process -Id <PID> -Force"
```

## 2. Find and kill the dashboard process on port 3000

```bash
netstat -ano | findstr :3000
```

If a process is listening, kill it:

```bash
powershell -Command "Stop-Process -Id <PID> -Force"
```

## 3. Confirm both ports are free

Run the netstat checks again and confirm no LISTENING entries remain. Report the result to the user.

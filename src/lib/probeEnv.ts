/** Runtime environment for session-side probe commands. */
export type ProbeEnv = "unix" | "windows";

export function resolveProbeEnv(
  kind: "local" | "ssh" | null | undefined,
  shellId?: string | null,
): ProbeEnv {
  if (kind === "ssh") return "unix";
  if (!shellId) return "unix";
  if (shellId.startsWith("local:wsl:")) return "unix";
  if (shellId === "local:git-bash") return "unix";
  if (
    shellId === "local:cmd" ||
    shellId === "local:powershell" ||
    shellId === "local:pwsh" ||
    shellId.includes("powershell") ||
    shellId.includes("pwsh")
  ) {
    return "windows";
  }
  return "unix";
}

/** Linux / WSL / Git Bash / SSH */
export const UNIX_METRICS_CMD = [
  "printf 'HOST '; hostname 2>/dev/null || uname -n 2>/dev/null",
  "printf '\\nIP '; (hostname -I 2>/dev/null || true) | awk '{print $1,$2,$3}'",
  "printf '\\nLOAD '; cat /proc/loadavg 2>/dev/null",
  "printf '\\nUP '; cat /proc/uptime 2>/dev/null",
  // Prefer /proc/meminfo (works when free is missing); values in bytes.
  "printf '\\nMEM '; awk '/MemTotal:/{t=$2*1024} /MemAvailable:/{a=$2*1024} /MemFree:/{f=$2*1024} END{if(t>0){avail=(a>0?a:f); print t, (t>avail?t-avail:0), avail}else{print 0,0,0}}' /proc/meminfo 2>/dev/null",
  "printf '\\nSWAP '; awk '/SwapTotal:/{t=$2*1024} /SwapFree:/{f=$2*1024} END{print t+0, (t>f?t-f:0)+0}' /proc/meminfo 2>/dev/null",
  "printf '\\nCPU '; nproc 2>/dev/null; grep '^cpu ' /proc/stat 2>/dev/null",
  // POSIX 1K blocks + mount point
  "printf '\\nDF '; (df -Pk / 2>/dev/null || df -kP / 2>/dev/null || df -k / 2>/dev/null) | awk 'NR==2{print $2,$3,$6,$1}'",
  "printf '\\nNET '; awk 'NR>2 && $1 !~ /lo:/{gsub(\":\",\"\",$1); rx+=$2; tx+=$10} END{print rx+0,tx+0}' /proc/net/dev 2>/dev/null",
  "printf '\\nUNAME '; uname -sr 2>/dev/null",
  "printf '\\nTOP '; ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu 2>/dev/null | awk 'NR>1 && NR<=6{printf \"%s\\t%s\\t%s\\t%s\\t%s\\n\", $1,$2,$3,$4,$5}'",
  "printf '\\n'",
].join("; ");

/** PowerShell — labeled lines compatible with OverviewPane parser */
export const WIN_METRICS_CMD = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$os=Get-CimInstance Win32_OperatingSystem",
  "$cs=Get-CimInstance Win32_ComputerSystem",
  "$cpu=(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average",
  "if($null -eq $cpu){$cpu=0}",
  "$up=((Get-Date)-$os.LastBootUpTime).TotalSeconds",
  "$memTotal=[int64]$os.TotalVisibleMemorySize*1024",
  "$memFree=[int64]$os.FreePhysicalMemory*1024",
  "$memUsed=$memTotal-$memFree",
  "$dfTotal=0;$dfUsed=0;$dfMount='-';$dfFs='-'",
  "$disk=Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $_.Size -gt 0 } | Sort-Object Size -Descending | Select-Object -First 1",
  "if($disk -and $disk.Size){$dfTotal=[int64]($disk.Size/1024);$dfUsed=[int64](($disk.Size-$disk.FreeSpace)/1024);$dfMount=$disk.DeviceID;$dfFs=$disk.FileSystem}",
  "if($dfTotal -le 0){$d=Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and $_.Free -ne $null } | Sort-Object { $_.Used+$_.Free } -Descending | Select-Object -First 1; if($d){$dfTotal=[int64](($d.Used+$d.Free)/1024);$dfUsed=[int64]($d.Used/1024);$dfMount=$d.Name}}",
  "$cores=$env:NUMBER_OF_PROCESSORS; if(-not $cores){$cores=1}",
  "$ips=@(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress -First 3) -join ' '",
  "$hostName=if($cs.Name){$cs.Name}else{$env:COMPUTERNAME}",
  "Write-Output (\"HOST {0}\" -f $hostName)",
  "Write-Output (\"IP {0}\" -f $ips)",
  "Write-Output (\"LOAD {0} 0 0\" -f $cpu)",
  "Write-Output (\"UP {0}\" -f $up)",
  "Write-Output (\"MEM {0} {1} {2}\" -f $memTotal,$memUsed,$memFree)",
  "Write-Output 'SWAP 0 0'",
  "Write-Output (\"CPUPCT {0}\" -f $cpu)",
  "Write-Output (\"CPU {0}\" -f $cores)",
  "Write-Output 'cpu 0 0 0 0'",
  "Write-Output (\"DF {0} {1} {2} {3}\" -f $dfTotal,$dfUsed,$dfMount,$dfFs)",
  "Write-Output 'NET 0 0'",
  "Write-Output (\"UNAME {0}\" -f $os.Caption)",
  "$top=Get-CimInstance Win32_Process | Sort-Object WorkingSetSize -Descending | Select-Object -First 5",
  "foreach($p in $top){ $mem=[math]::Round(($p.WorkingSetSize/[math]::Max($memTotal,1))*100,1); Write-Output (\"TOP {0}`t-`t0.0`t{1}`t{2}\" -f $p.ProcessId,$mem,$p.Name) }",
].join("; ");

export const UNIX_PS_CMD =
  "ps -eo pid,user,%cpu,%mem,args --sort=-%cpu 2>/dev/null | head -n 120";

export const WIN_PS_CMD = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$os=Get-CimInstance Win32_OperatingSystem",
  "$total=[double]($os.TotalVisibleMemorySize*1024)",
  "if($total -le 0){$total=1}",
  "$procs=Get-CimInstance Win32_Process | Sort-Object WorkingSetSize -Descending | Select-Object -First 120",
  "Write-Output 'PID USER CPU MEM CMD'",
  "foreach($p in $procs){",
  "  $user='-'",
  "  try{$o=$p.GetOwner(); if($o -and $o.User){$user=$o.User}}catch{}",
  "  $mem=[math]::Round(($p.WorkingSetSize/$total)*100,1)",
  "  $cmd=if($p.CommandLine){$p.CommandLine}else{$p.Name}",
  "  $cmd=($cmd -replace '[\\r\\n\\t]+',' ')",
  "  Write-Output ('{0} {1} 0.0 {2} {3}' -f $p.ProcessId,$user,$mem,$cmd)",
  "}",
].join("; ");

export const UNIX_SS_CMD =
  "ss -lntupH 2>/dev/null || ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null";

export const WIN_SS_CMD = "netstat -ano";

export function metricsCmd(env: ProbeEnv, shellId?: string | null) {
  if (env === "unix") return UNIX_METRICS_CMD;
  return wrapForWindowsShell(shellId, WIN_METRICS_CMD);
}

export function processesCmd(env: ProbeEnv, shellId?: string | null) {
  if (env === "unix") return UNIX_PS_CMD;
  return wrapForWindowsShell(shellId, WIN_PS_CMD);
}

export function portsCmd(env: ProbeEnv, _shellId?: string | null) {
  // netstat works in both cmd and PowerShell
  return env === "windows" ? WIN_SS_CMD : UNIX_SS_CMD;
}

export function killCmd(env: ProbeEnv, pid: string, sig: "TERM" | "KILL") {
  const safe = pid.replace(/[^\d]/g, "");
  if (!safe) throw new Error("invalid pid");
  if (env === "windows") {
    return sig === "KILL" ? `taskkill /PID ${safe} /F` : `taskkill /PID ${safe}`;
  }
  return `kill -${sig} ${safe}`;
}

/** CMD sessions need an explicit powershell host for rich scripts. */
function wrapForWindowsShell(shellId: string | null | undefined, script: string) {
  if (
    shellId === "local:powershell" ||
    shellId === "local:pwsh" ||
    shellId?.includes("powershell") ||
    shellId?.includes("pwsh")
  ) {
    return script;
  }
  const escaped = script.replace(/"/g, '`"');
  return `powershell -NoProfile -NonInteractive -Command "${escaped}"`;
}

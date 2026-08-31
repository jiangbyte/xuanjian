/**
 * @file 会话侧探测命令与环境判定
 * @author Charlie
 * @description 按 Windows / Linux / macOS（Darwin）导出主机指标、进程、端口命令。
 * SSH / WSL / Git Bash 默认按 Linux 探测；本机按宿主 OS 选择。
 */

import { getHostOs, type HostOs } from "@/lib/core/platform";

/** 探测命令运行时环境 */
export type ProbeEnv = "linux" | "darwin" | "windows";

/**
 * 根据会话 kind、shellId 与本机 OS 推断探测环境。
 * SSH / WSL / Git Bash → linux；cmd/PowerShell → windows；本机 Unix → darwin|linux。
 */
export function resolveProbeEnv(
  kind: "local" | "ssh" | null | undefined,
  shellId?: string | null,
  hostOs: HostOs = getHostOs(),
): ProbeEnv {
  if (kind === "ssh") return "linux";
  if (!shellId) {
    if (hostOs === "macos") return "darwin";
    if (hostOs === "windows") return "windows";
    return "linux";
  }
  if (shellId.startsWith("local:wsl:")) return "linux";
  if (shellId === "local:git-bash") return "linux";
  if (
    shellId === "local:cmd" ||
    shellId === "local:powershell" ||
    shellId === "local:pwsh" ||
    shellId.includes("powershell") ||
    shellId.includes("pwsh")
  ) {
    return "windows";
  }
  if (hostOs === "macos") return "darwin";
  if (hostOs === "windows") return "windows";
  return "linux";
}

// —— 指标采集命令 ——

/** Linux / WSL / Git Bash / SSH：输出带标签的指标行 */
export const LINUX_METRICS_CMD = [
  "printf 'HOST '; hostname 2>/dev/null || uname -n 2>/dev/null",
  "printf '\\nIP '; (hostname -I 2>/dev/null || true) | awk '{print $1,$2,$3}'",
  "printf '\\nLOAD '; cat /proc/loadavg 2>/dev/null",
  "printf '\\nUP '; cat /proc/uptime 2>/dev/null",
  "printf '\\nMEM '; awk '/MemTotal:/{t=$2*1024} /MemAvailable:/{a=$2*1024} /MemFree:/{f=$2*1024} END{if(t>0){avail=(a>0?a:f); print t, (t>avail?t-avail:0), avail}else{print 0,0,0}}' /proc/meminfo 2>/dev/null",
  "printf '\\nSWAP '; awk '/SwapTotal:/{t=$2*1024} /SwapFree:/{f=$2*1024} END{print t+0, (t>f?t-f:0)+0}' /proc/meminfo 2>/dev/null",
  "printf '\\nCPU '; nproc 2>/dev/null; grep '^cpu ' /proc/stat 2>/dev/null",
  "printf '\\nDF '; (df -Pk / 2>/dev/null || df -kP / 2>/dev/null || df -k / 2>/dev/null) | awk 'NR==2{print $2,$3,$6,$1}'",
  "printf '\\nNET '; awk 'NR>2 && $1 !~ /lo:/{gsub(\":\",\"\",$1); rx+=$2; tx+=$10} END{print rx+0,tx+0}' /proc/net/dev 2>/dev/null",
  "printf '\\nUNAME '; uname -sr 2>/dev/null",
  "printf '\\nTOP '; ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu 2>/dev/null | awk 'NR>1 && NR<=6{printf \"%s\\t%s\\t%s\\t%s\\t%s\\n\", $1,$2,$3,$4,$5}'",
  "printf '\\n'",
].join("; ");

/** macOS：同标签输出，避免依赖 /proc、nproc、GNU ps */
export const DARWIN_METRICS_CMD = [
  "printf 'HOST '; hostname 2>/dev/null || scutil --get ComputerName 2>/dev/null || uname -n",
  "printf '\\nIP '; (ipconfig getifaddr en0 2>/dev/null; ipconfig getifaddr en1 2>/dev/null; ifconfig 2>/dev/null | awk '/inet / && $2 != \"127.0.0.1\" {print $2}' | head -n 3) | tr '\\n' ' '",
  "printf '\\nLOAD '; sysctl -n vm.loadavg 2>/dev/null | tr -d '{}'",
  "printf '\\nUP '; boot=$(sysctl -n kern.boottime 2>/dev/null | awk -F'[ ,]' '{print $4}'); now=$(date +%s); echo $((now-boot))",
  'printf \'\\nMEM \'; pagesize=$(pagesize 2>/dev/null || echo 4096); total=$(sysctl -n hw.memsize 2>/dev/null || echo 0); free_pages=$(vm_stat 2>/dev/null | awk \'/Pages free/ {gsub(/\\./,"",$3); print $3+0}\'); inactive=$(vm_stat 2>/dev/null | awk \'/Pages inactive/ {gsub(/\\./,"",$3); print $3+0}\'); speculative=$(vm_stat 2>/dev/null | awk \'/Pages speculative/ {gsub(/\\./,"",$3); print $3+0}\'); avail=$(( (free_pages+inactive+speculative)*pagesize )); used=$(( total>avail ? total-avail : 0 )); printf \'%s %s %s\' "$total" "$used" "$avail"',
  'printf \'\\nSWAP \'; sysctl -n vm.swapusage 2>/dev/null | awk \'{for(i=1;i<=NF;i++){if($i=="total"){t=$(i+1)} if($i=="used"){u=$(i+1)}} gsub(/M/,"",t); gsub(/M/,"",u); printf "%d %d", t*1024*1024+0, u*1024*1024+0}\'',
  "printf '\\nCPUPCT '; top -l 1 -n 0 2>/dev/null | awk -F'[ %]+' '/CPU usage/ {idle=$(NF-1)+0; printf \"%.1f\", 100-idle; exit}'",
  "printf '\\nCPU '; sysctl -n hw.ncpu 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 1; echo 'cpu 0 0 0 0'",
  "printf '\\nDF '; (df -k / 2>/dev/null | awk 'NR==2{print $2,$3,$9,$1}')",
  "printf '\\nNET '; netstat -ibn 2>/dev/null | awk 'NR>1 && $1 !~ /lo/ {rx+=$7; tx+=$10} END{print rx+0,tx+0}'",
  "printf '\\nUNAME '; uname -sr 2>/dev/null",
  "printf '\\nTOP '; ps -axo pid,user,%cpu,%mem,comm -r 2>/dev/null | awk 'NR>1 && NR<=6{printf \"%s\\t%s\\t%s\\t%s\\t%s\\n\", $1,$2,$3,$4,$5}'",
  "printf '\\n'",
].join("; ");

/** @deprecated 使用 LINUX_METRICS_CMD */
export const UNIX_METRICS_CMD = LINUX_METRICS_CMD;

/** PowerShell：带标签的指标行 */
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
  'Write-Output ("HOST {0}" -f $hostName)',
  'Write-Output ("IP {0}" -f $ips)',
  'Write-Output ("LOAD {0} 0 0" -f $cpu)',
  'Write-Output ("UP {0}" -f $up)',
  'Write-Output ("MEM {0} {1} {2}" -f $memTotal,$memUsed,$memFree)',
  "Write-Output 'SWAP 0 0'",
  'Write-Output ("CPUPCT {0}" -f $cpu)',
  'Write-Output ("CPU {0}" -f $cores)',
  "Write-Output 'cpu 0 0 0 0'",
  'Write-Output ("DF {0} {1} {2} {3}" -f $dfTotal,$dfUsed,$dfMount,$dfFs)',
  "Write-Output 'NET 0 0'",
  'Write-Output ("UNAME {0}" -f $os.Caption)',
  "$top=Get-CimInstance Win32_Process | Sort-Object WorkingSetSize -Descending | Select-Object -First 5",
  'foreach($p in $top){ $mem=[math]::Round(($p.WorkingSetSize/[math]::Max($memTotal,1))*100,1); Write-Output ("TOP {0}`t-`t0.0`t{1}`t{2}" -f $p.ProcessId,$mem,$p.Name) }',
].join("; ");

/** Linux 进程列表 */
export const LINUX_PS_CMD =
  "ps -eo pid,user,%cpu,%mem,args --sort=-%cpu 2>/dev/null | head -n 120";

/** macOS BSD ps（无 --sort） */
export const DARWIN_PS_CMD =
  "ps -axo pid,user,%cpu,%mem,command -r 2>/dev/null | head -n 120";

/** @deprecated */
export const UNIX_PS_CMD = LINUX_PS_CMD;

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

export const LINUX_SS_CMD =
  "ss -lntupH 2>/dev/null || ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null";

/** macOS：lsof 监听端口（ss 通常不可用） */
export const DARWIN_SS_CMD =
  "lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null; echo '---'; lsof -nP -iUDP 2>/dev/null | head -n 200";

/** @deprecated */
export const UNIX_SS_CMD = LINUX_SS_CMD;

export const WIN_SS_CMD = "netstat -ano";

export function metricsCmd(env: ProbeEnv, shellId?: string | null) {
  if (env === "linux") return LINUX_METRICS_CMD;
  if (env === "darwin") return DARWIN_METRICS_CMD;
  return wrapForWindowsShell(shellId, WIN_METRICS_CMD);
}

export function processesCmd(env: ProbeEnv, shellId?: string | null) {
  if (env === "linux") return LINUX_PS_CMD;
  if (env === "darwin") return DARWIN_PS_CMD;
  return wrapForWindowsShell(shellId, WIN_PS_CMD);
}

export function portsCmd(env: ProbeEnv, _shellId?: string | null) {
  if (env === "windows") return WIN_SS_CMD;
  if (env === "darwin") return DARWIN_SS_CMD;
  return LINUX_SS_CMD;
}

export const LINUX_DISK_CMD =
  "df -Pk 2>/dev/null | awk 'NR==1 || $1 !~ /^(tmpfs|devtmpfs|overlay|shm)$/ {print}'";

export const DARWIN_DISK_CMD =
  "df -k 2>/dev/null | awk 'NR==1 || $1 !~ /^(devfs|map)/ {print}'";

export const WIN_DISK_CMD = [
  "$ErrorActionPreference='SilentlyContinue'",
  "Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and $_.Free -ne $null } |",
  'ForEach-Object { Write-Output ("{0}`t{1}`t{2}`t{3}" -f $_.Name, [int64](($_.Used+$_.Free)/1024), [int64]($_.Used/1024), [int64]($_.Free/1024)) }',
].join(" ");

export function diskSnapshotCmd(env: ProbeEnv, shellId?: string | null) {
  if (env === "linux") return LINUX_DISK_CMD;
  if (env === "darwin") return DARWIN_DISK_CMD;
  return wrapForWindowsShell(shellId, WIN_DISK_CMD);
}

/** Linux 进程树数据（含 PPID） */
export const LINUX_PS_TREE_CMD =
  "ps -eo pid,ppid,user,%cpu,%mem,args --sort=pid 2>/dev/null";

/** macOS 进程树数据 */
export const DARWIN_PS_TREE_CMD =
  "ps -axo pid,ppid,user,%cpu,%mem,command 2>/dev/null";

/** Windows 进程树数据 */
export const WIN_PS_TREE_CMD = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$os=Get-CimInstance Win32_OperatingSystem",
  "$total=[double]($os.TotalVisibleMemorySize*1024)",
  "if($total -le 0){$total=1}",
  "Write-Output 'PID PPID USER CPU MEM CMD'",
  "Get-CimInstance Win32_Process | Sort-Object ProcessId | ForEach-Object {",
  "  $user='-'",
  "  try{$o=$_.GetOwner(); if($o -and $o.User){$user=$o.User}}catch{}",
  "  $mem=[math]::Round(($_.WorkingSetSize/$total)*100,1)",
  "  $cmd=if($_.CommandLine){$_.CommandLine}else{$_.Name}",
  "  $cmd=($cmd -replace '[\\r\\n\\t]+',' ')",
  "  Write-Output ('{0} {1} {2} 0.0 {3} {4}' -f $_.ProcessId,$_.ParentProcessId,$user,$mem,$cmd)",
  "}",
].join("; ");

export function processTreeListCmd(env: ProbeEnv, shellId?: string | null) {
  if (env === "linux") return LINUX_PS_TREE_CMD;
  if (env === "darwin") return DARWIN_PS_TREE_CMD;
  return wrapForWindowsShell(shellId, WIN_PS_TREE_CMD);
}

export function killCmd(env: ProbeEnv, pid: string, sig: "TERM" | "KILL") {
  const safe = pid.replace(/[^\d]/g, "");
  if (!safe) throw new Error("invalid pid");
  if (env === "windows") {
    return sig === "KILL"
      ? `taskkill /PID ${safe} /F`
      : `taskkill /PID ${safe}`;
  }
  return `kill -${sig} ${safe}`;
}

function wrapForWindowsShell(
  shellId: string | null | undefined,
  script: string,
) {
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

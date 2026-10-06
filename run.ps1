# Morning Report — single entry point.
#
# Runs the whole digest pipeline and prints the finished HTML to stdout.
# Node writes the HTML to stdout and all diagnostic logging to stderr, so
# stdout stays clean HTML — pipe it straight into n8n's Send Email node.
#
# Usage (n8n Execute Command node, or a shell):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1
#
# Exit code is propagated: non-zero means every source failed (nothing to send).

# Note: we deliberately do NOT set $ErrorActionPreference to 'Stop'. Node logs
# to stderr on every run, and under 'Stop' PowerShell would treat that native
# stderr output as a terminating NativeCommandError.

# Run from the project root regardless of the caller's working directory.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

# stdout (HTML) flows through as this script's output; stderr (logs) stays on
# stderr. Any extra args are forwarded to node/index.js.
& node (Join-Path $root 'src/index.js') @args

exit $LASTEXITCODE

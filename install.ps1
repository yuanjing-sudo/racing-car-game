# Install Ollama + 6GB-optimized models (Windows PowerShell)
# Run as: powershell -ExecutionPolicy Bypass -File install.ps1

Write-Host "=== 6GB Local AI Agent Installer ===" -ForegroundColor Cyan

# 1. Check / Install Ollama
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Ollama..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://ollama.com/install.ps1" -OutFile "$env:TEMP\install-ollama.ps1"
    & "$env:TEMP\install-ollama.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Auto-install failed. Please install manually from https://ollama.com/download" -ForegroundColor Red
        Start-Process "https://ollama.com/download"
        exit 1
    }
} else {
    Write-Host "Ollama already installed" -ForegroundColor Green
    ollama --version
}

# 2. Start Ollama service
Write-Host "Starting Ollama service..." -ForegroundColor Yellow
Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# 3. Pull 6GB-optimized models (~4GB each, ~12GB total)
$models = @(
    "qwen2.5-coder:7b",  # Main coder - best for code gen (fits 6GB)
    "deepseek-r1:7b",    # Planner - best reasoning at 7B
    "llama3.1:8b",       # Reviewer / verifier
    "gemma3:4b"          # Small/fast for titles & quick tasks
)

foreach ($m in $models) {
    Write-Host "`nPulling $m ..." -ForegroundColor Yellow
    ollama pull $m
}

Write-Host "`n=== Verification ===" -ForegroundColor Cyan
ollama list

Write-Host "`n=== Test Inference ===" -ForegroundColor Cyan
ollama run qwen2.5-coder:7b --verbose "Write a hello world in Python" 2>&1 | Select-Object -First 20

Write-Host "`n=== Done! ===" -ForegroundColor Green
Write-Host "Your local models are ready at http://localhost:11434"
Write-Host "Next steps:"
Write-Host "  1. Edit prompts/system.md  <- YOU write the finishing center prompt"
Write-Host "  2. Restart opencode: quit and run 'opencode' again"
Write-Host "  3. Models will be used automatically via opencode.json"
Write-Host ""
Write-Host "Usage in opencode:"
Write-Host "  @planner  -> DeepSeek-R1 7B for architecture"
Write-Host "  @coder    -> Qwen2.5-Coder 7B for code"
Write-Host "  @reviewer -> Llama 3.1 8B for verification"

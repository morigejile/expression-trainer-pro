# Generates a 16 kHz mono PCM WAV fixture for the ASR token-timestamp spike.
#
# The utterance is three Chinese sentences separated by explicit silence.
#
# The gaps matter: the streaming recognizer only emits an endpoint after
# rule1MinTrailingSilence (2.4 s in the production provider config) of trailing
# silence. System.Speech does not synthesize silence for Start-Sleep between
# Speak calls, so each sentence is rendered to a temp file and the silence is
# appended as raw PCM before the next one. Default 3000 ms keeps the segment
# boundaries predictable; TTS also inserts its own silence at sentence ends, so
# even a small SilenceMs can exceed the endpoint threshold.
param(
  [string]$OutputPath = (Join-Path $PSScriptRoot 'fixtures\token-timestamp-zh-segmented-16k.wav'),
  [string]$Voice = 'Microsoft Huihui Desktop',
  [int]$SilenceMs = 3000,
  [int]$SampleRate = 16000
)

Add-Type -AssemblyName System.Speech

$outDir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$tempWav = Join-Path $outDir '.sentence-tmp.wav'

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$synth.Rate = 0
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  $SampleRate,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

function Read-Pcm16([string]$wavPath) {
  $bytes = [System.IO.File]::ReadAllBytes($wavPath)
  # Locate the `data` chunk instead of assuming a 44-byte header.
  for ($i = 12; $i -lt $bytes.Length - 8; $i++) {
    if ($bytes[$i] -eq 0x64 -and $bytes[$i + 1] -eq 0x61 -and $bytes[$i + 2] -eq 0x74 -and $bytes[$i + 3] -eq 0x61) {
      $size = [BitConverter]::ToUInt32($bytes, $i + 4)
      $start = $i + 8
      return $bytes[$start..([Math]::Min($start + $size, $bytes.Length) - 1)]
    }
  }
  throw "no data chunk in $wavPath"
}

$stream = New-Object System.IO.MemoryStream
$silenceBytes = New-Object byte[] ([int]($SampleRate * $SilenceMs / 1000) * 2)

foreach ($sentence in @('第一段话。', '今天天气很好。', '我们明天再见。')) {
  if (Test-Path $tempWav) { Remove-Item $tempWav -Force }
  $synth.SetOutputToWaveFile($tempWav, $format)
  $synth.Speak($sentence)
  $synth.SetOutputToNull()
  $pcm = Read-Pcm16 $tempWav
  $stream.Write($pcm, 0, $pcm.Length)
  $stream.Write($silenceBytes, 0, $silenceBytes.Length)
}

$synth.Dispose()
if (Test-Path $tempWav) { Remove-Item $tempWav -Force }

# Wrap the accumulated PCM in a canonical 44-byte RIFF/WAVE header.
$pcmBytes = $stream.ToArray()
$stream.Dispose()
$header = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($header)
$writer.Write([char[]]'RIFF')
$writer.Write([int](36 + $pcmBytes.Length))
$writer.Write([char[]]'WAVE')
$writer.Write([char[]]'fmt ')
$writer.Write([int]16)
$writer.Write([int16]1)
$writer.Write([int16]1)
$writer.Write([int]$SampleRate)
$writer.Write([int]($SampleRate * 2))
$writer.Write([int16]2)
$writer.Write([int16]16)
$writer.Write([char[]]'data')
$writer.Write([int]$pcmBytes.Length)
$writer.Flush()
$out = New-Object System.IO.MemoryStream
$header.WriteTo($out)
$out.Write($pcmBytes, 0, $pcmBytes.Length)
[System.IO.File]::WriteAllBytes($OutputPath, $out.ToArray())
$header.Dispose(); $out.Dispose(); $writer.Dispose()

$info = Get-Item $OutputPath
$seconds = [Math]::Round($pcmBytes.Length / 2 / $SampleRate, 3)
Write-Host "wrote $($info.FullName) ($($info.Length) bytes, ${seconds}s, ${SilenceMs}ms gaps)"

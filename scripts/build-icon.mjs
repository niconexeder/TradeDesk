import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(root, 'desktop', 'TradeDesk.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const workspace = mkdtempSync(join(tmpdir(), 'tradedesk-icon-'));
const pngDirectory = join(workspace, 'png');
const scriptPath = join(workspace, 'draw.ps1');

const powershell = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path '${pngDirectory.replaceAll("'", "''")}' | Out-Null
$scale = 16.0
$masterSize = 1024
$master = [System.Drawing.Bitmap]::new($masterSize, $masterSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($master)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)
$diameter = 32 * $scale
$shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
$shape.AddArc(0, 0, $diameter, $diameter, 180, 90)
$shape.AddArc($masterSize - $diameter, 0, $diameter, $diameter, 270, 90)
$shape.AddArc($masterSize - $diameter, $masterSize - $diameter, $diameter, $diameter, 0, 90)
$shape.AddArc(0, $masterSize - $diameter, $diameter, $diameter, 90, 90)
$shape.CloseFigure()
$gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.RectangleF]::new(0, 0, $masterSize, $masterSize),
  [System.Drawing.ColorTranslator]::FromHtml('#6d7cff'),
  [System.Drawing.ColorTranslator]::FromHtml('#9b5cf6'),
  [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$graphics.FillPath($gradient, $shape)
$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$tPoints = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new([single](14 * $scale), [single](18 * $scale)),
  [System.Drawing.PointF]::new([single](34 * $scale), [single](18 * $scale)),
  [System.Drawing.PointF]::new([single](34 * $scale), [single](24 * $scale)),
  [System.Drawing.PointF]::new([single](27 * $scale), [single](24 * $scale)),
  [System.Drawing.PointF]::new([single](27 * $scale), [single](46 * $scale)),
  [System.Drawing.PointF]::new([single](21 * $scale), [single](46 * $scale)),
  [System.Drawing.PointF]::new([single](21 * $scale), [single](24 * $scale)),
  [System.Drawing.PointF]::new([single](14 * $scale), [single](24 * $scale))
)
$graphics.FillPolygon($white, $tPoints)
$arrow = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#8de7ff'), [single](4 * $scale))
$arrow.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$arrow.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$arrow.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawLine($arrow, [single](35 * $scale), [single](40 * $scale), [single](48 * $scale), [single](27 * $scale))
$head = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new([single](39 * $scale), [single](25 * $scale)),
  [System.Drawing.PointF]::new([single](48 * $scale), [single](25 * $scale)),
  [System.Drawing.PointF]::new([single](48 * $scale), [single](34 * $scale))
)
$graphics.DrawLines($arrow, $head)
$master.Save('${join(workspace, 'master.png').replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
foreach ($size in @(${sizes.join(', ')})) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $resize = [System.Drawing.Graphics]::FromImage($bitmap)
  $resize.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $resize.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $resize.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $resize.DrawImage($master, [System.Drawing.Rectangle]::new(0, 0, $size, $size), 0, 0, $masterSize, $masterSize, [System.Drawing.GraphicsUnit]::Pixel)
  $bitmap.Save('${pngDirectory.replaceAll("'", "''")}\\icon-' + $size + '.png', [System.Drawing.Imaging.ImageFormat]::Png)
  $resize.Dispose()
  $bitmap.Dispose()
}
$arrow.Dispose()
$white.Dispose()
$gradient.Dispose()
$shape.Dispose()
$graphics.Dispose()
$master.Dispose()
`;

try {
  writeFileSync(scriptPath, powershell, 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { stdio: 'inherit' });
  const images = sizes.map(size => {
    const path = join(pngDirectory, `icon-${size}.png`);
    if (!existsSync(path)) throw new Error(`Не удалось создать ${path}`);
    return { size, data: readFileSync(path) };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(images.length * 16);
  let offset = 6 + directory.length;
  for (let index = 0; index < images.length; index += 1) {
    const { size, data } = images[index];
    const entry = index * 16;
    directory[entry] = size === 256 ? 0 : size;
    directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  }
  writeFileSync(output, Buffer.concat([header, directory, ...images.map(image => image.data)]));
  console.log(`Иконка: ${output}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
